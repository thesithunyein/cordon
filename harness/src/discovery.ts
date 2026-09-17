/**
 * Cordon — find real Aave V3 positions, ranked by health factor.
 *
 * Discovery is a library rather than a script body because two callers need the
 * same answer: `scripts/find-at-risk.ts` prints it as a table, and
 * `scripts/rescue-external.ts --auto` acts on it. Keeping one implementation
 * means the command a judge runs to inspect the market is the exact code that
 * chose the position Cordon defended — there is no separate, trusted path.
 *
 * Pure JSON-RPC: no KeeperHub key, no credentials, no writes. Anyone can run it.
 */

import { AAVE_V3_SEPOLIA } from './aave-v3.js'
import { createRpc, mapLimit, readAccount, type RpcClient } from './onchain.js'
import {
  baseToUsd,
  classifyRisk,
  healthFactorOf,
  hasDebt,
  sizeRescue,
  type AccountData,
  type RiskClass,
} from './position-math.js'

export interface DiscoverOptions {
  /** Pool to read. Defaults to the Aave V3 Sepolia Pool. */
  pool?: string
  /** How far back to scan for account-bearing logs. */
  lookbackBlocks?: number
  /** The health factor Cordon would defend at, used to classify rows. */
  hfThreshold?: number
  /** Rescue sizing target: how high a rescue aims to lift the position. */
  targetHf?: number
  /** Drop positions holding less than this much collateral (USD). */
  minCollateralUsd?: number
  /** Parallel `eth_call`s. Public nodes rate-limit aggressively. */
  concurrency?: number
  /**
   * Initial `eth_getLogs` window; halved on retry when a node caps results.
   * Kept deliberately small: a capped response is truncated rather than refused
   * by most providers, so a large window under-covers without saying so.
   */
  logChunkBlocks?: number
  /** Addresses to skip (our own position, known dust). */
  exclude?: string[]
}

/** One scored account. Health factor is the sort key everywhere below. */
export interface CandidateRow {
  address: string
  risk: RiskClass
  healthFactor: number
  collateralUsd: number
  debtUsd: number
  liquidationThreshold: number
  /** Base-currency USD that repaying debt would need to reach the sizing target. */
  repayToTargetUsd: number
  /** Base-currency USD that supplying collateral would need to reach it. */
  supplyToTargetUsd: number
}

export interface DiscoveryResult {
  pool: string
  latestBlock: number
  fromBlock: number
  lookbackBlocks: number
  hfThreshold: number
  targetHf: number
  minCollateralUsd: number
  /** Accounts named by recent Pool logs — the scan's input, before reading. */
  candidates: string[]
  /**
   * How the log scan went. Discovery is only as trustworthy as its coverage, and
   * a node that caps result sets returns fewer logs rather than an error — so the
   * scan reports what it actually did instead of leaving it invisible.
   */
  logScan: LogScanStats
  /** Candidates that carry debt (all risk classes, including dust). */
  rows: CandidateRow[]
  /** Actionable subset: HF below the sizing target with real collateral. */
  worthDefending: CandidateRow[]
  counts: Record<RiskClass, number> & { candidates: number; withDebt: number }
}

function positive(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback
}

/**
 * Collect candidate accounts from recent Pool logs.
 *
 * Deliberately event-shape agnostic: which topic index holds the account differs
 * between Borrow, Supply, Repay and Withdraw. We take every address-shaped topic
 * from account-bearing logs and let `getUserAccountData` be the judge — a wrong
 * guess costs one cheap `eth_call`, whereas a hand-guessed event signature that
 * is subtly wrong would silently return nothing, which is worse.
 *
 * Logs with 4 topics carry three indexed params (Borrow/Supply/Repay/Withdraw);
 * logs with 2 carry one (ReserveDataUpdated) and only ever name a reserve, so
 * they are skipped unless nothing else is available.
 */
/** Log counts a node is likely to cap at rather than error on. */
const SUSPECT_LOG_COUNTS = new Set([10_000, 5_000, 2_000, 1_000, 500, 100])

export interface LogScanStats {
  /** `eth_getLogs` windows requested. */
  chunks: number
  /** Windows a node refused and we retried with a halved range. */
  retries: number
  /** Smallest window that was needed to get a chunk through. */
  smallestChunk: number
  /** Most logs any single window returned — a round number here is a node cap. */
  maxLogsInChunk: number
  logs: number
}

