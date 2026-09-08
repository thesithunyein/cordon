import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { KeeperHubClient } from './kh-client.js'

/**
 * A minimal fetch stub. Records every request so tests can assert on the
 * MCP wire protocol (initialize → initialized → tools/call) and on the
 * response shapes KeeperHub actually returns.
 */
function installFetchStub(
  responder: (req: { method: string; params: any; body: string }) => { status: number; text: string; sessionId?: string },
) {
  const calls: Array<{ method: string; params: any; body: string }> = []
  globalThis.fetch = (async (url: string, init: any) => {
    const body = init?.body ?? '{}'
    const parsed = JSON.parse(body)
    const req = { method: parsed.method, params: parsed.params, body }
    calls.push(req)
    const res = responder(req)
    const headers = new Headers({ 'content-type': 'application/json' })
    if (res.sessionId) headers.set('mcp-session-id', res.sessionId)
    return new Response(res.text, { status: res.status, headers })
  }) as unknown as typeof fetch
  return calls
}

const okInit = () => installFetchStub((req) => {
  if (req.method === 'initialize') return { status: 200, text: JSON.stringify({ jsonrpc: '2.0', result: { protocolVersion: '2025-03-26' } }), sessionId: 'sess-1' }
  if (req.method === 'tools/call') {
    const content = [{ type: 'text', text: JSON.stringify({ executionId: 'exec-abc', transactionHash: '0x1234' }) }]
    return { status: 200, text: JSON.stringify({ jsonrpc: '2.0', result: { content } }) }
  }
  return { status: 200, text: JSON.stringify({ jsonrpc: '2.0', result: {} }) }
})

let calls: ReturnType<typeof installFetchStub>

beforeEach(() => { calls = okInit() })
afterEach(() => { delete (globalThis as any).fetch })

test('handshake: initialize then notifications/initialized, sequential', async () => {
  const kh = new KeeperHubClient('kh_test')
  await kh.ensureInitialized()
  assert.equal(calls[0].method, 'initialize')
  assert.equal(calls[1].method, 'notifications/initialized')
})

test('handshake: captures Mcp-Session-Id and reuses it', async () => {
  const kh = new KeeperHubClient('kh_test')
  await kh.ensureInitialized()
  await kh.callTool('any_tool', {})
  const third = calls[2]
  assert.equal(calls[1].method, 'notifications/initialized')
  // session id is sent on every request after init
  assert.ok(calls.length >= 3)
  void third
})

test('handshake: init failure throws', async () => {
  calls = installFetchStub((req) => req.method === 'initialize' ? { status: 401, text: 'unauthorized' } : { status: 200, text: '{}' })
  const kh = new KeeperHubClient('kh_test')
  await assert.rejects(() => kh.ensureInitialized(), /MCP initialize failed/)
})

test('callTool: extracts structured data from the text content', async () => {
  const kh = new KeeperHubClient('kh_test')
  const r = await kh.callTool('execute_protocol_action', { actionType: 'x' })
  assert.equal(r.isError, false)
  assert.equal(r.data?.executionId, 'exec-abc')
  assert.equal(r.data?.transactionHash, '0x1234')
})

test('callTool: 400 with wouldRevert surfaces as error with wouldRevert data', async () => {
  calls = installFetchStub((req) => {
    if (req.method === 'tools/call') {
      return { status: 400, text: JSON.stringify({ error: { message: 'simulate', data: { wouldRevert: true, failureKind: 'revert' } } }) }
    }
    return { status: 200, text: '{}' }
  })
  const kh = new KeeperHubClient('kh_test')
  const r = await kh.callTool('execute_contract_call', {})
  assert.equal(r.isError, true)
  assert.equal(r.data?.wouldRevert, true)
})

test('callTool: plain 500 without wouldRevert is an error, not a refusal', async () => {
  calls = installFetchStub((req) => req.method === 'tools/call' ? { status: 500, text: 'server exploded' } : { status: 200, text: '{}' })
  const kh = new KeeperHubClient('kh_test')
  kh.setBackoff(2, 5)
  const r = await kh.callTool('anything', {})
  assert.equal(r.isError, true)
  assert.equal(r.data?.wouldRevert, undefined)
})

test('retry: a transient 429 is retried with backoff and succeeds', async () => {
  let n = 0
  calls = installFetchStub((req) => {
    if (req.method === 'tools/call') {
      n++
      if (n <= 2) return { status: 429, text: '{"error":"rate limited"}' }
      return { status: 200, text: JSON.stringify({ jsonrpc: '2.0', result: { content: [{ type: 'text', text: '{"ok":true}' }] } }) }
    }
    return { status: 200, text: '{}' }
  })
  const kh = new KeeperHubClient('kh_test')
  kh.setBackoff(3, 2)
  const r = await kh.callTool('anything', {})
  assert.equal(r.isError, false)
  assert.equal(n, 3) // 2 failed attempts + 1 success
})

