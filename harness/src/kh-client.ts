/**
 * Cordon — KeeperHub MCP client.
 *
 * A thin, typed wrapper over KeeperHub's hosted MCP server
 * (https://app.keeperhub.com/mcp, Bearer kh_ auth).
 *
 * The safe first-write sequence (per KeeperHub docs):
 *   1. simulate: true  → estimate gas, catch reverts, no broadcast
 *   2. gate on success && !wouldRevert
 *   3. repeat with simulate omitted + a unique idempotency_key
 *   4. poll get_direct_execution_status with bounded backoff
 *
 * Tools used: execute_contract_call, get_direct_execution_status,
 * execute_workflow, get_execution, create_workflow.
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
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  transactionHash?: string
  error?: string
}

export class KeeperHubClient {
  private readonly endpoint: string
  private readonly apiKey: string

  constructor(apiKey: string, endpoint = 'https://app.keeperhub.com/mcp') {
    this.apiKey = apiKey
    this.endpoint = endpoint
  }

  /** Call a KeeperHub MCP tool over JSON-RPC. */
  async callTool(name: string, args: Record<string, unknown>): Promise<MCPCallResult> {
    const body = {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name, arguments: args },
    }

    const res = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      throw new Error(`KeeperHub MCP error ${res.status}: ${await res.text()}`)
    }

    // The remote endpoint can answer with either JSON or SSE; JSON is the common case.
    const contentType = res.headers.get('content-type') ?? ''
    const raw = await res.text()
    let json: any
    try {
      json = JSON.parse(raw)
    } catch {
      throw new Error(`KeeperHub MCP returned non-JSON (${contentType}): ${raw.slice(0, 500)}`)
    }

    if (json.error) {
      throw new Error(`KeeperHub MCP rpc error: ${JSON.stringify(json.error)}`)
    }

    const content = json.result?.content ?? []
    const texts = content
      .filter((c: any) => c.type === 'text')
      .map((c: any) => c.text)
      .join('\n')

    const isError = content.some((c: any) => c.type === 'text' && c.text?.startsWith('Error'))
    let data: Record<string, unknown> | undefined
    const structured = content.find((c: any) => c.type === 'text')
    if (structured?.text) {
      try {
        data = JSON.parse(structured.text)
      } catch {
        /* not JSON — keep raw text */
      }
    }

    return { isError, text: texts, data }
  }

  /** Step 1+2 of the safe write: simulate and gate. */
  async simulateContractCall(args: {
    network: string | number
    contractAddress: string
    abi: string
    abiFunction: string
    args?: unknown[]
  }): Promise<SimulationResult> {
    const r = await this.callTool('execute_contract_call', {
      ...args,
      network: String(args.network),
      simulate: true,
    })
    if (r.isError) {
      return { success: false, wouldRevert: true, error: r.text }
    }
    return { success: true, wouldRevert: false }
  }

  /** Step 3 of the safe write: broadcast with idempotency. Returns an execution id. */
  async executeContractCall(args: {
    network: string | number
    contractAddress: string
    abi: string
    abiFunction: string
    args?: unknown[]
    idempotencyKey: string
  }): Promise<{ executionId: string }> {
    const r = await this.callTool('execute_contract_call', {
      ...args,
      network: String(args.network),
      idempotency_key: args.idempotencyKey,
    })
    if (r.isError) throw new Error(`execute_contract_call failed: ${r.text}`)
    const id = r.data?.executionId ?? r.data?.id
    if (!id) throw new Error(`No execution id in response: ${r.text}`)
    return { executionId: String(id) }
  }

  /** Step 4: poll a direct execution to terminal state with bounded backoff. */
  async pollExecution(
    executionId: string,
    opts: { maxWaitMs?: number; intervalMs?: number } = {},
  ): Promise<ExecutionStatus> {
    const maxWaitMs = opts.maxWaitMs ?? 120_000
    const intervalMs = opts.intervalMs ?? 5_000
    const deadline = Date.now() + maxWaitMs

    for (;;) {
      const r = await this.callTool('get_direct_execution_status', { executionId })
      if (r.isError) throw new Error(`get_direct_execution_status failed: ${r.text}`)
      const exec = (r.data?.execution ?? r.data) as Record<string, unknown> | undefined
      const status = (r.data?.status ?? exec?.status) as ExecutionStatus['status']
      const tx = (r.data?.transactionHash ?? exec?.transactionHash ?? exec?.txHash) as string | undefined

      if (status === 'completed') return { status, transactionHash: tx }
      if (status === 'failed' || status === 'cancelled') {
        return { status, error: r.text }
      }
      if (Date.now() > deadline) {
        throw new Error(`Timed out polling execution ${executionId}`)
      }
      await sleep(intervalMs)
    }
  }

  /** Full safe write: simulate → gate → execute → poll → receipt. */
  async safeContractWrite(args: {
    network: string | number
    contractAddress: string
    abi: string
    abiFunction: string
    args?: unknown[]
    idempotencyKey: string
  }): Promise<{ txHash?: string; status: ExecutionStatus['status']; refused: boolean; error?: string }> {
    const sim = await this.simulateContractCall(args)
    if (!sim.success || sim.wouldRevert) {
      return {
        status: 'failed',
        refused: true,
        error: sim.error ?? 'simulation reverted',
      }
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
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}