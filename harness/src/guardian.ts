/**
 * Cordon — the guardian core.
 *
 * detect(): read the position's health factor via the native Aave V3
 *           protocol action (aave-v3/get-user-account-data) — validated live
 *           on Sepolia (chain 11155111)
 * decide(): compare against the configured threshold
 * protect(): simulate the supply calldata, then execute the protective
 *            top-up through the native protocol action (aave-v3/supply)
 * verify(): re-read the health factor after execution
 *
 * The Aave V3 plugin accepts Sepolia: the read returned the real Sepolia Pool
 * (addressLink 0x6Ae4…951) with live account data. Supply simulation against
 * an unfunded wallet correctly returned wouldRevert:true (Aave Error(51),
 * insufficient balance) with zero gas spent.
 */

import { KeeperHubClient } from './kh-client.js'
import { AAVE_V3_SEPOLIA, RESERVES, toWei, type ReserveSymbol } from './aave-v3.js'
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

  /** Read account health from the Aave V3 Sepolia Pool (native plugin action). */
  async detect(): Promise<HealthSnapshot> {
    const r = await this.kh.callTool('execute_protocol_action', {
      actionType: 'aave-v3/get-user-account-data',
      params: { network: String(this.config.chainId), user: this.config.positionAddress },
    })
    if (r.isError) throw new Error(`health factor read failed: ${r.text}`)

    const result = (r.data?.result ?? r.data) as Record<string, unknown> | undefined
    const healthFactor = String(result?.healthFactor ?? '0')
    const totalCollateralBase = String(result?.totalCollateralBase ?? '0')
    const totalDebtBase = String(result?.totalDebtBase ?? '0')

    const hf = Number(healthFactor) / 1e18
    // Exact comparison: Number() loses precision at 18 decimals, so compare
    // the raw 1e18-scaled value against the threshold in wei via BigInt.
    const thresholdWei = BigInt(Math.round(this.config.healthFactorThreshold * 1e18))
    return {
      healthFactor,
      totalCollateralBase,
      totalDebtBase,
      atRisk: BigInt(healthFactor) < thresholdWei,
    }
  }

  decide(snapshot: HealthSnapshot): 'protect' | 'stand-down' {
    return snapshot.atRisk ? 'protect' : 'stand-down'
  }

  /**
   * Protective action: top the position up by supplying `reserve`.
   * Safe sequence: simulate the exact supply calldata → gate → execute the
   * native aave-v3/supply action (idempotent) → poll.
   */
  async protect(reserve: ReserveSymbol, amountHuman: number, nonce: string): Promise<ProtectionResult> {
    const asset = RESERVES[reserve].underlying
    const amountWei = toWei(reserve, amountHuman)
    const network = String(this.config.chainId)
    const key = `cordon-topup-${this.config.positionAddress.toLowerCase()}-${nonce}`

    const supplyCalldata = JSON.stringify([asset, amountWei, this.config.positionAddress, '0'])

    const result = await this.kh.safeProtocolWrite({
      actionType: 'aave-v3/supply',
      params: {
        network,
        asset,
        amount: amountWei,
        onBehalfOf: this.config.positionAddress,
      },
      idempotencyKey: `${key}-supply`,
      simulate: {
        chainId: network,
        contractAddress: AAVE_V3_SEPOLIA.pool,
        functionName: 'supply',
        functionArgs: supplyCalldata,
      },
    })

    return {
      refused: result.refused,
      status: result.status,
      txHash: result.txHash,
      error: result.error,
    }
  }

  /** Re-read health factor after protection. */
  async verify(): Promise<HealthSnapshot> {
    return this.detect()
  }
}