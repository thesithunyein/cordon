import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { loadConfig } from './config.js'

const baseEnv: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const k of Object.keys(process.env)) baseEnv[k] = process.env[k]
})
afterEach(() => {
  for (const k of Object.keys(process.env)) {
    if (!(k in baseEnv)) delete process.env[k]
    else process.env[k] = baseEnv[k]
  }
})

function setEnv(overrides: Record<string, string>) {
  process.env.KH_API_KEY = 'kh_test'
  process.env.POSITION_ADDRESS = '0x1111111111111111111111111111111111111111'
  for (const [k, v] of Object.entries(overrides)) process.env[k] = v
}

test('config: defaults applied when optional env vars are absent', () => {
  setEnv({})
  const c = loadConfig()
  assert.equal(c.healthFactorThreshold, 1.5)
  assert.equal(c.reserve, 'USDC')
  assert.equal(c.topUpAmount, 10)
  assert.equal(c.campaignRounds, 10)
  assert.equal(c.verifyReceipts, true)
  assert.equal(c.chainId, 11155111)
})

test('config: env overrides respected', () => {
  setEnv({ HEALTH_FACTOR_THRESHOLD: '2.75', RESERVE: 'LINK', TOP_UP_AMOUNT: '5', CAMPAIGN_ROUNDS: '40', VERIFY_RECEIPTS: 'false', CHAIN_ID: '1' })
  const c = loadConfig()
  assert.equal(c.healthFactorThreshold, 2.75)
  assert.equal(c.reserve, 'LINK')
  assert.equal(c.topUpAmount, 5)
  assert.equal(c.campaignRounds, 40)
  assert.equal(c.verifyReceipts, false)
  assert.equal(c.chainId, 1)
})

test('config: missing KH_API_KEY throws with a helpful message', () => {
  delete process.env.KH_API_KEY
  setEnv({})
  delete process.env.KH_API_KEY
  assert.throws(() => loadConfig(), /Missing required env var: KH_API_KEY/)
})

test('config: missing POSITION_ADDRESS throws', () => {
  setEnv({})
  delete process.env.POSITION_ADDRESS
  assert.throws(() => loadConfig(), /Missing required env var: POSITION_ADDRESS/)
})

test('config: zero-length key treated as missing', () => {
  setEnv({})
  process.env.KH_API_KEY = ''
  assert.throws(() => loadConfig(), /Missing required env var: KH_API_KEY/)
})

test('config: non-numeric threshold falls back to default', () => {
  setEnv({ HEALTH_FACTOR_THRESHOLD: 'not-a-number' })
  const c = loadConfig()
  assert.equal(c.healthFactorThreshold, 1.5)
})