export interface CandidateScan {
  accounts: string[]
  stats: LogScanStats
}

export async function collectCandidates(
  rpc: RpcClient,
  pool: string,
  fromBlock: number,
  toBlock: number,
  initialChunk = 2_000,
): Promise<CandidateScan> {
  const accountBearing = new Set<string>()
  const anyAddress = new Set<string>()
  let chunk = initialChunk
  let start = fromBlock
  let chunks = 0
  let retries = 0
  let logCount = 0
  let maxLogsInChunk = 0
  let smallestChunk = initialChunk
  let capHalvings = 0

  while (start <= toBlock) {
    const end = Math.min(start + chunk - 1, toBlock)
    let logs: { topics: string[] }[]
    try {
      logs = await rpc.getLogs({
        address: pool,
        fromBlock: '0x' + start.toString(16),
        toBlock: '0x' + end.toString(16),
      })
    } catch (err) {
      // Nodes cap the result set; halve the window and retry until it fits.
      if (chunk > 1) {
        chunk = Math.max(1, Math.floor(chunk / 2))
        retries += 1
        smallestChunk = Math.min(smallestChunk, chunk)
        continue
      }
      throw err
    }
    chunks += 1

    // A window returning a suspiciously round number of logs is far more likely
    // to be a node's result cap than the shape of the market, and a truncated
    // window silently costs us candidates — which is the one failure discovery
    // cannot tolerate, since the ranking would then be built on partial input.
    // Halve the window and rescan, a bounded number of times, before trusting it.
    if (SUSPECT_LOG_COUNTS.has(logs.length) && chunk > 1 && capHalvings < 6) {
      capHalvings += 1
      retries += 1
      chunk = Math.max(1, Math.floor(chunk / 2))
      smallestChunk = Math.min(smallestChunk, chunk)
      continue
    }

    logCount += logs.length
    maxLogsInChunk = Math.max(maxLogsInChunk, logs.length)

    for (const log of logs) {
      const addresses: string[] = []
      for (const topic of log.topics.slice(1, 4)) {
        if (topic.length !== 66) continue
        const address = '0x' + topic.slice(26)
        if (/^0x0{40}$/.test(address)) continue
        if (address.toLowerCase() === pool.toLowerCase()) continue
        addresses.push(address)
      }
      for (const address of addresses) {
        anyAddress.add(address)
        if (log.topics.length === 4) accountBearing.add(address)
      }
    }
    start = end + 1
  }

  return {
    accounts: [...(accountBearing.size > 0 ? accountBearing : anyAddress)],
    stats: { chunks, retries, smallestChunk, maxLogsInChunk, logs: logCount },
  }
}

/** Read and score every candidate. Reuses the caller's RPC client. */
export async function discoverAtRisk(rpc: RpcClient, options: DiscoverOptions = {}): Promise<DiscoveryResult> {
  const pool = options.pool ?? AAVE_V3_SEPOLIA.pool
  const lookbackBlocks = positive(options.lookbackBlocks, 30_000)
  const hfThreshold = positive(options.hfThreshold, 1.6)
  const targetHf = positive(options.targetHf, 2.0)
  const minCollateralUsd = positive(options.minCollateralUsd, 25)
  const  concurrency = positive(options.concurrency, 6)
  const chunk = positive(options.logChunkBlocks, 2_000)

  const excluded = new Set(
    (options.exclude ?? [])
      .map((a) => (a ?? '').trim().toLowerCase())
      .filter((a) => /^0x[0-9a-f]{40}$/.test(a)),
  )

  const latestBlock = await rpc.blockNumber()
  const fromBlock = Math.max(0, latestBlock - lookbackBlocks)
  const scan = await collectCandidates(rpc, pool, fromBlock, latestBlock, chunk)
  const candidates = scan.accounts.filter((a) => !excluded.has(a.toLowerCase()))

  const accounts = await mapLimit(candidates, concurrency, async (address) => ({
    address,
    account: (await readAccount(rpc, address, pool)) as AccountData | null,
  }))

  const rows: CandidateRow[] = []
  for (const { address, account } of accounts) {
    if (!account || !hasDebt(account)) continue
    const sizing = sizeRescue(account, targetHf)
    rows.push({
      address,
      risk: classifyRisk(account, hfThreshold),
      healthFactor: healthFactorOf(account),
      collateralUsd: baseToUsd(account.collateralBase),
      debtUsd: baseToUsd(account.debtBase),
      liquidationThreshold: sizing.liquidationThreshold,
      repayToTargetUsd: sizing.repayUsd,
      supplyToTargetUsd: sizing.supplyUsd,
    })
  }

  const byRisk = (risk: RiskClass) => rows.filter((r) => r.risk === risk)
  const worthDefending = rows
    .filter((r) => (r.risk === 'at-risk' || r.risk === 'near-risk') && r.collateralUsd >= minCollateralUsd)
    .sort((a, b) => a.healthFactor - b.healthFactor)

  return {
    pool,
    latestBlock,
    fromBlock,
    lookbackBlocks,
    hfThreshold,
    targetHf,
    minCollateralUsd,
    candidates,
    logScan: scan.stats,
    rows,
    worthDefending,
    counts: {
      candidates: candidates.length,
      withDebt: rows.length,
      'at-risk': byRisk('at-risk').length,
      'near-risk': byRisk('near-risk').length,
      liquidatable: byRisk('liquidatable').length,
      'bad-debt': byRisk('bad-debt').length,
      healthy: byRisk('healthy').length,
    },
  }
}

