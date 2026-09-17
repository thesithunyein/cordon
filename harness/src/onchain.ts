/**
 * Cordon — on-chain reads over plain JSON-RPC.
 *
 * The write path is KeeperHub's (see kh-client.ts). This module is the read
 * side of the tooling: it lets the finder and the rescue path inspect Aave
 * positions and debt without a KeeperHub key, using nothing but `fetch`.
 *
 * Why not read through KeeperHub too? The guardian does — `detect()` goes
 * through the Aave plugin (`aave-v3/get-user-account-data`). But discovery
 * needs reads at a scale KeeperHub is not the right tool for: hundreds of
 * accounts, chunked log scans, bounded concurrency. Those belong on an RPC
 * endpoint, and they keep this tooling runnable by anyone with no credentials.
 */

import { AAVE_V3_SEPOLIA, RESERVES, type ReserveSymbol } from './aave-v3.js'
import { encodeGetUserAccountData, parseAccountData, type AccountData } from './position-math.js'

export const DEFAULT_SEPOLIA_RPC = 'https://ethereum-sepolia-rpc.publicnode.com'

/** ERC-20 balanceOf(address) — stable across every token this tooling touches. */
export const BALANCE_OF_SELECTOR = '0x70a08231'
/** AggregatorInterface.latestAnswer() — the Aave oracle's base-currency price. */
export const LATEST_ANSWER_SELECTOR = '0x50d25bcd'
/** The Aave oracle returns the base currency (USD) with 8 decimals. */
export const ORACLE_DECIMALS = 8

export interface RpcClient {
  url: string
  call<T>(method: string, params: unknown[], attempts?: number): Promise<T>
  blockNumber(): Promise<number>
  getLogs(filter: Record<string, unknown>): Promise<LogEntry[]>
}

export interface LogEntry {
  topics: string[]
  blockNumber: string
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/**
 * A minimal JSON-RPC client with retries. Public nodes drop connections under
 * parallel load and rate-limit eagerly, so every call backs off and retries
 * rather than failing a long scan halfway through.
 */
export function createRpc(url = process.env.RPC_URL ?? DEFAULT_SEPOLIA_RPC): RpcClient {
  const call = async <T,>(method: string, params: unknown[], attempts = 3): Promise<T> => {
    let lastErr: unknown
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        })
        const json = (await res.json()) as { result?: T; error?: { message: string } }
        if (json.error) throw new Error(`${method}: ${json.error.message}`)
        if (json.result === undefined) throw new Error(`${method}: empty result`)
        return json.result
      } catch (err) {
        lastErr = err
        if (attempt < attempts - 1) await sleep(300 * (attempt + 1))
      }
    }
    throw lastErr
  }

  return {
    url,
    call,
    blockNumber: async () => parseInt(await call<string>('eth_blockNumber', []), 16),
    getLogs: (filter) => call<LogEntry[]>('eth_getLogs', [filter]),
  }
}

/** Run an async mapper with bounded concurrency, so public nodes stay healthy. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let cursor = 0
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const i = cursor++
        if (i >= items.length) return
        out[i] = await fn(items[i])
      }
    }),
  )
  return out
}

/** Read one Aave account. Null when the payload is not Aave account data. */
export async function readAccount(
  rpc: RpcClient,
  address: string,
  pool: string = AAVE_V3_SEPOLIA.pool,
): Promise<AccountData | null> {
  try {
    const hex = await rpc.call<string>('eth_call', [{ to: pool, data: encodeGetUserAccountData(address) }, 'latest'])
    return parseAccountData(hex)
  } catch {
    return null
  }
}

/** ERC-20 balance of `owner`, in the token's own units. */
export async function readTokenBalance(rpc: RpcClient, token: string, owner: string): Promise<bigint> {
  const hex = await rpc.call<string>('eth_call', [
    { to: token, data: BALANCE_OF_SELECTOR + owner.slice(2).toLowerCase().padStart(64, '0') },
    'latest',
  ])
  return hex && hex !== '0x' ? BigInt(hex) : 0n
}

/**
 * Base-currency price of a reserve, from the Aave oracle.
 *
 * Needed because rescue sizing is naturally computed in USD (health factor is a
 * ratio of USD totals) while a repay or supply takes token units. Cross-check:
 * for a single-asset position, `debtBase / tokenDebt` equals this price — the
 * two reads validate each other.
 */
export async function readPriceUsd(rpc: RpcClient, symbol: ReserveSymbol): Promise<number> {
  const hex = await rpc.call<string>('eth_call', [{ to: RESERVES[symbol].oracle, data: LATEST_ANSWER_SELECTOR }, 'latest'])
  return Number(BigInt(hex)) / 10 ** ORACLE_DECIMALS
}

export interface DebtPosition {
  symbol: ReserveSymbol
  /** Outstanding debt in the token's human units. */
  amount: number
  /** Outstanding debt in the token's smallest unit. */
  raw: bigint
  underlying: string
}

/**
 * Which reserves an account actually owes, and how much.
 *
 * Read from the reserve's variable debt token (`balanceOf`), which Aave accrues
 * on read — so this is the live debt, not a stale snapshot. This is what makes a
 * repay targeted: repaying the wrong reserve is a revert, not a rescue.
 */
export async function debtsOf(rpc: RpcClient, target: string): Promise<DebtPosition[]> {
  const found: DebtPosition[] = []
  for (const symbol of Object.keys(RESERVES) as ReserveSymbol[]) {
    const reserve = RESERVES[symbol]
    try {
      const raw = await readTokenBalance(rpc, reserve.vToken, target)
      if (raw > 0n) {
        found.push({ symbol, amount: Number(raw) / 10 ** reserve.decimals, raw, underlying: reserve.underlying })
      }
    } catch {
      // A reserve whose debt token cannot be read is simply not a candidate.
    }
  }
  return found.sort((a, b) => b.amount - a.amount)
}
