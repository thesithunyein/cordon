/**
 * Cordon — find real Aave V3 positions on Sepolia, ranked by health factor.
 *
 * Why this exists: Cordon protects positions it does not own. Both `supply` and
 * `repay` accept an `onBehalfOf` argument and Aave credits that account, so no
 * signature from the protected user is required — the only hard part is finding
 * someone worth protecting.
 *
 * The discovery itself lives in `src/discovery.ts`, because `rescue-external.ts
 * --auto` acts on the same result. This file is only the presentation.
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

import { discoverAtRisk } from '../src/discovery.js'
import type { RiskClass } from '../src/position-math.js'

function numberEnv(name: string, fallback: number): number {
  const raw = process.env[name]
  if (raw === undefined || raw.trim() === '') return fallback
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? n : fallback
}

const fmtUsd = (n: number): string => (n >= 1000 ? n.toFixed(0) : n.toFixed(2))

async function main() {
  const topIndex = process.argv.indexOf('--top')
  const top = topIndex !== -1 ? Number(process.argv[topIndex + 1]) : 15
  const asJson = process.argv.includes('--json')

  const lookbackBlocks = numberEnv('LOOKBACK_BLOCKS', 30_000)
  const result = await discoverAtRisk({
    lookbackBlocks,
    hfThreshold: numberEnv('HF_THRESHOLD', 1.6),
    targetHf: numberEnv('TARGET_HF', 2.0),
    minCollateralUsd: numberEnv('MIN_COLLATERAL_USD', 25),
    concurrency: numberEnv('CONCURRENCY', 6),
    logChunkBlocks: numberEnv('LOG_CHUNK_BLOCKS', 10_000),
    exclude: [process.env.POSITION_ADDRESS ?? '', ...(process.env.EXCLUDE ?? '').split(',')],
  })

  const { worthDefending, counts } = result
  const byRisk = (risk: RiskClass) => counts[risk]

  if (asJson) {
    console.log(
      JSON.stringify(
        {
          pool: result.pool,
          latestBlock: result.latestBlock,
          lookbackBlocks: result.lookbackBlocks,
          hfThreshold: result.hfThreshold,
          targetHf: result.targetHf,
          minCollateralUsd: result.minCollateralUsd,
          counts,
          logScan: result.logScan,
          worthDefending,
          all: [...result.rows].sort((a, b) => a.healthFactor - b.healthFactor),
        },
        null,
        2,
      ),
    )
    return
  }

  if (!asJson) {
    console.log('\nCordon — Aave V3 position finder')
    console.log(`Pool:       ${result.pool}`)
    console.log(`RPC:        ${process.env.RPC_URL ?? '(default public Sepolia node)'}`)
    console.log(`Blocks:     ${result.fromBlock} → ${result.latestBlock} (${result.lookbackBlocks} scanned)`)
    const scan = result.logScan
    console.log(
      `Log scan:   ${scan.chunks} windows, ${scan.logs} logs, largest window returned ${scan.maxLogsInChunk}` +
        (scan.retries > 0 ? ` — ${scan.retries} refused and halved to ${scan.smallestChunk} blocks` : ''),
    )
    console.log(
      `Threshold:  HF ${result.hfThreshold} | sizing target HF ${result.targetHf} | min collateral $${result.minCollateralUsd}\n`,
    )
  }

  console.log(`Candidate accounts: ${counts.candidates}`)
  console.log(`Accounts carrying debt: ${counts.withDebt}`)
  console.log('')
  console.log('  risk class    accounts')
  console.log('  ' + '-'.repeat(24))
  for (const risk of ['at-risk', 'near-risk', 'liquidatable', 'bad-debt', 'healthy'] as RiskClass[]) {
    console.log(`  ${risk.padEnd(13)} ${String(byRisk(risk)).padStart(8)}`)
  }

  if (worthDefending.length === 0) {
    console.log('\nNo organic position is worth defending in this window.')
    console.log('Everything carrying debt is either dust, already liquidatable, or bad debt.')
    console.log('Widen the scan (LOOKBACK_BLOCKS=200000) or lower MIN_COLLATERAL_USD to see the dust.')
  } else {
    console.log(`\nWorth defending (collateral ≥ $${result.minCollateralUsd}, HF < ${result.targetHf}):`)
    console.log('    health   collateral        debt   liq.thr      size→' + result.targetHf + '    address')
    console.log('    ' + '-'.repeat(92))
    for (const r of worthDefending.slice(0, top)) {
      console.log(
        `${r.risk === 'at-risk' ? '!' : ' '}  ${r.healthFactor.toFixed(4).padStart(7)}` +
          `  ${fmtUsd(r.collateralUsd).padStart(12)}  ${fmtUsd(r.debtUsd).padStart(11)}` +
          `  ${(r.liquidationThreshold * 100).toFixed(1).padStart(6)}%` +
          `  ${fmtUsd(r.repayToTargetUsd).padStart(10)}   ${r.address}`,
      )
    }
    console.log('\n  `!` = below your HF threshold. size→' + result.targetHf + ' is base-currency USD to reach HF ' + result.targetHf + '.')
    const best = worthDefending[0]
    console.log('\nBest candidate:')
    console.log(`  RESCUE_TARGET=${best.address}`)
    console.log(`  HF ${best.healthFactor.toFixed(4)} | collateral $${fmtUsd(best.collateralUsd)} | debt $${fmtUsd(best.debtUsd)}`)
    console.log(`  To reach HF ${result.targetHf}: repay $${fmtUsd(best.repayToTargetUsd)} of debt, or supply $${fmtUsd(best.supplyToTargetUsd)} of collateral.`)
    console.log('  Both are gifts to the receiver and cannot be taken back.')
    console.log('\n  Defend it through KeeperHub (preview first, then drop --preview):')
    console.log(`    RESCUE_TARGET=${best.address} npm run rescue -- --preview`)
    console.log('\n  Or let Cordon choose and defend the worst position itself:')
    console.log('    npm run rescue:auto -- --preview')
  }
  console.log('')
}

main().catch((err) => {
  console.error(`\nfind-at-risk failed: ${err.message}`)
  process.exit(1)
})
