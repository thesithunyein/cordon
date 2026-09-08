import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Guardian, type HealthSnapshot } from './guardian.js'
import { AAVE_V3_SEPOLIA, RESERVES, decimalsOf, toWei } from './aave-v3.js'

function snapshot(hfScaled: string, atRisk = false): HealthSnapshot {
  return { healthFactor: hfScaled, totalCollateralBase: '0', totalDebtBase: '0', atRisk }
}

class FakeKeeperHub {
  response: Record<string, unknown>
  constructor(response: Record<string, unknown>) {
    this.response = response
  }
  async callTool(): Promise<{ isError: boolean; text: string; data?: Record<string, unknown> }> {
    return { isError: false, text: '', data: { result: this.response } }
  }
}

const baseConfig = {
  khApiKey: 'kh_test',
  positionAddress: '0x1111111111111111111111111111111111111111',
  healthFactorThreshold: 1.5,
  reserve: 'LINK' as const,
  topUpAmount: 5,
  campaignRounds: 1,
  verifyReceipts: false,
  chainId: 11155111,
}

test('decide(): protect when at risk, stand-down when safe', () => {
  const g = new Guardian(new FakeKeeperHub({}) as never, baseConfig)
  assert.equal(g.decide(snapshot('0', true)), 'protect')
  assert.equal(g.decide(snapshot('1000000000000000000', false)), 'stand-down')
})

test('decide(): follows the snapshot atRisk flag exactly', () => {
  const g = new Guardian(new FakeKeeperHub({}) as never, baseConfig)
  const atRisk: HealthSnapshot = { ...snapshot('999999999999999999'), atRisk: true }
  assert.equal(g.decide(atRisk), 'protect')
})

test('detect(): parses 1e18-scaled health factor and marks risk', async () => {
  const g = new Guardian(new FakeKeeperHub({ healthFactor: '1500000000000000000' }) as never, {
    ...baseConfig,
    healthFactorThreshold: 1.5,
  })
  const snap = await g.detect()
  assert.equal(snap.healthFactor, '1500000000000000000')
  // exactly at threshold: not at risk (strictly below)
  assert.equal(snap.atRisk, false)
})

test('detect(): health factor below threshold is at risk', async () => {
  const g = new Guardian(new FakeKeeperHub({ healthFactor: '1499999999999999999' }) as never, {
    ...baseConfig,
    healthFactorThreshold: 1.5,
  })
  const snap = await g.detect()
  assert.equal(snap.atRisk, true)
})

test('detect(): propagates read errors', async () => {
  class Failing extends FakeKeeperHub {
    async callTool() {
      return { isError: true, text: 'read failed: connection refused' }
    }
  }
  const g = new Guardian(new Failing({}) as never, baseConfig)
  await assert.rejects(() => g.detect(), /health factor read failed/)
})

test('aave: toWei uses the right decimals per reserve', () => {
  assert.equal(toWei('USDC', 1000), '1000000000') // 6 decimals
  assert.equal(toWei('LINK', 5), '5000000000000000000') // 18 decimals
  assert.equal(toWei('WBTC', 1), '100000000') // 8 decimals
})

test('aave: official AaveV3Sepolia registry addresses (aave-address-book)', () => {
  assert.equal(AAVE_V3_SEPOLIA.pool, '0x6Ae43d3271ff6888e7Fc43Fd7321a503ff738951')
  assert.equal(AAVE_V3_SEPOLIA.faucet, '0xC959483DBa39aa9E78757139af0e9a2EDEb3f42D')
  assert.equal(RESERVES.LINK.underlying, '0xf8Fb3713D459D7C1018BD0A49D19b4C44290EBE5')
  assert.equal(RESERVES.USDC.underlying, '0x94a9D9AC8a22534E3FaCa9F4e7F2E2cf85d5E4C8')
  assert.equal(decimalsOf('DAI'), 18)
})