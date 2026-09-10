#!/usr/bin/env node
/**
 * Cordon — verify every receipt against Sepolia RPCs.
 *
 *   node scripts/verify-receipts.mjs
 *
 * For each txHash in receipts/receipts.json, fetches the transaction receipt
 * and checks status. Exits non-zero only if a transaction is provably absent
 * or reverted — never for transient RPC problems.
 *
 * Reliability design (CI runs this from GitHub's shared IPs, where public
 * endpoints throttle aggressively):
 *   - JSON-RPC BATCHING: ~50 receipt queries per HTTP request (1,080 txs ≈ 22
 *     round-trips per endpoint instead of 1,080)
 *   - SEVEN public endpoints, picked per round by health: queries spread
 *     across them, a rate-limited endpoint gets a cooldown instead of
 *     poisoning the run, and its batch size adapts down on repeated trouble
 *   - Null receipts (node briefly behind the tip) are re-asked on other
 *     endpoints; "missing" is only concluded when several nodes agree
 *   - Honest summary: VERIFIED / REVERTED / MISSING / UNVERIFIED, where
 *     UNVERIFIED = every endpoint failed for that hash (infrastructure, not
 *     evidence). Fails on any REVERTED/MISSING, and on UNVERIFIED above a
 *     small tolerance — a throttled run can neither fake success nor fake
 *     failure.
 */

import { readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const ENDPOINTS = (process.env.SEPOLIA_RPC ?? [
  'https://ethereum-sepolia-rpc.publicnode.com',
  'https://ethereum-sepolia.publicnode.com',
  'https://eth-sepolia.drpc.org',
  'https://sepolia.drpc.org',
  'https://1rpc.io/sepolia',
  'https://sepolia.gateway.tenderly.co',
  'https://rpc2.sepolia.org',
].join(',')).split(',')

const MAX_BATCH = 50
const MIN_BATCH = 10
const ROUNDS = 4
const SINGLE_TAIL_THRESHOLD = 15
const REQUEST_TIMEOUT_MS = 20_000
const UNVERIFIED_TOLERANCE = 5
const COOLDOWN_BASE_MS = 2_000

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function isTransientMessage(message) {
  return /rate|limit|quota|busy|timeout|too many|capacity|aborted/i.test(message ?? '')
}

// Per-endpoint health state
const eps = ENDPOINTS.map((url) => ({
  url,
  cooldownUntil: 0,
  failures: 0,
  successes: 0,
  batchSize: MAX_BATCH,
}))

function penalize(ep, err) {
  if (err?.transient) {
    ep.failures++
    ep.cooldownUntil = Date.now() + COOLDOWN_BASE_MS * Math.min(8, 2 ** ep.failures)
    ep.batchSize = Math.max(MIN_BATCH, Math.floor(ep.batchSize / 2))
  }
}

function reward(ep) {
  ep.successes++
  ep.failures = Math.max(0, ep.failures - 1)
  ep.batchSize = Math.min(MAX_BATCH, ep.batchSize + 10)
}

/** One HTTP POST carrying a JSON-RPC batch; returns normalized response array. */
async function postRpc(ep, payload) {
  if (Date.now() < ep.cooldownUntil) {
    throw Object.assign(new Error('endpoint in cooldown'), { transient: true })
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const res = await fetch(ep.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
    if (res.status === 429 || res.status >= 500) {
      throw Object.assign(new Error(`HTTP ${res.status}`), { transient: true })
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    let body = await res.json()
    // Some nodes answer a batch with a single object — normalize.
    if (!Array.isArray(body)) body = [body]
    if (body.length === 1 && body[0]?.error && payload.length > 1) {
      // Whole-batch rejection (e.g. batch unsupported / payload too large)
      const msg = body[0].error.message ?? 'batch rejected'
      throw Object.assign(new Error(msg), {
        transient: body[0].error.code === -32603 || isTransientMessage(msg),
      })
    }
    return body
  } catch (err) {
    if (err.name === 'AbortError') {
      throw Object.assign(new Error('request timeout'), { transient: true })
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

/** Verify a chunk of hashes on one endpoint. Returns Map<hash, receipt|null|{failed}>. */
async function tryBatch(ep, hashes) {
  const payload = hashes.map((h, i) => ({
    jsonrpc: '2.0', id: i, method: 'eth_getTransactionReceipt', params: [h],
  }))
  const responses = await postRpc(ep, payload)
  const byId = new Map(responses.map((r) => [String(r.id), r]))
  const out = new Map()
  hashes.forEach((h, i) => {
    const r = byId.get(String(i))
    if (!r) out.set(h, { failed: 'no response entry' })
    else if (r.error) out.set(h, { failed: r.error.message ?? 'rpc error' })
    else out.set(h, r.result) // receipt object or null (not found on this node)
  })
  return out
}

/** Endpoints ordered by health: out of cooldown first, fewest failures first. */
function orderedEndpoints() {
  const now = Date.now()
  return [...eps].sort(
    (a, b) => (Math.max(0, a.cooldownUntil - now) - Math.max(0, b.cooldownUntil - now)) ||
      a.failures - b.failures,
  )
}

async function main() {
  const file = JSON.parse(await readFile(join(root, 'receipts', 'receipts.json'), 'utf8'))
  const hashes = [...new Set(file.receipts.map((r) => r.txHash).filter(Boolean))]
  if (hashes.length === 0) {
    console.log('No transactions to verify yet — run the campaign first.')
    return
  }

  // pending: hash -> { nulls: Set<url>, hardError: string|null }
  const pending = new Map(hashes.map((h) => [h, { nulls: new Set(), hardError: null }]))
  const results = new Map()

  const resolve = (h, r) => {
    results.set(h, r)
    pending.delete(h)
  }

  for (let round = 1; round <= ROUNDS && pending.size > 0; round++) {
    for (const ep of orderedEndpoints()) {
      if (pending.size === 0) break
      const left = [...pending.keys()]
      let attempted = 0
      for (let i = 0; i < left.length; i += ep.batchSize) {
        const chunk = left.slice(i, i + ep.batchSize)
        let map
        try {
          map = await tryBatch(ep, chunk)
        } catch (err) {
          penalize(ep, err)
          break // this endpoint is trouble right now — next endpoint
        }
        reward(ep)
        attempted += chunk.length
        for (const h of chunk) {
          const v = map.get(h)
          const meta = pending.get(h)
          if (v === null) {
            meta.nulls.add(ep.url) // this node doesn't have it — others may
          } else if (!v.failed) {
            resolve(h, { state: 'ok', receipt: v })
          } else if (!isTransientMessage(v.failed)) {
            meta.hardError = v.failed
          }
        }
        await sleep(200) // be polite between batches
      }
      if (attempted > 0) {
        process.stdout.write(
          `\rround ${round}/${ROUNDS} · ${ep.url.replace('https://', '').split('/')[0]} ` +
            `· ${attempted} asked · ${results.size} resolved · ${pending.size} left   `,
        )
      }
    }

    // Small stubborn tail: individual checks with endpoint rotation.
    if (pending.size > 0 && pending.size <= SINGLE_TAIL_THRESHOLD) {
      for (const h of [...pending.keys()]) {
        for (let pass = 0; pass < 2; pass++) {
          let settled = false
          for (const ep of orderedEndpoints()) {
            try {
              const map = await tryBatch(ep, [h])
              const v = map.get(h)
              const meta = pending.get(h)
              if (v === null) meta.nulls.add(ep.url)
              else if (!v.failed) {
                resolve(h, { state: 'ok', receipt: v })
                settled = true
              } else if (!isTransientMessage(v.failed)) meta.hardError = v.failed
            } catch (err) {
              penalize(ep, err)
            }
            if (pending.size === 0 || !pending.has(h)) break
          }
          if (settled || !pending.has(h)) break
          await sleep(600 * (pass + 1))
        }
      }
    }
  }
  process.stdout.write('\n\n')

  let ok = 0, reverted = 0, missing = 0, unverified = 0
  for (const hash of hashes) {
    const r = results.get(hash)
    if (r?.state === 'ok') {
      if (r.receipt.status === '0x1') {
        ok++
        console.log(`OK         ${hash}  gasUsed=${BigInt(r.receipt.gasUsed)}`)
      } else {
        reverted++
        console.log(`REVERTED   ${hash}`)
      }
    } else {
      const meta = pending.get(hash) ?? { nulls: new Set(), hardError: null }
      // "Missing" requires agreement: at least two distinct nodes (or every
      // endpoint when few) answered null and none ever returned the receipt.
      const needed = Math.min(2, eps.length)
      if (meta.nulls.size >= needed) {
        missing++
        console.log(`MISSING    ${hash}  (${meta.nulls.size} nodes have no such tx)`)
      } else {
        unverified++
        console.log(`UNVERIFIED ${hash}  ${meta.hardError ?? 'all endpoints rate-limited or unavailable'}`)
      }
    }
  }

  console.log(`\n${ok} verified, ${reverted} reverted, ${missing} missing, ${unverified} unverified (${hashes.length} total)`)

  if (reverted > 0 || missing > 0) process.exit(1)
  if (unverified > UNVERIFIED_TOLERANCE) {
    console.error(`UNVERIFIED count ${unverified} exceeds tolerance ${UNVERIFIED_TOLERANCE}`)
    process.exit(1)
  }
}

main().catch((err) => {
  console.error(err.message)
  process.exit(1)
})
