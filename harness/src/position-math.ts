/**
 * Cordon — Aave V3 account math.
 *
 * Pure functions only: no network, no KeeperHub, no side effects. The at-risk
 * finder and the rescue path both size their actions through here, so the
 * arithmetic that decides how much value moves is unit-testable on its own.
 *
 * Units, because this is where Aave trips people up:
 *   - `totalCollateralBase` / `totalDebtBase` are the base currency (USD) with
 *     8 decimals — NOT wei, and not the token's own decimals.
 *   - `currentLiquidationThreshold` / `ltv` are basis points (7500 = 75%).
 *   - `healthFactor` is 1e18-scaled, and is type(uint256).max when there is
 *     no debt at all.
 */

/** Health factors are 1e18-scaled. */
export const RAY = 10n ** 18n
/** Aave returns this health factor for a debt-free account. */
export const NO_DEBT_HF = (1n << 256n) - 1n
export const BPS = 10_000n
/** Base currency (USD) decimals. */
export const BASE_DECIMALS = 8
const BASE_UNIT = 10n ** BigInt(BASE_DECIMALS)

/** Pool.getUserAccountData(address). */
export const GET_USER_ACCOUNT_DATA_SELECTOR = '0xbf92857c'

export interface AccountData {
  collateralBase: bigint
  debtBase: bigint
  availableBorrowsBase: bigint
  liquidationThresholdBps: bigint
  ltvBps: bigint
  healthFactor: bigint
}

function isAddress(address: string): boolean {
  return /^0x[0-9a-fA-F]{40}$/.test(address)
}

/** ABI-encode `getUserAccountData(address)` calldata. */
export function encodeGetUserAccountData(address: string): string {
  if (!isAddress(address)) throw new Error(`not an address: ${address}`)
  return GET_USER_ACCOUNT_DATA_SELECTOR + address.slice(2).toLowerCase().padStart(64, '0')
}

/**
 * Decode the six words returned by `getUserAccountData`.
 * Returns null for empty or truncated payloads (a non-Aave address, a revert
 * that the node answered with `0x`, a proxy that returned nothing).
 */
export function parseAccountData(hex: string): AccountData | null {
  if (!hex || !hex.startsWith('0x') || hex.length < 2 + 64 * 6) return null
  const words = hex.slice(2).match(/.{64}/g)
  if (!words || words.length < 6) return null
  return {
    collateralBase: BigInt('0x' + words[0]),
    debtBase: BigInt('0x' + words[1]),
    availableBorrowsBase: BigInt('0x' + words[2]),
    liquidationThresholdBps: BigInt('0x' + words[3]),
    ltvBps: BigInt('0x' + words[4]),
    healthFactor: BigInt('0x' + words[5]),
  }
}

/** Base-currency value as a float. */
export function baseToUsd(value: bigint): number {
  return Number(value) / Number(BASE_UNIT)
}

/** Health factor as a float. Infinity when the account carries no debt. */
export function healthFactorOf(account: AccountData): number {
  if (account.healthFactor === NO_DEBT_HF) return Number.POSITIVE_INFINITY
  return Number(account.healthFactor) / Number(RAY)
}

/** True when the account actually has debt to defend against. */
export function hasDebt(account: AccountData): boolean {
  return account.debtBase > 0n
}

export interface RescueSizing {
  /** Repaying this much debt (USD) lifts the account to `targetHf`. */
  repayUsd: number
  /** Adding this much collateral (USD) lifts the account to `targetHf`. */
  supplyUsd: number
  liquidationThreshold: number
}

/**
 * Size the two rescue levers Aave allows, in base-currency USD:
 *   healthFactor = collateral * liquidationThreshold / debt
 * so to reach a target health factor T:
 *   repay  x = debt * (1 - HF/T)
 *   supply y = T * debt / LT - collateral
 *
 * Both are clamped at zero: a position already above the target needs neither.
 * The returned numbers are estimates — they ignore interest accrued between the
 * read and the execution, which is why the rescue path re-reads after landing.
 */
export function sizeRescue(account: AccountData, targetHf: number): RescueSizing {
  const liquidationThreshold = Number(account.liquidationThresholdBps) / Number(BPS)
  const hf = healthFactorOf(account)
  const debt = baseToUsd(account.debtBase)
  const collateral = baseToUsd(account.collateralBase)

  if (!Number.isFinite(hf) || debt <= 0 || liquidationThreshold <= 0) {
    return { repayUsd: 0, supplyUsd: 0, liquidationThreshold }
  }

  return {
    repayUsd: Math.max(0, debt * (1 - hf / targetHf)),
    supplyUsd: Math.max(0, (targetHf * debt) / liquidationThreshold - collateral),
    liquidationThreshold,
  }
}

/** How the finder classifies an account it read. */
export type RiskClass =
  | 'bad-debt' // debt with no usable collateral left: nothing to protect
  | 'liquidatable' // HF < 1.0 — a liquidator is the one who acts
  | 'at-risk' // HF below the caller's threshold, collateral intact
  | 'near-risk' // HF below 2.0, worth watching
  | 'healthy'

export function classifyRisk(account: AccountData, threshold: number): RiskClass {
  if (!hasDebt(account)) return 'healthy'
  if (account.collateralBase === 0n) return 'bad-debt'
  const hf = healthFactorOf(account)
  if (hf < 1) return 'liquidatable'
  if (hf < threshold) return 'at-risk'
  if (hf < 2) return 'near-risk'
  return 'healthy'
}
