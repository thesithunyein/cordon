/**
 * Cordon — generate the click-to-verify evidence table for the README.
 *
 * Samples executed receipts across the corpus (evenly spaced so every era of
 * the campaign is represented), and prints a markdown table: Etherscan link +
 * KeeperHub execution id + health factor movement per row.
 *
 * Run with: node scripts/evidence-table.mjs [sample-size]
 */

import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const file = JSON.parse(readFileSync(join(root, 'receipts', 'receipts.json'), 'utf8'))
const receipts = file.receipts ?? file

const executed = receipts.filter((r) => r.txHash && r.healthFactorBefore)
const sampleSize = Number(process.argv[2] ?? 20)

if (executed.length === 0) {
  console.error('no executed receipts found')
  process.exit(1)
}

// Evenly spaced sample across the whole corpus
const step = Math.max(1, Math.floor(executed.length / sampleSize))
const sample = []
for (let i = 0; i < executed.length && sample.length < sampleSize; i += step) {
  sample.push(executed[i])
}

const rows = sample.map((r) => {
  const hfBefore = (Number(r.healthFactorBefore) / 1e18).toFixed(2)
  const hfAfter = r.healthFactorAfter ? (Number(r.healthFactorAfter) / 1e18).toFixed(2) : '—'
  const tx = `[${r.txHash.slice(0, 10)}…](https://sepolia.etherscan.io/tx/${r.txHash})`
  const execId = r.executionId ? `\`${r.executionId}\`` : '—'
  return `| ${hfBefore} → ${hfAfter} | ${tx} | ${execId} |`
})

console.log('| Health factor (before → after) | Transaction on Etherscan | KeeperHub execution id |')
console.log('|---|---|---|')
console.log(rows.join('\n'))

// Stats for the spread framing
const hfs = executed.map((r) => Number(r.healthFactorBefore) / 1e18)
const min = Math.min(...hfs)
const max = Math.max(...hfs)
console.error(`\n# spread: ${executed.length} executions, HF range ${min.toFixed(2)} → ${max.toFixed(2)} (${(max / min).toFixed(0)}x)`)
console.error(`# receipts with executionId: ${executed.filter((r) => r.executionId).length}/${executed.length}`)
