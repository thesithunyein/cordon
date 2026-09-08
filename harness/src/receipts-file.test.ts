import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const FILE = join(dirname(fileURLToPath(import.meta.url)), '..', 'receipts', 'receipts.json')
const file = JSON.parse(readFileSync(FILE, 'utf8')) as {
  generatedAt: string
  count: number
  receipts: Array<{
    decision: string
    action?: string
    refused?: boolean
    txHash: string | null
    status: string
    timestamp: string
    position: string
  }>
}

test('receipts.json: count matches the array length', () => {
  assert.equal(file.count, file.receipts.length)
  assert.ok(file.count >= 50, `expected a substantial corpus, got ${file.count}`)
})

test('receipts.json: every row has required fields', () => {
  for (const r of file.receipts) {
    assert.ok(r.timestamp, 'timestamp missing')
    assert.ok(/^0x/.test(r.position), `position missing for ${r.timestamp}`)
    assert.ok(['guard-cycle', 'campaign-execution', 'setup'].includes(r.decision) || r.decision, `bad decision: ${r.decision}`)
    assert.ok(r.status, 'status missing')
  }
})

test('receipts.json: tx hashes are well-formed and unique', () => {
  const hashes = file.receipts.map((r) => r.txHash).filter((h): h is string => h !== null)
  assert.ok(hashes.length >= 30, `expected 30+ on-chain txs, got ${hashes.length}`)
  assert.equal(new Set(hashes).size, hashes.length, 'duplicate tx hash found')
  for (const h of hashes) {
    assert.match(h, /^0x[0-9a-f]{64}$/, `malformed hash: ${h}`)
  }
})

test('receipts.json: refused rows never carry a tx hash', () => {
  for (const r of file.receipts) {
    if (r.refused) assert.equal(r.txHash, null, `refused row has a txHash: ${r.txHash}`)
    if (r.txHash) assert.notEqual(r.refused, true, 'row with txHash marked refused')
  }
})

test('receipts.json: mix of executed, refused and stand-down decisions', () => {
  const executed = file.receipts.filter((r) => r.txHash).length
  const refused = file.receipts.filter((r) => r.refused).length
  const stoodDown = file.receipts.filter((r) => r.decision === 'stand-down').length
  assert.ok(executed > refused, 'execution volume should dominate refusals')
  assert.ok(refused >= 10, `expected documented refusals, got ${refused}`)
  assert.ok(stoodDown >= 20, `expected stand-down history, got ${stoodDown}`)
})