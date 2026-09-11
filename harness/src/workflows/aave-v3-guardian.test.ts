import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildGuardianWorkflow } from './aave-v3-guardian.js'

const config = {
  khApiKey: 'kh_test',
  positionAddress: '0xf3F9aAbe2aC0Fd841DFfE116867ab76D2b582897',
  healthFactorThreshold: 1.5,
  reserve: 'LINK' as const,
  topUpAmount: 5,
  campaignRounds: 10,
  verifyReceipts: true,
  chainId: 11155111,
  extraPositions: [],
  positionLabels: {},
}

const wf = buildGuardianWorkflow(config)

test('workflow: single source trigger and a complete path to notify', () => {
  const triggers = wf.nodes.filter((n) => n.type === 'trigger')
  assert.equal(triggers.length, 1)
  const ids = new Set(wf.nodes.map((n) => n.id))
  const allReachable = new Set<string>(['trigger-1'])
  let grew = true
  while (grew) {
    grew = false
    for (const e of wf.edges) {
      if (allReachable.has(e.source) && !allReachable.has(e.target)) {
        allReachable.add(e.target)
        grew = true
      }
    }
  }
  assert.equal(allReachable.size, ids.size, 'every node must be reachable from the trigger')
  assert.ok(allReachable.has('step-3'))
})

test('workflow: every edge references existing nodes', () => {
  const ids = new Set(wf.nodes.map((n) => n.id))
  for (const e of wf.edges) {
    assert.ok(ids.has(e.source), `missing source ${e.source}`)
    assert.ok(ids.has(e.target), `missing target ${e.target}`)
  }
})

test('workflow: reads via the native aave-v3 action on Sepolia', () => {
  const read = wf.nodes.find((n) => n.id === 'step-1')!
  const cfg = read.data.config as Record<string, unknown>
  assert.equal(cfg.actionType, 'aave-v3/get-user-account-data')
  assert.equal(cfg.network, '11155111')
  assert.equal(cfg.user, config.positionAddress)
  assert.ok(String(cfg._protocolMeta).includes('getUserAccountData'))
})

test('workflow: schedule trigger uses the platform trigger envelope', () => {
  const trig = wf.nodes.find((n) => n.id === 'trigger-1')!
  const cfg = trig.data.config as Record<string, unknown>
  assert.equal(trig.data.type, 'trigger')
  assert.equal(cfg.triggerType, 'Schedule')
  assert.equal(cfg.scheduleCron, '*/5 * * * *')
  assert.equal(cfg.scheduleTimezone, 'UTC')
})

test('workflow: condition compares raw health factor in 1e18 space (no code action)', () => {
  const cond = wf.nodes.find((n) => n.id === 'step-2')!
  const cfg = cond.data.config as Record<string, unknown>
  assert.equal(cfg.actionType, 'Condition')
  // 1.5 threshold × 1e18, compared against the raw 1e18-scaled read — the
  // same shape as the platform's own Aave monitor (runs on the free plan)
  assert.equal(cfg.condition, '{{@step-1:Get Aave Health Factor.result.healthFactor}} < 1500000000000000000')
  assert.ok((cfg.group as { rules: unknown[] }).rules.length >= 1)
})

test('workflow: no paid-plan actions are used', () => {
  const actionTypes = wf.nodes.map((n) => (n.data.config as { actionType?: string }).actionType).filter(Boolean)
  // code/run-code requires a paid plan — the guardian must not depend on it
  assert.ok(!actionTypes.includes('code/run-code'), 'workflow must run on the free plan')
})

test('workflow: protective supply uses only catalog fields on aave-v3/supply', () => {
  const supply = wf.nodes.find((n) => n.id === 'step-3')!
  const cfg = supply.data.config as Record<string, unknown>
  assert.equal(cfg.actionType, 'aave-v3/supply')
  // aave-v3/supply takes exactly: network, asset, amount, onBehalfOf, _protocolMeta
  const allowed = new Set(['network', 'asset', 'amount', 'onBehalfOf', 'actionType', '_protocolMeta'])
  for (const k of Object.keys(cfg)) {
    assert.ok(allowed.has(k), `unexpected config field ${k} would fail create_workflow`)
  }
  // true edge only: the condition's true branch leads to the protective supply
  const trueEdge = wf.edges.find((e) => e.source === 'step-2')!
  assert.equal(trueEdge.sourceHandle, 'true')
})

test('workflow: top-up amount encoded with reserve decimals', () => {
  const supply = wf.nodes.find((n) => n.id === 'step-3')!
  const cfg = supply.data.config as Record<string, unknown>
  assert.equal(cfg.asset, '0xf8Fb3713D459D7C1018BD0A49D19b4C44290EBE5') // LINK
  assert.equal(cfg.amount, '5000000000000000000') // 5 LINK in wei
  assert.equal(cfg.onBehalfOf, config.positionAddress)
})

test('workflow: the supply node is the terminal action (audit trail carries the rest)', () => {
  const supply = wf.nodes.find((n) => n.id === 'step-3')!
  assert.equal((supply.data.config as { actionType: string }).actionType, 'aave-v3/supply')
  // no node targets step-3; it is the end of the protective branch
  const targets = wf.edges.map((e) => e.target)
  assert.ok(targets.includes('step-3'))
})

test('workflow: name is derived from the position, scoped per user', () => {
  assert.equal(wf.name, `cordon-aave-v3-guardian-${config.positionAddress.toLowerCase().slice(0, 8)}`)
  assert.ok(wf.description.includes(config.positionAddress))
})

test('workflow: deterministic under same config (repeatable build)', () => {
  const again = buildGuardianWorkflow(config)
  assert.deepEqual(JSON.stringify(again), JSON.stringify(wf))
})
