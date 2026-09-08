import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildGuardianWorkflow } from './aave-v3-guardian.js'

const config = {
  khApiKey: 'kh_test',
  positionAddress: '0xf3F9aAbe2aC0Fd841DFfE116867ab76D2b582897',
  healthFactorThreshold: 1.5,
  reserve: 'LINK' as const,
  topUpAmount: 5,
  campaignRounds: 10,
  verifyReceipts: true,
  chainId: 11155111,
}

const wf = buildGuardianWorkflow(config)

test('workflow: single source trigger and a complete path to notify', () => {
  const triggers = wf.nodes.filter((n) => n.type === 'trigger')
  assert.equal(triggers.length, 1)
  const ids = new Set(wf.nodes.map((n) => n.id))
  const allReachable = new Set<string>(['trigger-schedule'])
  let grew = true
  while (grew) {
    grew = false
    for (const e of wf.edges) {
      if (allReachable.has(e.source) && !allReachable.has(e.target)) {
        allReachable.add(e.target)
        grew = true
      }
    }
  }
  assert.equal(allReachable.size, ids.size, 'every node must be reachable from the trigger')
  assert.ok(allReachable.has('notify'))
})

test('workflow: every edge references existing nodes', () => {
  const ids = new Set(wf.nodes.map((n) => n.id))
  for (const e of wf.edges) {
    assert.ok(ids.has(e.source), `missing source ${e.source}`)
    assert.ok(ids.has(e.target), `missing target ${e.target}`)
  }
})

test('workflow: reads the real Aave V3 Sepolia Pool', () => {
  const read = wf.nodes.find((n) => n.id === 'read-health')!
  assert.equal(read.data.config.contractAddress, '0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951')
  assert.equal(read.data.config.network, '11155111')
  assert.deepEqual(read.data.config.args, [config.positionAddress])
})

test('workflow: protective supply is simulated before execution', () => {
  const sim = wf.nodes.find((n) => n.id === 'simulate-supply')!
  const exec = wf.nodes.find((n) => n.id === 'execute-supply')!
  assert.equal(sim.data.config.simulate, true)
  assert.ok(exec.data.config.idempotencyKey, 'execution node must carry an idempotency key')
  // the execute node must never be marked simulate:true
  assert.notEqual(exec.data.config.simulate, true)
})

test('workflow: top-up amount encoded with reserve decimals', () => {
  const exec = wf.nodes.find((n) => n.id === 'execute-supply')!
  const args = (exec.data.config as { args: unknown[] }).args
  assert.equal(args[0], '0xf8Fb3713D459D7C1018BD0A49D19b4C44290EBE5') // LINK
  assert.equal(args[1], '5000000000000000000') // 5 LINK in wei
})

test('workflow: condition encodes the configured threshold', () => {
  const cond = wf.nodes.find((n) => n.id === 'condition-at-risk')!
  assert.match(String((cond.data.config as { condition: unknown }).condition), /< 1\.5/)
})

test('workflow: name is derived from the position, scoped per user', () => {
  assert.equal(wf.name, `cordon-aave-v3-guardian-${config.positionAddress.toLowerCase().slice(0, 8)}`)
  assert.ok(wf.description.includes(config.positionAddress))
})

test('workflow: deterministic under same config (repeatable build)', () => {
  const again = buildGuardianWorkflow(config)
  assert.deepEqual(JSON.stringify(again), JSON.stringify(wf))
})