/** Convenience wrapper: connect, discover, return. */
export async function discover(options: DiscoverOptions = {}): Promise<DiscoveryResult> {
  return discoverAtRisk(createRpc(), options)
}

/**
 * The position Cordon should defend.
 *
 * Lowest health factor wins, with two guards that matter in practice on Sepolia:
 * a floor on collateral (so a rescue is not spent on dust) and a ceiling on the
 * size of the gift. `maxRescueUsd` exists because a position can be genuinely
 * at-risk and still need more value than the treasury holds to become safe —
 * defending it partially would spend funds without removing the risk, which is
 * the opposite of the promise. Skipping it and taking the next candidate is the
 * honest choice, and the caller can report why.
 */
export function pickRescueTarget(
  result: DiscoveryResult,
  options: {
    minCollateralUsd?: number
    maxHealthFactor?: number
    maxRescueUsd?: number
    /**
     * Which lever the cost ceiling is checked against. `cheapest` uses the smaller
     * of the two, for the case where the caller will take whichever is cheaper.
     */
    strategy?: 'repay' | 'supply' | 'cheapest'
  } = {},
): { target: CandidateRow | null; reason: string; skipped: { address: string; reason: string }[] } {
  const minCollateralUsd = positive(options.minCollateralUsd, result.minCollateralUsd)
  const maxHealthFactor = positive(options.maxHealthFactor, 1.6)
  const maxRescueUsd = options.maxRescueUsd !== undefined && options.maxRescueUsd > 0 ? options.maxRescueUsd : Number.POSITIVE_INFINITY
  const strategy = options.strategy ?? 'supply'

  const skipped: { address: string; reason: string }[] = []
  for (const row of result.worthDefending) {
    if (row.healthFactor >= maxHealthFactor) {
      skipped.push({ address: row.address, reason: `HF ${row.healthFactor.toFixed(4)} is not below ${maxHealthFactor}` })
      continue
    }
    if (row.collateralUsd < minCollateralUsd) {
      skipped.push({ address: row.address, reason: `collateral $${row.collateralUsd.toFixed(2)} is below $${minCollateralUsd}` })
      continue
    }
    const cost =
      strategy === 'repay'
        ? row.repayToTargetUsd
        : strategy === 'supply'
          ? row.supplyToTargetUsd
          : Math.min(row.repayToTargetUsd, row.supplyToTargetUsd)
    if (cost > maxRescueUsd) {
      skipped.push({
        address: row.address,
        reason: `the cheapest rescue would cost $${cost.toFixed(2)}, above the $${maxRescueUsd} ceiling`,
      })
      continue
    }
    return { target: row, reason: `HF ${row.healthFactor.toFixed(4)} is the lowest actionable position`, skipped }
  }

  return {
    target: null,
    reason:
      result.worthDefending.length === 0
        ? 'no organic position in this window carries debt with real collateral'
        : `all ${result.worthDefending.length} candidates were skipped by the selection guards`,
    skipped,
  }
}
