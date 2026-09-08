#!/usr/bin/env node
/**
 * Cordon — verify every receipt against a public Sepolia RPC.
 *
 *   node scripts/verify-receipts.mjs
 *
 * For each txHash in receipts/receipts.json, fetches the receipt and prints
 * status + gasUsed. Exits non-zero if any hash fails to verify.
 */

import { readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const RPC = process.env.SEPOLIA_RPC ?? 'https://ethereum-sepolia-rpc.publicnode.com'

async function rpc(method, params) {
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  if (!res.ok) throw new Error(`RPC ${res.status}`)
  const body = await res.json()
  if (body.error) throw new Error(body.error.message)
  return body.result
}

async function main() {
  const file = JSON.parse(await readFile(join(root, 'receipts', 'receipts.json'), 'utf8'))
  const hashes = [...new Set(file.receipts.map((r) => r.txHash).filter(Boolean))]
  if (hashes.length === 0) {
    console.log('No transactions to verify yet — run the campaign first.')
    return
  }
  let ok = 0
  let fail = 0
  for (const hash of hashes) {
    try {
      const receipt = await rpc('eth_getTransactionReceipt', [hash])
      if (!receipt) {
        console.log(`MISSING  ${hash}`)
        fail++
      } else if (receipt.status === '0x1') {
        console.log(`OK       ${hash}  gasUsed=${BigInt(receipt.gasUsed)}`)
        ok++
      } else {
        console.log(`REVERTED ${hash}`)
        fail++
      }
    } catch (err) {
      console.log(`ERROR    ${hash}  ${err.message}`)
      fail++
    }
  }
  console.log(`\n${ok} verified, ${fail} failed`)
  if (fail > 0) process.exit(1)
}

main().catch((err) => {
  console.error(err.message)
  process.exit(1)
})