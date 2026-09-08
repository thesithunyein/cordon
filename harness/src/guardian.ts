/**
 * Cordon — the guardian core.
 *
 * detect(): read the position's health factor from the Aave V3 Sepolia Pool
 * decide(): compare against the configured threshold
 * protect(): simulate + execute the protective top-up (supply) through KeeperHub
 * verify(): re-read the health factor after execution
 */

import { KeeperHubClient } from './kh-client.js'
import {
  AAVE_V3_SEPOLIA,
  POOL_ABI,
  ERC20_ABI,
  RESERVES,
  toWei,
  type ReserveSymbol,
} from './aave-v3.js'
import type { CordonConfig } from './config.js'

export interface HealthSnapshot {
  healthFactor: string // 1e18-scaled, divide by 1e18
  totalCollateralBase: string
  totalDebtBase: string
  atRisk: boolean
}

export interface ProtectionResult {
  refused: boolean
  status: string
  txHash?: string
  error?: string
}

export class Guardian {
  constructor(
    private readonly kh: KeeperHubClient,
    private readonly config: CordonConfig,
  ) {}

  /** Read account health from the Pool. */
  async detect(): Promise<HealthSnapshot> {
    const r = await this.kh.callTool('execute_contract_call', {
      network: String(this.config.chainId),
      contractAddress: AAVE_V3_SEPOLIA.pool,
      abi: POOL_ABI.getUserAccountData,
      abiFunction: 'getUserAccountData',
      args: [this.config.positionAddress],
    })
    if (r.isError) throw new Error(`health factor read failed: ${r.text}`)

    // Pool returns a struct: [totalCollateralBase, totalDebtBase, availableBorrowsBase,
    // currentLiquidationThreshold, ltv, healthFactor]
    const values = (r.data?.result ?? r.data?.outputs ?? r.data) as unknown as string[] | Record<string, unknown>
    const arr = Array.isArray(values) ? values : Object.values(values)
    const healthFactor = String(arr[5] ?? '0')
    const totalCollateralBase = String(arr[0] ?? '0')
    const totalDebtBase = String(arr[1] ?? '0')

    const hf = Number(healthFactor) / 1e18
    return {
      healthFactor,
      totalCollateralBase,
      totalDebtBase,
      atRisk: hf < this.config.healthFactorThreshold,
    }
  }

  decide(snapshot: HealthSnapshot): 'protect' | 'stand-down' {
    return snapshot.atRisk ? 'protect' : 'stand-down'
  }

  /**
   * Protective action: top the position up by supplying `reserve`.
   * Safe write sequence: simulate → gate → execute (idempotent) → poll.
   */
  async protect(reserve: ReserveSymbol, amountHuman: number, nonce: string): Promise<ProtectionResult> {
    const asset = RESERVES[reserve].underlying
    const amountWei = toWei(reserve, amountHuman)
    const key = `cordon-topup-${this.config.positionAddress.toLowerCase()}-${nonce}`
    const network = String(this.config.chainId)

    // 1. Ensure the Pool can pull the asset: approve first (simulate-gated too).
    const approval = await this.kh.safeContractWrite({
      network,
      contractAddress: asset,
      abi: ERC20_ABI.approve,
      abiFunction: 'approve',
      args: [AAVE_V3_SEPOLIA.pool, amountWei],
      idempotencyKey: `${key}-approve`,
    })
    if (approval.refused || approval.status !== 'completed') {
      return { refused: true, status: approval.status, error: approval.error ?? 'approve refused by simulation' }
    }

    // 2. Supply the top-up.
    const supply = await this.kh.safeContractWrite({
      network,
      contractAddress: AAVE_V3_SEPOLIA.pool,
      abi: POOL_ABI.supply,
      abiFunction: 'supply',
      args: [asset, amountWei, this.config.positionAddress, 0],
      idempotencyKey: `${key}-supply`,
    })

    return {
      refused: supply.refused,
      status: supply.status,
      txHash: supply.txHash,
      error: supply.error,
    }
  }

  /** Re-read health factor after protection. */
  async verify(): Promise<HealthSnapshot> {
    return this.detect()
  }
}