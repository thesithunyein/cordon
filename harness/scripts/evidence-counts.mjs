#!/usr/bin/env node
/**
 * Cordon — the canonical evidence figures.
 *
 * One command prints every number the README, the live audit stream and the
 * submission form quote. If a figure anywhere disagrees with this output, this
 * output is right: it is derived from `harness/receipts/receipts.json`, and the
 * hashes in that file are the only claims that matter.
 *
 *   node scripts/evidence-counts.mjs
 *   node scripts/evidence-counts.mjs --json
 *
 * The refusals line reports protective refusals and provisioning refusals
 * separately, because the two are easy to conflate and hard to compare later:
 * a protect refusal means a doomed rescue was caught, a provisioning refusal
 * means the position was never funded for the round in the first place.
 */

import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const RECEIPTS_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'receipts', 'receipts.json')
const RAY = 10n ** 18n
/** Aave reports type(uint256).max as the health factor of a debt-free account. */
const NO_DEBT_HF = (1n << 256n) - 1n

const hf = (value) => {
  if (!value) return null
  const raw = BigInt(value)
  if (raw === 0n || raw === NO_DEBT_HF) return null
  return Number(raw) / Number(RAY)
}

const round = (n) => (n === null ? null : Number(n.toFixed(4)))

async function main() {
  const file = JSON.parse(await readFile(RECEIPTS_PATH, 'utf8'))
  const rows = file.receipts
  const decision = (name) => rows.filter((r) => r.decision === name)
  const executed = rows.filter((r) => r.txHash)
  const hashes = executed.map((r) => r.txHash)
  const refused = rows.filter((r) => r.refused)
  const protectRefusals = refused.filter((r) => r.decision === 'protect')
  const provisioningRefusals = refused.filter((r) => r.decision !== 'protect')
  const withExecutionId = rows.filter((r) => r.executionId)
  const rescues = rows.filter((r) => r.type === 'rescue')
  // The range Cordon quotes is lowest reading we ever acted on (before) to the
  // highest reading we ever produced (after).
  const healthFactorsBefore = rows.map((r) => hf(r.healthFactorBefore)).filter((v) => v !== null)
  const healthFactorsAfter = rows.map((r) => hf(r.healthFactorAfter)).filter((v) => v !== null)

  const errorClasses = {}
  for (const r of refused) {
    const key = (r.error ?? 'unlabelled').slice(0, 60)
    errorClasses[key] = (errorClasses[key] ?? 0) + 1
  }

  const counts = {
    generatedAt: file.generatedAt,
    receipts: rows.length,
    executions: executed.length,
    executionIds: withExecutionId.length,
    uniqueHashes: new Set(hashes).size,
    duplicateHashes: hashes.length - new Set(hashes).size,
    refusals: refused.length,
    refusalsProtect: protectRefusals.length,
    refusalsProvisioning: provisioningRefusals.length,
    refusalsWithHash: refused.filter((r) => r.txHash).length,
    refusalsWithExecutionId: refused.filter((r) => r.executionId).length,
    standDowns: decision('stand-down').length,
    rescues: rescues.length,
    healthFactorMin: round(Math.min(...healthFactorsBefore)),
    healthFactorsMax: round(Math.max(...healthFactorsAfter)),
    errorClasses,
  }

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(counts, null, 2))
    return
  }

  console.log('\nCordon — evidence figures (from harness/receipts/receipts.json)')
  console.log(`Corpus generated:            ${counts.generatedAt}`)
  console.log(`Receipts:                    ${counts.receipts}`)
  console.log(`Executions (carry a tx):     ${counts.executions}`)
  console.log(`  unique hashes:             ${counts.uniqueHashes}`)
  console.log(`  duplicates:                ${counts.duplicateHashes}  (must be 0)`)
  console.log(`KeeperHub execution ids:     ${counts.executionIds}`)
  console.log(`Refusals (zero gas):         ${counts.refusals}`)
  console.log(`  protective cycles:         ${counts.refusalsProtect}`)
  console.log(`  provisioning cycles:       ${counts.refusalsProvisioning}`)
  console.log(`  carrying a tx hash:        ${counts.refusalsWithHash}  (must be 0)`)
  console.log(`  carrying an execution id:  ${counts.refusalsWithExecutionId}  (must be 0)`)
  console.log(`Stand-downs:                 ${counts.standDowns}`)
  console.log(`Third-party rescues:         ${counts.rescues}`)
  console.log(`Health factor range:         ${counts.healthFactorMin} → ${counts.healthFactorsMax}`)
  console.log('\nRefusal classes:')
  for (const [text, n] of Object.entries(counts.errorClasses).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(3)}  ${text}`)
  }
  console.log('\nRegenerate the site copy with: npm run sync:site\n')
}

main().catch((err) => {
  console.error(`\nevidence-counts failed: ${err.message}`)
  process.exit(1)
})
