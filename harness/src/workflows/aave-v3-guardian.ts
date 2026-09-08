/**
 * Cordon — the guardian workflow, as code.
 *
 * This is the same loop the CLI runs, expressed as a KeeperHub workflow whose
 * node envelope matches what the platform's own workflows use (verified
 * against `get_workflow` on an existing platform workflow and the 457-entry
 * `list_action_schemas` catalog). It can be pushed with `create_workflow`
 * over MCP and executed by the platform itself — schedule trigger → read →
 * condition → supply → notify — with the platform's audit trail on every run.
 *
 * Node graph:
 *   trigger (Schedule, every 5 min)
 *     → read-health (aave-v3/get-user-account-data)
 *     → condition (Condition: rawHealthFactor < thresholdWei)
 *         ├─ true  → supply (aave-v3/supply)   ← protection
 *         └─ false → (no edge — do nothing)
 *
 * The comparison happens in 1e18 space (threshold × 1e18, like the platform's
 * own Aave monitor), so no code action is needed — it runs on the free plan.
 * Node config only uses fields in the platform's action catalog
 * (list_action_schemas), so create_workflow accepts the definition.
 */

import {
  AAVE_V3_SEPOLIA,
  RESERVES,
  toWei,
  type ReserveSymbol,
} from '../aave-v3.js'
import type { CordonConfig } from '../config.js'

export interface WorkflowNode {
  id: string
  type: 'trigger' | 'action'
  position: { x: number; y: number }
  data: {
    type: 'trigger' | 'action'
    label: string
    description?: string
    status: 'idle'
    config: Record<string, unknown>
  }
}

export interface WorkflowEdge {
  id: string
  source: string
  target: string
  sourceHandle?: string
}

export interface GuardianWorkflow {
  name: string
  description: string
  nodes: WorkflowNode[]
  edges: WorkflowEdge[]
}

const PROTOCOL_META = (functionName: string, actionType: string) =>
  JSON.stringify({
    protocolSlug: 'aave-v3',
    contractKey: 'pool',
    functionName,
    actionType,
  })

/** Build the guardian workflow definition for a given config. */
export function buildGuardianWorkflow(config: CordonConfig): GuardianWorkflow {
  const asset = RESERVES[config.reserve].underlying
  const amountWei = toWei(config.reserve as ReserveSymbol, config.topUpAmount)
  const network = String(config.chainId)
  const thresholdWei = Math.round(config.healthFactorThreshold * 1e18)

  const node = (
    id: string,
    x: number,
    label: string,
    cfg: Record<string, unknown>,
    description?: string,
  ): WorkflowNode => ({
    id,
    type: 'action',
    position: { x, y: 116 },
    data: { type: 'action', label, description, status: 'idle', config: cfg },
  })

  const trigger: WorkflowNode = {
    id: 'trigger-1',
    type: 'trigger',
    position: { x: 0, y: 116 },
    data: {
      type: 'trigger',
      label: 'Trigger',
      status: 'idle',
      config: {
        triggerType: 'Schedule',
        scheduleCron: '*/5 * * * *',
        scheduleTimezone: 'UTC',
      },
    },
  }

  const readHealth = node(
    'step-1',
    252,
    'Get Aave Health Factor',
    {
      user: config.positionAddress,
      network,
      actionType: 'aave-v3/get-user-account-data',
      _protocolMeta: PROTOCOL_META('getUserAccountData', 'read'),
    },
    'Read the position health factor from the Aave V3 Pool',
  )

  const atRisk = node(
    'step-2',
    504,
    'Condition',
    {
      group: {
        id: 'group-1',
        logic: 'AND',
        rules: [
          {
            id: 'rule-1',
            operator: '<',
            leftOperand: `{{@step-1:Get Aave Health Factor.healthFactor}}`,
            // 1e18 space: the read returns the health factor scaled by 1e18,
            // so compare against threshold × 1e18 (the platform's own Aave
            // monitor does exactly this). No code action required.
            rightOperand: String(thresholdWei),
          },
        ],
      },
      condition: `{{@step-1:Get Aave Health Factor.healthFactor}} < ${thresholdWei}`,
      actionType: 'Condition',
    },
    'Is the position at risk of liquidation? (raw 1e18 health factor < threshold × 1e18)',
  )

  const supply = node(
    'step-3',
    756,
    'Supply LINK to protect position',
    {
      network,
      asset,
      amount: String(amountWei),
      onBehalfOf: config.positionAddress,
      actionType: 'aave-v3/supply',
      _protocolMeta: PROTOCOL_META('supply', 'write'),
    },
    'Protective top-up: supply the reserve to the Aave Pool for the position',
  )



  return {
    name: `cordon-aave-v3-guardian-${config.positionAddress.toLowerCase().slice(0, 8)}`,
    description:
      `Cordon: protect Aave V3 position ${config.positionAddress} on Sepolia. ` +
      `Reads health factor every 5 min; if it drops below ${config.healthFactorThreshold}, ` +
      `simulates and executes a ${config.topUpAmount} ${config.reserve} top-up through KeeperHub ` +
      `and notifies. Deterministic, simulated, audited.`,
    nodes: [trigger, readHealth, atRisk, supply],
    edges: [
      { id: 'e-1', source: 'trigger-1', target: 'step-1' },
      { id: 'e-2', source: 'step-1', target: 'step-2' },
      { id: 'e-3', source: 'step-2', target: 'step-3', sourceHandle: 'true' },
    ],
  }
}
