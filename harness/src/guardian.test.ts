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

test('aave: fractional top-up amounts round correctly', () => {
  assert.equal(toWei('USDC', 0.5), '500000') // 6 decimals
  assert.equal(toWei('LINK', 2.25), '2250000000000000000') // 18 decimals
})

test('detect(): max uint health factor (empty position) is never at risk', async () => {
  const MAX = '115792089237316195423570985008687907853269984665640564039457584007913129639935'
  const g = new Guardian(new FakeKeeperHub({ healthFactor: MAX }) as never, baseConfig)
  const snap = await g.detect()
  assert.equal(snap.atRisk, false)
})

test('detect(): zero health factor (liquidated) is at risk', async () => {
  const g = new Guardian(new FakeKeeperHub({ healthFactor: '0' }) as never, baseConfig)
  const snap = await g.detect()
  assert.equal(snap.atRisk, true)
})

test('protect(): a refused simulation propagates without touching the chain', async () => {
  class RefusingKH {
    async safeProtocolWrite() {
      return { refused: true, status: 'failed', error: 'Error(51): insufficient balance' }
    }
  }
  const g = new Guardian(new RefusingKH() as never, baseConfig)
  const res = await g.protect('LINK', 5, 'nonce-1')
  assert.equal(res.refused, true)
  assert.equal(res.txHash, undefined)
  assert.match(res.error ?? '', /insufficient balance/)
})

test('protect(): completed result carries txHash and executionId', async () => {
  class DoneKH {
    async safeProtocolWrite() {
      return { refused: false, status: 'completed', txHash: '0xabc', executionId: 'exec-42' }
    }
  }
  const g = new Guardian(new DoneKH() as never, baseConfig)
  const res = await g.protect('LINK', 5, 'nonce-2')
  assert.equal(res.refused, false)
  assert.equal(res.txHash, '0xabc')
  assert.equal(res.executionId, 'exec-42')
})

test('protect(): idempotency key is stable for a given position + nonce', async () => {
  const sent: string[] = []
  class CaptureKH {
    async safeProtocolWrite(args: { idempotencyKey: string }) {
      sent.push(args.idempotencyKey)
      return { refused: true, status: 'failed' }
    }
  }
  const g = new Guardian(new CaptureKH() as never, baseConfig)
  await g.protect('LINK', 5, 'round-7')
  await g.protect('LINK', 5, 'round-7')
  assert.equal(sent[0], sent[1], 'same position+nonce must produce the same key (replay-safe)')
  assert.match(sent[0], /cordon-topup-.*-round-7-supply/)
})

test('detect(): passes the correct protocol action arguments', async () => {
  let seen: Record<string, unknown> = {}
  class CaptureKH {
    async callTool(name: string, args: Record<string, unknown>) {
      seen = { name, args }
      return { isError: false, text: '', data: { result: { healthFactor: '1500000000000000000' } } }
    }
  }
  const g = new Guardian(new CaptureKH() as never, baseConfig)
  await g.detect()
  assert.equal(seen.name, 'execute_protocol_action')
  assert.equal((seen.args as any).actionType, 'aave-v3/get-user-account-data')
  assert.equal((seen.args as any).params.user, baseConfig.positionAddress)
  assert.equal((seen.args as any).params.network, '11155111')
})