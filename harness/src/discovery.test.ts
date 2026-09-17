import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pickRescueTarget, type CandidateRow, type DiscoveryResult } from './discovery.js'

/**
 * The fixture values are the real reading from Aave V3 Sepolia for a position at
 * the edge of liquidation (collateral $64.66, debt $53.08, LT 82.5%, HF 1.0048).
 * Sizing comes from `sizeRescue` at a target of HF 2.0: repaying $26.42 of debt
 * or supplying $64.05 of collateral lifts it there.
 */
function row(overrides: Partial<CandidateRow> = {}): CandidateRow {
  return {
    address: '0xabea4e27232e0e546a57219ad5b1c52cde365d2d',
    risk: 'at-risk',
    healthFactor: 1.0048,
    collateralUsd: 64.66,
    debtUsd: 53.08,
    liquidationThreshold: 0.825,
    repayToTargetUsd: 26.42,
    supplyToTargetUsd: 64.05,
    ...overrides,
  }
}

function result(rows: CandidateRow[], overrides: Partial<DiscoveryResult> = {}): DiscoveryResult {
  const worthDefending = [...rows].sort((a, b) => a.healthFactor - b.healthFactor)
  return {
    pool: '0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951',
    latestBlock: 1,
    fromBlock: 0,
    lookbackBlocks: 30_000,
    hfThreshold: 1.5,
    targetHf: 2.0,
    minCollateralUsd: 25,
    candidates: rows.map((r) => r.address),
    logScan: { chunks: 3, retries: 0, smallestChunk: 10_000, maxLogsInChunk: 120, logs: 300 },
    rows,
    worthDefending,
    counts: {
      candidates: rows.length,
      withDebt: rows.length,
      'at-risk': rows.filter((r) => r.risk === 'at-risk').length,
      'near-risk': rows.filter((r) => r.risk === 'near-risk').length,
      liquidatable: rows.filter((r) => r.risk === 'liquidatable').length,
      'bad-debt': rows.filter((r) => r.risk === 'bad-debt').length,
      healthy: 0,
    },
    ...overrides,
  }
}

test('pickRescueTarget: takes the lowest health factor among actionable positions', () => {
  const best = pickRescueTarget(
    result([
      row({ address: '0x1111111111111111111111111111111111111111', healthFactor: 1.0429 }),
      row({ address: '0x2222222222222222222222222222222222222222', healthFactor: 1.0048 }),
      row({ address: '0x3333333333333333333333333333333333333333', healthFactor: 1.0236 }),
    ]),
    { strategy: 'supply' },
  )
  assert.equal(best.target?.address, '0x2222222222222222222222222222222222222222')
  assert.match(best.reason, /lowest actionable/)
})

test('pickRescueTarget: will not chase a position that is not in danger', () => {
  // 1.6 is above the default ceiling of 1.5, so this is a watch item, not a rescue.
  const picked = pickRescueTarget(result([row({ healthFactor: 1.6 })]), { maxHealthFactor: 1.5 })
  assert.equal(picked.target, null)
  assert.equal(picked.skipped.length, 1)
  assert.match(picked.skipped[0].reason, /is not below 1\.5/)
})

test('pickRescueTarget: skips dust, because rescuing it spends value to protect pennies', () => {
  const picked = pickRescueTarget(
    result([
      row({ address: '0x4444444444444444444444444444444444444444', healthFactor: 1.01, collateralUsd: 3.2 }),
      row({ address: '0x5555555555555555555555555555555555555555', healthFactor: 1.05 }),
    ]),
    { minCollateralUsd: 25, strategy: 'supply' },
  )
  assert.equal(picked.target?.address, '0x5555555555555555555555555555555555555555')
  assert.match(picked.skipped[0].reason, /below \$25/)
})

test('pickRescueTarget: skips a rescue it cannot afford rather than doing half of it', () => {
  // Supplying $23361 of collateral would rescue the position, but spending that
  // much is not available — and a partial supply leaves the risk in place.
  const picked = pickRescueTarget(
    result([
      row({
        address: '0xd44978cb905a505c6228f57465db17b172fb880f',
        healthFactor: 1.0072,
        collateralUsd: 63_200,
        debtUsd: 47_061,
        supplyToTargetUsd: 23_361,
      }),
      row({ address: '0xabea4e27232e0e546a57219ad5b1c52cde365d2d', healthFactor: 1.05 }),
    ]),
    { maxRescueUsd: 250, strategy: 'supply' },
  )
  assert.equal(picked.target?.address, '0xabea4e27232e0e546a57219ad5b1c52cde365d2d')
  assert.match(picked.skipped[0].reason, /above the \$250 ceiling/)
})

test('pickRescueTarget: the cheapest strategy checks the smaller of the two levers', () => {
  // repay $26.42 vs supply $64.05: with a $50 ceiling the position is affordable
  // only because the cheaper lever fits.
  const picked = pickRescueTarget(result([row()]), { maxRescueUsd: 50, strategy: 'cheapest' })
  assert.equal(picked.target?.address, row().address)
})

test('pickRescueTarget: the ceiling is applied to the lever actually being used', () => {
  // Repaying $26.42 fits under a $50 ceiling even though supplying $64.05 does not,
  // so the same row is actionable as a repay and skipped as a supply.
  const asRepay = pickRescueTarget(result([row()]), { maxRescueUsd: 50, strategy: 'repay' })
  assert.equal(asRepay.target?.address, row().address)

  const asSupply = pickRescueTarget(result([row()]), { maxRescueUsd: 50, strategy: 'supply' })
  assert.equal(asSupply.target, null)
})

test('pickRescueTarget: reports why it declined instead of inventing a target', () => {
  const empty = pickRescueTarget(result([]), {})
  assert.equal(empty.target, null)
  assert.match(empty.reason, /no organic position/)

  const allSkipped = pickRescueTarget(result([row({ healthFactor: 1.9 })]), { maxHealthFactor: 1.5 })
  assert.equal(allSkipped.target, null)
  assert.match(allSkipped.reason, /were skipped by the selection guards/)
})

test('pickRescueTarget: an unset ceiling does not silently block every rescue', () => {
  const picked = pickRescueTarget(result([row({ supplyToTargetUsd: 100_000 })]), { strategy: 'supply' })
  assert.equal(picked.target?.address, row().address)
})
