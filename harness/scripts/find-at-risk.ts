/**
 * Cordon — find real Aave V3 positions on Sepolia, ranked by health factor.
 *
 * Why this exists: Cordon protects positions it does not own. Both `supply` and
 * `repay` accept an `onBehalfOf` argument and Aave credits that account, so no
 * signature from the protected user is required — the only hard part is finding
 * someone worth protecting.
 *
 * Pure JSON-RPC: no KeeperHub key, no new dependencies, runnable by anyone.
 *
 *   npx tsx scripts/find-at-risk.ts                    # ranked table
 *   npx tsx scripts/find-at-risk.ts --top 40 --json    # machine-readable
 *   LOOKBACK_BLOCKS=100000 MIN_COLLATERAL_USD=100 npx tsx scripts/find-at-risk.ts
 *
 * What Sepolia actually looks like, so the result is readable: this market is
 * mostly dust and abandoned debt. A typical run reports hundreds of liquidatable
 * and bad-debt accounts holding pennies, a few dozen positions sitting just
 * above liquidation with real collateral, and a handful of healthy accounts.
 * Positions just above HF 1.0 are usually liquidation-bot fixtures — real
 * on-chain positions, but nobody is home to thank you.
 *
 * Env:
 *   RPC_URL            JSON-RPC endpoint (default: a public Sepolia node)
 *   LOOKBACK_BLOCKS    how far back to scan (default 30000, ~4 days)
 *   HF_THRESHOLD       the threshold Cordon would defend at (default 1.6)
 *   TARGET_HF          rescue sizing target (default 2.0)
 *   MIN_COLLATERAL_USD ignore positions holding less than this (default 25)
 *   CONCURRENCY        parallel eth_calls (default 6; public nodes are shared)
 *   POSITION_ADDRESS   optional: excluded from results (your own position)
 *   EXCLUDE            optional comma-separated addresses to skip
 */

import { AAVE_V3_SEPOLIA } from '../src/aave-v3.js'
import { createRpc, mapLimit, readAccount, type RpcClient } from '../src/onchain.js'
import {
  baseToUsd,
  classifyRisk,
  healthFactorOf,
  hasDebt,
  sizeRescue,
  type RiskClass,
} from '../src/position-math.js'

const POOL = process.env.POOL_ADDRESS ?? AAVE_V3_SEPOLIA.pool
const LOOKBACK_BLOCKS = numberEnv('LOOKBACK_BLOCKS', 30_000)
const HF_THRESHOLD = numberEnv('HF_THRESHOLD', 1.6)
const TARGET_HF = numberEnv('TARGET_HF', 2.0)
const MIN_COLLATERAL_USD = numberEnv('MIN_COLLATERAL_USD', 25)
const CONCURRENCY = numberEnv('CONCURRENCY', 6)
const CHUNK = numberEnv('LOG_CHUNK_BLOCKS', 10_000)

function numberEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw.trim() === '') return fallback
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

/**
 * Collect candidate accounts from recent Pool logs.
 *
 * Deliberately event-shape agnostic: which topic index holds the account differs
 * between Borrow, Supply, Repay and Withdraw. We take every address-shaped topic
 * from account-bearing logs and let `getUserAccountData` be the judge — a wrong
 * guess costs one cheap eth_call, whereas a hand-guessed event signature that is
 * subtly wrong would silently return nothing, which is worse.
 *
 * Logs with 4 topics carry three indexed params (Borrow/Supply/Repay/Withdraw);
 * logs with 2 carry one (ReserveDataUpdated) and only ever name a reserve, so
 * they are skipped unless nothing else is available.
 */
async function collectCandidates(rpc: RpcClient, fromBlock: number, toBlock: number): Promise<string[]> {
  const accountBearing = new Set<string>()
  const anyAddress = new Set<string>()
  let chunk = CHUNK
  let start = fromBlock

  while (start <= toBlock) {
    const end = Math.min(start + chunk - 1, toBlock)
    let logs: { topics: string[] }[]
    try {
      logs = await rpc.getLogs({
        address: POOL,
        fromBlock: '0x' + start.toString(16),
        toBlock: '0x' + end.toString(16),
      })
    } catch (err) {
      // Nodes cap the result set; halve the window and retry until it fits.
      if (chunk > 1) {
        chunk = Math.max(1, Math.floor(chunk / 2))
        continue
      }
      throw err
    }

    for (const log of logs) {
      const addresses: string[] = []
      for (const topic of log.topics.slice(1, 4)) {
        if (topic.length !== 66) continue
        const address = '0x' + topic.slice(26)
        if (/^0x0{40}$/.test(address)) continue
        if (address.toLowerCase() === POOL.toLowerCase()) continue
        addresses.push(address)
      }
      for (const address of addresses) {
        anyAddress.add(address)
        if (log.topics.length === 4) accountBearing.add(address)
      }
    }
    start = end + 1
  }

  return [...(accountBearing.size > 0 ? accountBearing : anyAddress)]
}

interface Row {
  address: string
  risk: RiskClass
  healthFactor: number
  collateralUsd: number
  debtUsd: number
  liquidationThreshold: number
  repayToTargetUsd: number
  supplyToTargetUsd: number
}

const fmtUsd = (n: number): string => (n >= 1000 ? n.toFixed(0) : n.toFixed(2))