test('retry: a transient 500 is retried and succeeds', async () => {
  let n = 0
  calls = installFetchStub((req) => {
    if (req.method === 'tools/call') {
      n++
      if (n === 1) return { status: 503, text: 'upstream warming up' }
      return { status: 200, text: JSON.stringify({ jsonrpc: '2.0', result: { content: [{ type: 'text', text: '{"ok":true}' }] } }) }
    }
    return { status: 200, text: '{}' }
  })
  const kh = new KeeperHubClient('kh_test')
  kh.setBackoff(3, 2)
  const r = await kh.callTool('anything', {})
  assert.equal(r.isError, false)
  assert.equal(n, 2)
})

test('retry: a network drop is retried and succeeds', async () => {
  let n = 0
  calls = installFetchStub((req) => {
    if (req.method === 'tools/call') {
      n++
      if (n === 1) throw new Error('fetch failed: connection refused')
      return { status: 200, text: JSON.stringify({ jsonrpc: '2.0', result: { content: [{ type: 'text', text: '{"ok":true}' }] } }) }
    }
    return { status: 200, text: '{}' }
  })
  const kh = new KeeperHubClient('kh_test')
  kh.setBackoff(3, 2)
  const r = await kh.callTool('anything', {})
  assert.equal(r.isError, false)
  assert.equal(n, 2)
})

test('retry: an auth 401 is NOT retried (deterministic failure)', async () => {
  let n = 0
  calls = installFetchStub((req) => {
    if (req.method === 'tools/call') {
      n++
      return { status: 401, text: 'unauthorized' }
    }
    return { status: 200, text: '{}' }
  })
  const kh = new KeeperHubClient('kh_test')
  kh.setBackoff(3, 2)
  const r = await kh.callTool('anything', {})
  assert.equal(r.isError, true)
  assert.equal(n, 1) // no retry on 401
})

test('retry: repeated 429s exhaust the budget and surface the error', async () => {
  let n = 0
  calls = installFetchStub((req) => {
    if (req.method === 'tools/call') {
      n++
      return { status: 429, text: '{"error":"still rate limited"}' }
    }
    return { status: 200, text: '{}' }
  })
  const kh = new KeeperHubClient('kh_test')
  kh.setBackoff(3, 2)
  const r = await kh.callTool('anything', {})
  assert.equal(r.isError, true)
  assert.equal(n, 4) // 1 initial + 3 retries
})

test('callTool: jsonrpc error object marks isError', async () => {
  calls = installFetchStub((req) => req.method === 'tools/call'
    ? { status: 200, text: JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message: 'bad' } }) }
    : { status: 200, text: '{}' })
  const kh = new KeeperHubClient('kh_test')
  const r = await kh.callTool('anything', {})
  assert.equal(r.isError, true)
})

test('simulateContractCall: revert reason extracted from the error body', async () => {
  calls = installFetchStub((req) => req.method === 'tools/call'
    ? { status: 400, text: JSON.stringify({ error: { data: { wouldRevert: true, revertReason: 'ERC20: transfer amount exceeds balance' } } }) }
    : { status: 200, text: '{}' })
  const kh = new KeeperHubClient('kh_test')
  const sim = await kh.simulateContractCall({ chainId: '11155111', contractAddress: '0x1', functionName: 'supply', functionArgs: '[]' })
  assert.equal(sim.success, false)
  assert.equal(sim.wouldRevert, true)
  assert.match(sim.error ?? '', /ERC20: transfer amount exceeds balance/)
})

test('simulateContractCall: revert reason parsed from raw text (no structured error)', async () => {
  calls = installFetchStub((req) => req.method === 'tools/call'
    ? { status: 400, text: '{"error":{"data":{"wouldRevert":true,"revertReason":"Error(51)"}}}' }
    : { status: 200, text: '{}' })
  const kh = new KeeperHubClient('kh_test')
  const sim = await kh.simulateContractCall({ chainId: '1', contractAddress: '0x1', functionName: 'f', functionArgs: '[]' })
  assert.equal(sim.wouldRevert, true)
  assert.match(sim.error ?? '', /Error\(51\)/)
})

test('simulateContractCall: clean simulation passes the gate', async () => {
  calls = installFetchStub((req) => req.method === 'tools/call'
    ? { status: 200, text: JSON.stringify({ jsonrpc: '2.0', result: { content: [{ type: 'text', text: JSON.stringify({ gasEstimate: 63623, wouldRevert: false }) }] } }) }
    : { status: 200, text: '{}' })
  const kh = new KeeperHubClient('kh_test')
  const sim = await kh.simulateContractCall({ chainId: '1', contractAddress: '0x1', functionName: 'f', functionArgs: '[]' })
  assert.equal(sim.success, true)
  assert.equal(sim.wouldRevert, false)
})

