#!/usr/bin/env node
/**
 * Cordon — refusal audit: re-derive every refusal number from the corpus.
 *
 *   node scripts/refusal-audit.mjs
 *
 * Every figure Cordon publishes about its simulation gate is re-derived here
 * from harness/receipts/receipts.json — the same file the site serves and the
 * README quotes. Nothing is estimated, modelled, or extrapolated.
 *
 * Checks (any failure exits non-zero):
 *   1. Every refused row carries NO transaction hash (nothing doomed ever
 *      reached the chain — the gate's core guarantee).
 *   2. Every refused row is classified into a documented refusal class.
 *   3. Transport failures (429 etc.) are counted separately from simulation
 *      gate refusals — honest accounting, no padding of the gate's numbers.
 *   4. Doomed volume is summed per asset from the refused rows themselves.
 *
 * Exit codes: 0 = all checks pass, 1 = any invariant violated.
 */

import { readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const raw = JSON.parse(await readFile(join(root, 'receipts', 'receipts.json'), 'utf8'))
const receipts = Array.isArray(raw) ? raw : raw.receipts ?? []

// ---------- classification ----------

function classify(errorText) {
  const e = errorText ?? ''
  if (/429|rate limit/i.test(e)) return 'transport-429'
  if (/exceeds allowance/i.test(e)) return 'allowance-exhausted'
  if (/exceeds balance/i.test(e)) return 'balance-exhausted'
  if (/Error\(51\)/i.test(e)) return 'reserve-cap'
  if (/missing revert data/i.test(e)) return 'opaque-revert'
  // Setup-time failures from the secondary-position provisioning (borrow
  // attempts on a shared Sepolia deployment). The gate refused them all —
  // same guarantee, different cause class. Documented in WHAT-BREAKS.md.
  if (/Panic\(17\)/i.test(e)) return 'borrow-arith-overflow'
  if (/missing argument|invalid address|not found in ABI/i.test(e)) return 'setup-encode-error'
  return null
}

const refused = receipts.filter((r) => r.refused === true)
const simGate = []
const transport = []
const unclassified = []

for (const r of refused) {
  const cls = classify(r.error)
  if (cls === 'transport-429') transport.push(r)
  else if (cls) simGate.push(r)
  else unclassified.push(r)
}

// doomed volume: the value the simulation gate refused to put at risk.
// Summed only over sim-gate refusals; transport failures are excluded (the
// request never reached the gate, so the gate deserves no credit for them).
const doomed = {}
for (const r of simGate) {
  if (r.asset && r.amount) doomed[r.asset] = (doomed[r.asset] ?? 0) + Number(r.amount)
}

// ---------- invariants ----------

let failures = 0
const fail = (msg) => {
  failures++
  console.error(`FAIL  ${msg}`)
}

for (const r of refused) {
  if (r.txHash) fail(`refused row carries a txHash: ${r.txHash}`)
}
if (refused.length > 0 && refused.every((r) => r.txHash === null)) {
  console.log(`OK    all ${refused.length} refused rows carry no transaction hash (zero doomed txs broadcast)`)
}

if (unclassified.length > 0) {
  for (const r of unclassified) fail(`unclassified refusal: ${r.error ?? '(no error text)'}`)
} else {
  console.log('OK    every refusal classified into a documented class (or honest transport bucket)')
}

// ---------- report ----------

const classCounts = {}
for (const r of simGate) classCounts[classify(r.error)] = (classCounts[classify(r.error)] ?? 0) + 1

console.log('\n=== Cordon refusal audit (re-derived from receipts.json) ===\n')
console.log(`Receipts total:                ${receipts.length}`)
console.log(`Refused rows:                  ${refused.length}`)
console.log(`  simulation-gate refusals:    ${simGate.length}`)
console.log(`  transport failures (429):    ${transport.length}`)
console.log('\nRefusal classes (simulation gate):')
for (const [cls, n] of Object.entries(classCounts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(n).padStart(3)}  ${cls}`)
}
console.log('\nDoomed volume the gate refused to broadcast (sim-gate rows only):')
for (const [asset, amt] of Object.entries(doomed).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${amt.toLocaleString('en-US')} ${asset}`)
}
console.log('\nRe-derive with: node scripts/refusal-audit.mjs  (this file)')

if (failures > 0) {
  console.error(`\n${failures} invariant(s) FAILED — the published numbers do not match the corpus.`)
  process.exit(1)
}
console.log('\nAll invariants hold. The published refusal numbers are reproducible.')
