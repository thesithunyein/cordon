/**
 * Cordon — KeeperHub MCP client.
 *
 * A typed wrapper over KeeperHub's hosted MCP server
 * (https://app.keeperhub.com/mcp, Bearer kh_ auth).
 *
 * Validated against the live API on 2026-09-08:
 *  - handshake: initialize → notifications/initialized → Mcp-Session-Id header
 *  - tools called via tools/call { name, arguments }
 *  - execute_contract_call uses snake_case: contract_address, chain_id,
 *    function_name, function_args (JSON string), simulate
 *  - simulate:true returns a 400-style tool error with wouldRevert + failureKind
 *  - execute_protocol_action: actionType + params object (+ idempotency_key)
 *
 * The safe first-write sequence (per KeeperHub docs):
 *   1. simulate: true  → estimate gas, catch reverts, no broadcast
 *   2. gate on success && !wouldRevert
 *   3. repeat with simulate omitted + a unique idempotency_key
 *   4. poll get_direct_execution_status with bounded backoff
 */

export interface MCPCallResult {
  isError: boolean
  text: string
  data?: Record<string, unknown>
}

export interface SimulationResult {
  success: boolean
  wouldRevert: boolean
  error?: string
}

export interface ExecutionStatus {
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'simulated'
  transactionHash?: string
  executionId?: string
  error?: string
}

export class KeeperHubClient {
  private readonly endpoint: string
  private readonly apiKey: string
  private sessionId: string | null = null
  private initialized = false

  /**
   * Drills inject transient upstream failures (429 / 5xx / network drop) to
   * prove the guardian recovers without human help. Retry is safe here:
   * reads are idempotent and writes carry idempotency keys, so KeeperHub
   * dedupes a replayed request. Bounded, with exponential backoff + jitter.
   */
  private maxRetries = 3
  private baseDelayMs = 400

  constructor(apiKey: string, endpoint = 'https://app.keeperhub.com/mcp') {
    this.apiKey = apiKey
    this.endpoint = endpoint
  }

  /** Test hook: shrink the backoff so failure drills stay fast. */
  setBackoff(maxRetries: number, baseDelayMs: number): void {
    this.maxRetries = maxRetries
    this.baseDelayMs = baseDelayMs
  }

