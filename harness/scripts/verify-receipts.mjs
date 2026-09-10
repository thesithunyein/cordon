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
 * Reliability design (CI runs this from GitHub's shared IPs, which EVERY
 * public Sepolia endpoint rate-limits aggressively):
 *   - JSON-RPC BATCHING: many receipt queries per HTTP request
 *   - SEVEN public endpoints, picked per sweep by health; a throttled
 *     endpoint gets a cooldown (honoring Retry-After when sent) instead of
 *     poisoning the run
 *   - CONVERGENCE LOOP: sweep all endpoints, then re-ask only the hashes that
 *     are still unresolved, backing off between sweeps, until everything is
 *     resolved or the time budget runs out. Rate-limit windows are per-minute
 *     — patience beats parallelism here.
 *   - Null receipts (a node briefly behind the tip) must be agreed on by
 *     several nodes before "missing" is concluded
 *   - Honest summary: VERIFIED / REVERTED / MISSING / UNVERIFIED, where
 *     UNVERIFIED = every endpoint failed for that hash (infrastructure, not
 *     evidence). Fails on any REVERTED/MISSING, and on UNVERIFIED above a
 *     small tolerance — a throttled run can neither fake success nor fake
 *     failure.
 *
 * Env:
 *   SEPOLIA_RPC      comma-separated endpoint list (overrides defaults)
 *   VERIFY_LIMIT     cap the number of hashes (smoke tests)
 */

import { readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const IS_CI = process.env.CI === 'true'

const ENDPOINTS = (process.env.SEPOLIA_RPC ?? [
  'https://ethereum-sepolia-rpc.publicnode.com',
  'https://ethereum-sepolia.publicnode.com',
  'https://eth-sepolia.drpc.org',
  'https://sepolia.drpc.org',
  'https://1rpc.io/sepolia',
  'https://sepolia.gateway.tenderly.co',
  'https://sepolia.rpc.thirdweb.com',
].join(',')).split(',')

const MAX_BATCH = IS_CI ? 10 : 50     // small requests look harmless to raters
const MIN_BATCH = 4
const INTER_BATCH_SLEEP = IS_CI ? 1_200 : 200
const SWEEP_BACKOFF_START = IS_CI ? 8_000 : 1_000
const SWEEP_BACKOFF_MAX = 45_000
const TIME_BUDGET_MS = IS_CI ? 25 * 60_000 : 8 * 60_000
const REQUEST_TIMEOUT_MS = 20_000
const NULL_AGREEMENT_NEEDED = 2       // nodes that must both lack the tx
const UNVERIFIED_TOLERANCE = 5

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

function isTransientMessage(message) {
  return /rate|limit|quota|busy|timeout|too many|capacity|aborted/i.test(message ?? '')
}

// Per-endpoint health state
const eps = ENDPOINTS.map((url) => ({
  url,
  cooldownUntil: 0,
  failures: 0,
  batchSize: MAX_BATCH,
}))

function penalize(ep, err, retryAfterMs) {
  ep.failures++
  const ms = retryAfterMs ?? Math.min(60_000, 2_000 * 2 ** Math.min(5, ep.failures))
  ep.cooldownUntil = Date.now() + ms
  ep.batchSize = Math.max(MIN_BATCH, Math.floor(ep.batchSize / 2))
}

function reward(ep) {
  ep.failures = Math.max(0, ep.failures - 1)
  ep.batchSize = Math.min(MAX_BATCH, ep.batchSize + 5)
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
    if (res.status === 429) {
      const ra = Number(res.headers.get('retry-after'))
      const retryAfterMs = Number.isFinite(ra) && ra > 0 ? ra * 1_000 : undefined
      throw Object.assign(new Error('HTTP 429'), { transient: true, retryAfterMs })
    }
    if (res.status >= 500) throw Object.assign(new Error(`HTTP ${res.status}`), { transient: true })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    let body = await res.json()
    // Some nodes answer a batch with a single object — normalize.
    if (!Array.isArray(body)) body = [body]
    if (body.length === 1 && body[0]?.error && payload.length > 1) {
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

/** One sweep across all endpoints over the still-pending hashes. */
async function sweep(pending, results, resolve) {
  const left = [...pending.keys()]
  let asked = 0
  for (const ep of orderedEndpoints()) {
    if (pending.size === 0) break
    if (Date.now() < ep.cooldownUntil) continue
    for (let i = 0; i < left.length; i += ep.batchSize) {
      const chunk = left.slice(i, i + ep.batchSize).filter((h) => pending.has(h))
      if (chunk.length === 0) continue
      let map
      try {
        map = await tryBatch(ep, chunk)
      } catch (err) {
        penalize(ep, err, err.retryAfterMs)
        break // this endpoint is trouble right now — move to the next
      }
      reward(ep)
      asked += chunk.length
      for (const h of chunk) {
        const v = map.get(h)
        const meta = pending.get(h)
        if (v === null) {
          meta.nulls.add(ep.url) // this node doesn't have it — others may
        } else if (!v.failed) {
          resolve(h, { state: 'ok', receipt: v })
        } else if (!isTransientMessage(v.failed)) {
          meta.hardError ??= v.failed
        }
      }
      await sleep(INTER_BATCH_SLEEP)
      if (pending.size === 0) break
    }
  }
  return asked
}

async function main() {
  const file = JSON.parse(await readFile(join(root, 'receipts', 'receipts.json'), 'utf8'))
  let hashes = [...new Set(file.receipts.map((r) => r.txHash).filter(Boolean))]
  if (process.env.VERIFY_LIMIT) hashes = hashes.slice(0, Number(process.env.VERIFY_LIMIT))
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

  const start = Date.now()
  let sweepNo = 0
  let backoff = SWEEP_BACKOFF_START

  while (pending.size > 0 && Date.now() - start < TIME_BUDGET_MS) {
    sweepNo++
    const before = results.size
    await sweep(pending, results, resolve)

    // Stubborn small tail: a few hashes left — settle them promptly.
    if (pending.size > 0 && pending.size <= 10) {
      for (const h of [...pending.keys()]) {
        if (Date.now() - start > TIME_BUDGET_MS) break
        await sweep(new Map([[h, pending.get(h)]]), results, resolve)
      }
    }

    const progress = results.size - before
    process.stdout.write(
      `\rsweep ${sweepNo} · ${results.size}/${hashes.length} resolved · ${pending.size} left` +
        ` · ${Math.round((Date.now() - start) / 1000)}s   `,
    )
    if (pending.size === 0) break
    // No progress → back off harder (rate-limit windows need time to reset);
    // progress → short pause and go again.
    backoff = progress === 0 ? Math.min(SWEEP_BACKOFF_MAX, backoff * 2) : SWEEP_BACKOFF_START
    await sleep(backoff)
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
      // "Missing" requires agreement: several distinct nodes all lack the tx.
      if (meta.nulls.size >= NULL_AGREEMENT_NEEDED) {
        missing++
        console.log(`MISSING    ${hash}  (${meta.nulls.size} nodes have no such tx)`)
      } else {
        unverified++
        console.log(`UNVERIFIED ${hash}  ${meta.hardError ?? 'all endpoints rate-limited or unavailable'}`)
      }
    }
  }

  console.log(`\n${ok} verified, ${reverted} reverted, ${missing} missing, ${unverified} unverified (${hashes.length} total) in ${sweepNo} sweeps`)

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