async function main() {
  const topIndex = process.argv.indexOf('--top')
  const top = topIndex !== -1 ? Number(process.argv[topIndex + 1]) : 15
  const asJson = process.argv.includes('--json')

  const excluded = new Set(
    [process.env.POSITION_ADDRESS, ...(process.env.EXCLUDE ?? '').split(',')]
      .map((a) => (a ?? '').trim().toLowerCase())
      .filter((a) => /^0x[0-9a-f]{40}$/.test(a)),
  )

  const rpc = createRpc()
  const latest = await rpc.blockNumber()
  const from = Math.max(0, latest - LOOKBACK_BLOCKS)

  if (!asJson) {
    console.log('\nCordon — Aave V3 position finder')
    console.log(`Pool:       ${POOL}`)
    console.log(`RPC:        ${rpc.url}`)
    console.log(`Blocks:     ${from} → ${latest} (${LOOKBACK_BLOCKS} scanned)`)
    console.log(`Threshold:  HF ${HF_THRESHOLD} | sizing target HF ${TARGET_HF} | min collateral $${MIN_COLLATERAL_USD}\n`)
  }

  const candidates = (await collectCandidates(rpc, from, latest)).filter((a) => !excluded.has(a.toLowerCase()))
  const accounts = await mapLimit(candidates, CONCURRENCY, async (address) => ({
    address,
    account: await readAccount(rpc, address, POOL),
  }))

  const rows: Row[] = []
  for (const { address, account } of accounts) {
    if (!account || !hasDebt(account)) continue
    const sizing = sizeRescue(account, TARGET_HF)
    rows.push({
      address,
      risk: classifyRisk(account, HF_THRESHOLD),
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
    .filter((r) => (r.risk === 'at-risk' || r.risk === 'near-risk') && r.collateralUsd >= MIN_COLLATERAL_USD)
    .sort((a, b) => a.healthFactor - b.healthFactor)

  if (asJson) {
    console.log(
      JSON.stringify(
        {
          pool: POOL,
          latestBlock: latest,
          lookbackBlocks: LOOKBACK_BLOCKS,
          hfThreshold: HF_THRESHOLD,
          targetHf: TARGET_HF,
          minCollateralUsd: MIN_COLLATERAL_USD,
          counts: {
            candidates: candidates.length,
            withDebt: rows.length,
            atRisk: byRisk('at-risk').length,
            nearRisk: byRisk('near-risk').length,
            liquidatable: byRisk('liquidatable').length,
            badDebt: byRisk('bad-debt').length,
            healthy: byRisk('healthy').length,
          },
          worthDefending,
          all: rows.sort((a, b) => a.healthFactor - b.healthFactor),
        },
        null,
        2,
      ),
    )
    return
  }

  console.log(`Candidate accounts: ${candidates.length}`)
  console.log(`Accounts carrying debt: ${rows.length}`)
  console.log('')
  console.log('  risk class    accounts')
  console.log('  ' + '-'.repeat(24))
  for (const risk of ['at-risk', 'near-risk', 'liquidatable', 'bad-debt', 'healthy'] as RiskClass[]) {
    console.log(`  ${risk.padEnd(13)} ${String(byRisk(risk).length).padStart(8)}`)
  }

  if (worthDefending.length === 0) {
    console.log('\nNo organic position is worth defending in this window.')
    console.log('Everything carrying debt is either dust, already liquidatable, or bad debt.')
    console.log('Widen the scan (LOOKBACK_BLOCKS=200000) or lower MIN_COLLATERAL_USD to see the dust.')
  } else {
    console.log(`\nWorth defending (collateral ≥ $${MIN_COLLATERAL_USD}, HF < 2.0):`)
    console.log('    health   collateral        debt   liq.thr      size→' + TARGET_HF + '    address')
    console.log('    ' + '-'.repeat(92))
    for (const r of worthDefending.slice(0, top)) {
      console.log(
        `${r.risk === 'at-risk' ? '!' : ' '}  ${r.healthFactor.toFixed(4).padStart(7)}` +
          `  ${fmtUsd(r.collateralUsd).padStart(12)}  ${fmtUsd(r.debtUsd).padStart(11)}` +
          `  ${(r.liquidationThreshold * 100).toFixed(1).padStart(6)}%` +
          `  ${fmtUsd(r.repayToTargetUsd).padStart(10)}   ${r.address}`,
      )
    }
    console.log('\n  `!` = below your HF threshold. size→' + TARGET_HF + ' is base-currency USD to reach HF ' + TARGET_HF + '.')
    const best = worthDefending[0]
    console.log('\nBest candidate:')
    console.log(`  RESCUE_TARGET=${best.address}`)
    console.log(`  HF ${best.healthFactor.toFixed(4)} | collateral $${fmtUsd(best.collateralUsd)} | debt $${fmtUsd(best.debtUsd)}`)
    console.log(`  To reach HF ${TARGET_HF}: repay $${fmtUsd(best.repayToTargetUsd)} of debt, or supply $${fmtUsd(best.supplyToTargetUsd)} of collateral.`)
    console.log('  Both are gifts to the receiver and cannot be taken back.')
    console.log(`\n  Defend it through KeeperHub (preview first, then drop --preview):`)
    console.log(`    RESCUE_TARGET=${best.address} npm run rescue -- --preview`)
  }
  console.log('')
}

main().catch((err) => {
  console.error(`\nfind-at-risk failed: ${err.message}`)
  process.exit(1)
})