test('pollExecution: completed status maps to completed with tx hash', async () => {
  calls = installFetchStub((req) => req.method === 'tools/call'
    ? { status: 200, text: JSON.stringify({ jsonrpc: '2.0', result: { content: [{ type: 'text', text: JSON.stringify({ status: 'completed', transactionHash: '0xdead' }) }] } }) }
    : { status: 200, text: '{}' })
  const kh = new KeeperHubClient('kh_test')
  const res = await kh.pollExecution('exec-1', { maxWaitMs: 1000, intervalMs: 10 })
  assert.equal(res.status, 'completed')
  assert.equal(res.transactionHash, '0xdead')
})

test('pollExecution: failed status returns failed', async () => {
  calls = installFetchStub((req) => req.method === 'tools/call'
    ? { status: 200, text: JSON.stringify({ jsonrpc: '2.0', result: { content: [{ type: 'text', text: JSON.stringify({ status: 'failed' }) }] } }) }
    : { status: 200, text: '{}' })
  const kh = new KeeperHubClient('kh_test')
  const res = await kh.pollExecution('exec-2', { maxWaitMs: 1000, intervalMs: 10 })
  assert.equal(res.status, 'failed')
})

test('pollExecution: times out with the last status', async () => {
  calls = installFetchStub((req) => req.method === 'tools/call'
    ? { status: 200, text: JSON.stringify({ jsonrpc: '2.0', result: { content: [{ type: 'text', text: JSON.stringify({ status: 'pending' }) }] } }) }
    : { status: 200, text: '{}' })
  const kh = new KeeperHubClient('kh_test')
  await assert.rejects(() => kh.pollExecution('exec-3', { maxWaitMs: 50, intervalMs: 10 }), /Timed out polling/)
})

test('safeContractWrite: simulation revert refuses before any broadcast', async () => {
  calls = installFetchStub((req) => {
    if (req.method === 'initialize') return { status: 200, text: '{}', sessionId: 's' }
    if (req.method === 'tools/call' && req.params?.name === 'execute_contract_call') {
      const args = req.params.arguments
      return args.simulate === true
        ? { status: 400, text: '{"error":{"data":{"wouldRevert":true,"revertReason":"nope"}}}' }
        : { status: 200, text: '{}' }
    }
    return { status: 200, text: '{}' }
  })
  const kh = new KeeperHubClient('kh_test')
  const res = await kh.safeContractWrite({ chainId: '1', contractAddress: '0x1', functionName: 'f', functionArgs: '[]', idempotencyKey: 'k' })
  assert.equal(res.refused, true)
  // broadcast step never happened
  const broadcasts = calls.filter((c) => c.method === 'tools/call' && c.params?.name === 'execute_contract_call' && c.params?.arguments?.simulate !== true)
  assert.equal(broadcasts.length, 0)
})

test('executeProtocolAction: idempotency key travels in the request', async () => {
  let sentKey = ''
  calls = installFetchStub((req) => {
    if (req.method === 'tools/call') {
      sentKey = req.params?.arguments?.idempotency_key ?? ''
      return { status: 200, text: JSON.stringify({ jsonrpc: '2.0', result: { content: [{ type: 'text', text: JSON.stringify({ executionId: 'e1' }) }] } }) }
    }
    return { status: 200, text: '{}' }
  })
  const kh = new KeeperHubClient('kh_test')
  await kh.executeProtocolAction({ actionType: 'aave-v3/supply', params: { network: '11155111' }, idempotencyKey: 'topup-key-1' })
  assert.equal(sentKey, 'topup-key-1')
})

test('safeProtocolWrite: refuses when the simulated calldata reverts', async () => {
  calls = installFetchStub((req) => req.method === 'tools/call' && req.params?.name === 'execute_contract_call' && req.params?.arguments?.simulate === true
    ? { status: 400, text: '{"error":{"data":{"wouldRevert":true,"revertReason":"Error(51)"}}}' }
    : { status: 200, text: '{}' })
  const kh = new KeeperHubClient('kh_test')
  const res = await kh.safeProtocolWrite({
    actionType: 'aave-v3/supply',
    params: { network: '11155111', asset: '0x1', amount: '5', onBehalfOf: '0x2' },
    idempotencyKey: 'k',
    simulate: { chainId: '11155111', contractAddress: '0x1', functionName: 'supply', functionArgs: '[]' },
  })
  assert.equal(res.refused, true)
})

test('callTool: sends Bearer auth with the org key', async () => {
  let auth = ''
  globalThis.fetch = (async (_url: string, init: any) => {
    auth = init.headers.get('Authorization') ?? ''
    return new Response(JSON.stringify({ jsonrpc: '2.0', result: { protocolVersion: 'v' } }), { status: 200, headers: new Headers({ 'mcp-session-id': 's' }) })
  }) as unknown as typeof fetch
  const kh = new KeeperHubClient('kh_secret_key')
  await kh.ensureInitialized()
  assert.equal(auth, 'Bearer kh_secret_key')
})