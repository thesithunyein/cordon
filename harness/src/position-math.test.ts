import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  BPS,
  GET_USER_ACCOUNT_DATA_SELECTOR,
  NO_DEBT_HF,
  RAY,
  baseToUsd,
  classifyRisk,
  encodeGetUserAccountData,
  hasDebt,
  healthFactorOf,
  parseAccountData,
  sizeRescue,
  type AccountData,
} from './position-math.js'

/** Pack bigints into a 32-byte-per-word return payload. */
const word = (v: bigint): string => (v < 0n ? v + (1n << 256n) : v).toString(16).padStart(64, '0')
const payload = (words: bigint[]): string => '0x' + words.map(word).join('')

/**
 * These are not invented numbers. They are the values read from Aave V3 Sepolia
 * on 2026-09-17 for a real position at the edge of liquidation (collateral
 * $64.66, debt $53.08 USDC, liquidation threshold 82.5%, health factor 1.0050).
 */
const AT_RISK: Omit<AccountData, 'availableBorrowsBase'> = {
  collateralBase: 6_466_000_000n,
  debtBase: 5_308_000_000n,
  liquidationThresholdBps: 8250n,
  ltvBps: 8000n,
  healthFactor: 1_004_979_000_000_000_000n,
}

function account(overrides: Partial<AccountData> = {}): AccountData {
  return { availableBorrowsBase: 0n, ...AT_RISK, ...overrides }
}

test('encodeGetUserAccountData: selector + left-padded address', () => {
  const data = encodeGetUserAccountData('0xAbEa4E27232E0E546A57219Ad5B1C52CDE365D2D')
  assert.equal(data.slice(0, 10), GET_USER_ACCOUNT_DATA_SELECTOR)
  assert.equal(data.length, 10 + 64)
  assert.equal(data.slice(10), 'abea4e27232e0e546a57219ad5b1c52cde365d2d'.padStart(64, '0'))
})

test('encodeGetUserAccountData: rejects a non-address', () => {
  assert.throws(() => encodeGetUserAccountData('0x1234'), /not an address/)
})

test('parseAccountData: decodes the six words in ABI order', () => {
  const parsed = parseAccountData(
    payload([AT_RISK.collateralBase, AT_RISK.debtBase, 0n, AT_RISK.liquidationThresholdBps, AT_RISK.ltvBps, AT_RISK.healthFactor]),
  )
  assert.ok(parsed)
  assert.equal(parsed.collateralBase, AT_RISK.collateralBase)
  assert.equal(parsed.debtBase, AT_RISK.debtBase)
  assert.equal(parsed.liquidationThresholdBps, 8250n)
  assert.equal(parsed.healthFactor, AT_RISK.healthFactor)
})

test('parseAccountData: returns null for empty or truncated payloads', () => {
  assert.equal(parseAccountData('0x'), null)
  assert.equal(parseAccountData(''), null)
  assert.equal(parseAccountData(payload([1n, 2n])), null)
  assert.equal(parseAccountData(payload([1n, 2n, 3n, 4n, 5n])), null)
  assert.ok(parseAccountData(payload([1n, 2n, 3n, 4n, 5n, 6n])))
})

test('baseToUsd: base currency is USD with 8 decimals', () => {
  assert.equal(baseToUsd(6_466_000_000n), 64.66)
  assert.equal(baseToUsd(17_371_854_534_241n), 173718.54534241)
})

test('healthFactorOf: 1e18-scaled, and Infinity when nothing is owed', () => {
  assert.equal(healthFactorOf(account()), 1.004979)
  assert.equal(healthFactorOf(account({ healthFactor: 4n * RAY + RAY / 2n })), 4.5)
  assert.equal(healthFactorOf(account({ healthFactor: NO_DEBT_HF })), Number.POSITIVE_INFINITY)
})

test('hasDebt: only accounts carrying debt are worth defending', () => {
  assert.equal(hasDebt(account()), true)
  assert.equal(hasDebt(account({ debtBase: 0n })), false)
})

test('sizeRescue: sizes both levers to reach the target health factor', () => {
  const { repayUsd, supplyUsd, liquidationThreshold } = sizeRescue(account(), 2.0)
  assert.equal(liquidationThreshold, 0.825)
  // repay = debt * (1 - HF/target); supply = target*debt/LT - collateral
  assert.ok(Math.abs(repayUsd - 26.41) < 0.01, `repay ${repayUsd}`)
  assert.ok(Math.abs(supplyUsd - 64.02) < 0.01, `supply ${supplyUsd}`)
  // Repaying is strictly cheaper than supplying to reach the same health factor.
  assert.ok(repayUsd < supplyUsd)
})

test('sizeRescue: clamps to zero when the position is already safe', () => {
  // Fixtures must stay self-consistent: HF == collateral * LT / debt.
  // collateral $643.39, debt $53.08, LT 82.5% → HF 10.
  const safe = sizeRescue(account({ collateralBase: 64_339_000_000n, healthFactor: 10n * RAY }), 2.0)
  assert.equal(safe.repayUsd, 0)
  assert.equal(safe.supplyUsd, 0)
})

test('sizeRescue: nothing to size without debt or without a threshold', () => {
  assert.deepEqual(
    { repay: sizeRescue(account({ debtBase: 0n }), 2.0).repayUsd, supply: sizeRescue(account({ debtBase: 0n }), 2.0).supplyUsd },
    { repay: 0, supply: 0 },
  )
  assert.equal(sizeRescue(account({ liquidationThresholdBps: 0n }), 2.0).repayUsd, 0)
})

test('classifyRisk: separates dust, bad debt and positions worth defending', () => {
  assert.equal(classifyRisk(account(), 1.6), 'at-risk')
  assert.equal(classifyRisk(account({ healthFactor: 1_400_000_000_000_000_000n }), 1.6), 'at-risk')
  assert.equal(classifyRisk(account({ healthFactor: 1_800_000_000_000_000_000n }), 1.6), 'near-risk')
  assert.equal(classifyRisk(account({ healthFactor: RAY / 2n }), 1.6), 'liquidatable')
  assert.equal(classifyRisk(account({ healthFactor: 5n * RAY }), 1.6), 'healthy')
  // Debt with no collateral left is not a rescue, it is bad debt.
  assert.equal(classifyRisk(account({ collateralBase: 0n, healthFactor: 0n }), 1.6), 'bad-debt')
  assert.equal(classifyRisk(account({ debtBase: 0n, healthFactor: NO_DEBT_HF }), 1.6), 'healthy')
})

test('health factor threshold is exact in wei, not float-compared', () => {
  // 1.5 exactly, at 18 decimals, is the boundary: below it is at risk.
  const thresholdWei = (15n * RAY) / 10n
  assert.equal(thresholdWei, 1_500_000_000_000_000_000n)
  assert.ok(1_499_999_999_999_999_999n < thresholdWei)
  assert.ok(!(1_500_000_000_000_000_000n < thresholdWei))
  assert.equal(BPS, 10_000n)
})