  private async request(
    method: string,
    params: Record<string, unknown>,
    isNotification = false,
  ): Promise<{ status: number; headers: Headers; text: string }> {
    let lastErr: Error | null = null
    let lastStatus = 0
    let lastBody = ''

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const res = await this.rawRequest(method, params, isNotification)
        // Only transient server-side failures are worth a retry. A 4xx other
        // than 429 (auth, bad request, simulation revert) is deterministic:
        // replaying it would fail identically, so surface it immediately.
        const retriable = res.status === 429 || res.status >= 500
        if (!retriable) return res
        lastStatus = res.status
        lastBody = res.text.slice(0, 300)
      } catch (err) {
        // Network drop / connection refused: transient by nature.
        lastErr = err instanceof Error ? err : new Error(String(err))
      }
      if (attempt < this.maxRetries) {
        const backoff = this.baseDelayMs * 2 ** attempt + Math.random() * 0.25 * this.baseDelayMs
        await new Promise((r) => setTimeout(r, backoff))
      }
    }

    if (lastErr) throw lastErr
    return { status: lastStatus, headers: new Headers(), text: lastBody }
  }

  protected async rawRequest(
    method: string,
    params: Record<string, unknown>,
    isNotification: boolean,
  ): Promise<{ status: number; headers: Headers; text: string }> {
    const headers = new Headers({
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${this.apiKey}`,
    })
    if (this.sessionId) headers.set('Mcp-Session-Id', this.sessionId)

    const body = isNotification
      ? JSON.stringify({ jsonrpc: '2.0', method, params })
      : JSON.stringify({ jsonrpc: '2.0', id: 1, method, params })

    const res = await fetch(this.endpoint, { method: 'POST', headers, body })
    const sid = res.headers.get('mcp-session-id')
    if (sid) this.sessionId = sid
    return { status: res.status, headers: res.headers, text: await res.text() }
  }

  /** MCP handshake: initialize → notifications/initialized (sequential). */
  async ensureInitialized(): Promise<void> {
    if (this.initialized) return
    const init = await this.request('initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'cordon', version: '0.1.0' },
    })
    if (init.status !== 200) {
      throw new Error(`MCP initialize failed: ${init.status} ${init.text.slice(0, 300)}`)
    }
    await this.request('notifications/initialized', {}, true)
    this.initialized = true
  }

  /** Call a KeeperHub MCP tool. */
  async callTool(name: string, args: Record<string, unknown>): Promise<MCPCallResult> {
    await this.ensureInitialized()
    const res = await this.request('tools/call', { name, arguments: args })
    if (res.status !== 200) {
      // simulate failures surface as 400 with wouldRevert in the body
      let wouldRevert = false
      try {
        const parsed = JSON.parse(res.text)
        wouldRevert = JSON.stringify(parsed).includes('wouldRevert')
      } catch {
        /* keep raw */
      }
      return { isError: true, text: res.text, data: wouldRevert ? { wouldRevert: true } : undefined }
    }

    let json: any
    try {
      json = JSON.parse(res.text)
    } catch {
      return { isError: true, text: res.text }
    }
    if (json.error) return { isError: true, text: JSON.stringify(json.error) }

    const content = json.result?.content ?? []
    const texts = content
      .filter((c: any) => c.type === 'text')
      .map((c: any) => c.text)
      .join('\n')

    let data: Record<string, unknown> | undefined
    const structured = content.find((c: any) => c.type === 'text')
    if (structured?.text) {
      try {
        data = JSON.parse(structured.text)
      } catch {
        /* keep raw text */
      }
    }

    return { isError: json.result?.isError === true || content.some((c: any) => c.type === 'text' && c.text?.startsWith('Error')), text: texts, data }
  }

  /** Step 1+2 of the safe write: simulate and gate. Returns the raw gate result. */
  async simulateContractCall(args: {
    chainId: string
    contractAddress: string
    functionName: string
    functionArgs: string // JSON array string
  }): Promise<SimulationResult> {
    const r = await this.callTool('execute_contract_call', {
      chain_id: args.chainId,
      contract_address: args.contractAddress,
      function_name: args.functionName,
      function_args: args.functionArgs,
      simulate: true,
    })
    if (r.isError) {
      // wouldRevert comes back in the error body
      const wouldRevert = r.data?.wouldRevert === true || /wouldRevert/i.test(r.text)
      const revertMatch = r.text.match(/"revertReason":"([^"]+)"/)
      return {
        success: false,
        wouldRevert,
        error: revertMatch ? revertMatch[1] : r.text.slice(0, 200),
      }
    }
    // Simulation succeeded without revert
    const sim = r.data as Record<string, unknown> | undefined
    if (sim && sim.wouldRevert === true) {
      return { success: false, wouldRevert: true, error: String(sim.revertReason ?? 'simulated revert') }
    }
    return { success: true, wouldRevert: false }
  }

  /** Execute a native protocol action (e.g. aave-v3/supply) with idempotency. */
  async executeProtocolAction(args: {
    actionType: string
    params: Record<string, string>
    idempotencyKey: string
  }): Promise<{ executionId?: string; txHash?: string; data?: Record<string, unknown> }> {
    const r = await this.callTool('execute_protocol_action', {
      actionType: args.actionType,
      params: args.params,
      idempotency_key: args.idempotencyKey,
    })
    if (r.isError) throw new Error(`execute_protocol_action failed: ${r.text}`)
    const data = r.data ?? {}
    return {
      executionId: (data.executionId ?? data.execution_id ?? data.id) as string | undefined,
      txHash: (data.transactionHash ?? data.txHash) as string | undefined,
      data,
    }
  }

  /** Broadcast a raw contract write with idempotency (fallback path). */
  async executeContractCall(args: {
    chainId: string
    contractAddress: string
    functionName: string
    functionArgs: string
    idempotencyKey: string
  }): Promise<{ executionId: string }> {
    const r = await this.callTool('execute_contract_call', {
      chain_id: args.chainId,
      contract_address: args.contractAddress,
      function_name: args.functionName,
      function_args: args.functionArgs,
      idempotency_key: args.idempotencyKey,
    })
    if (r.isError) throw new Error(`execute_contract_call failed: ${r.text}`)
    const data = r.data ?? {}
    const id = (data.executionId ?? data.execution_id ?? data.id) as string | undefined
    if (!id) throw new Error(`No execution id in response: ${r.text}`)
    return { executionId: String(id) }
  }

  /** Poll a direct execution to terminal state with bounded backoff. */
  async pollExecution(
    executionId: string,
    opts: { maxWaitMs?: number; intervalMs?: number } = {},
  ): Promise<ExecutionStatus> {
    const maxWaitMs = opts.maxWaitMs ?? 180_000
    const intervalMs = opts.intervalMs ?? 5_000
    const deadline = Date.now() + maxWaitMs

    for (;;) {
      const r = await this.callTool('get_direct_execution_status', { execution_id: executionId })
      if (r.isError) throw new Error(`get_direct_execution_status failed: ${r.text}`)
      const data = r.data as Record<string, unknown> | undefined
      const exec = (data?.execution ?? data) as Record<string, unknown> | undefined
      const status = String(data?.status ?? exec?.status ?? 'pending')
      const tx = (data?.transactionHash ?? exec?.transactionHash ?? exec?.txHash) as string | undefined

      if (status === 'completed' || status === 'succeeded') {
        return { status: 'completed', transactionHash: tx, executionId }
      }
      if (status === 'failed' || status === 'cancelled' || status === 'error') {
        return { status: 'failed', error: r.text, executionId }
      }
      if (Date.now() > deadline) {
        throw new Error(`Timed out polling execution ${executionId} (last status: ${status})`)
      }
      await sleep(intervalMs)
    }
  }

  /** Full safe write via raw contract call: simulate → gate → execute → poll. */
  async safeContractWrite(args: {
    chainId: string
    contractAddress: string
    functionName: string
    functionArgs: string
    idempotencyKey: string
  }): Promise<{ txHash?: string; status: ExecutionStatus['status']; refused: boolean; error?: string }> {
    const sim = await this.simulateContractCall(args)
    if (!sim.success || sim.wouldRevert) {
      return { status: 'failed', refused: true, error: sim.error ?? 'simulation reverted' }
    }
    const { executionId } = await this.executeContractCall(args)
    const result = await this.pollExecution(executionId)
    return {
      txHash: result.transactionHash,
      status: result.status,
      refused: false,
      error: result.error,
    }
  }

  /** Full safe write via native protocol action: simulate via contract call → execute via action → poll. */
  async safeProtocolWrite(args: {
    actionType: string
    params: Record<string, string>
    idempotencyKey: string
    /** simulate the underlying calldata first */
    simulate?: { chainId: string; contractAddress: string; functionName: string; functionArgs: string }
  }): Promise<{ txHash?: string; status: ExecutionStatus['status']; refused: boolean; error?: string; executionId?: string }> {
    if (args.simulate) {
      const sim = await this.simulateContractCall(args.simulate)
      if (!sim.success || sim.wouldRevert) {
        return { status: 'failed', refused: true, error: sim.error ?? 'simulation reverted' }
      }
    }
    const executed = await this.executeProtocolAction({
      actionType: args.actionType,
      params: args.params,
      idempotencyKey: args.idempotencyKey,
    })
    if (executed.txHash) return { txHash: executed.txHash, status: 'completed', refused: false, executionId: executed.executionId }
    if (!executed.executionId) {
      // the action returned a synchronous result (read-like) — completed
      return { status: 'completed', refused: false, executionId: undefined }
    }
    const result = await this.pollExecution(executed.executionId)
    return {
      txHash: result.transactionHash,
      status: result.status,
      refused: false,
      error: result.error,
      executionId: result.executionId,
    }
  }
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}