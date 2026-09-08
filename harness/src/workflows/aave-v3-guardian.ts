/**
 * Cordon — the guardian workflow, as code.
 *
 * This is the same loop the CLI runs, expressed as a KeeperHub workflow:
 * every node below maps to a KeeperHub node type, so it can be created with
 * create_workflow over MCP and executed by the platform itself
 * (schedule trigger → read → condition → write → notify), with the platform's
 * audit trail on every run.
 *
 * Node graph:
 *   trigger (Schedule, every 5 min)
 *     → read-health (web3/read-contract: Aave V3 Pool getUserAccountData)
 *     → code (healthFactor = result / 1e18)
 *     → condition (healthFactor < threshold)
 *         ├─ true  → simulate → supply (protective top-up)
 *         │           → verify (re-read health factor)
 *         │           → notify (Telegram/Discord: tx hash + new HF)
 *         └─ false → notify (stand-down)
 */

import {
  AAVE_V3_SEPOLIA,
  POOL_ABI,
  RESERVES,
  toWei,
  type ReserveSymbol,
} from '../aave-v3.js'
import type { CordonConfig } from '../config.js'

export interface WorkflowNode {
  id: string
  type: 'trigger' | 'action'
  data: {
    label: string
    description: string
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

/** Build the guardian workflow definition for a given config. */
export function buildGuardianWorkflow(config: CordonConfig): GuardianWorkflow {
  const asset = RESERVES[config.reserve].underlying
  const amountWei = toWei(config.reserve as ReserveSymbol, config.topUpAmount)
  const network = String(config.chainId)

  return {
    name: `cordon-aave-v3-guardian-${config.positionAddress.toLowerCase().slice(0, 8)}`,
    description:
      `Cordon: protect Aave V3 position ${config.positionAddress} on Sepolia. ` +
      `Reads health factor every 5 min; if it drops below ${config.healthFactorThreshold}, ` +
      `simulates and executes a ${config.topUpAmount} ${config.reserve} top-up through KeeperHub, ` +
      `verifies the new health factor, and notifies. Deterministic, simulated, audited.`,
    nodes: [
      {
        id: 'trigger-schedule',
        type: 'trigger',
        data: {
          label: 'Every 5 minutes',
          description: 'Schedule trigger',
          config: { triggerType: 'Schedule', cron: '*/5 * * * *' },
        },
      },
      {
        id: 'read-health',
        type: 'action',
        data: {
          label: 'Aave V3 Pool: getUserAccountData',
          description: 'Read the position health factor',
          config: {
            actionType: 'web3/read-contract',
            network,
            contractAddress: AAVE_V3_SEPOLIA.pool,
            abi: POOL_ABI.getUserAccountData,
            abiFunction: 'getUserAccountData',
            args: [config.positionAddress],
          },
        },
      },
      {
        id: 'code-hf',
        type: 'action',
        data: {
          label: 'healthFactor = result / 1e18',
          description: 'Normalise 1e18 health factor',
          config: {
            actionType: 'code',
            code: 'return { healthFactor: result[5] / 1e18, totalCollateral: result[0], totalDebt: result[1] };',
          },
        },
      },
      {
        id: 'condition-at-risk',
        type: 'action',
        data: {
          label: `healthFactor < ${config.healthFactorThreshold}`,
          description: 'Is the position at risk?',
          config: {
            actionType: 'condition',
            condition: `{{@code-hf:healthFactor}} < ${config.healthFactorThreshold}`,
          },
        },
      },
      {
        id: 'simulate-supply',
        type: 'action',
        data: {
          label: 'Simulate top-up',
          description: 'Dry-run the protective supply before any broadcast',
          config: {
            actionType: 'web3/write-contract',
            network,
            contractAddress: AAVE_V3_SEPOLIA.pool,
            abi: POOL_ABI.supply,
            abiFunction: 'supply',
            args: [asset, amountWei, config.positionAddress, 0],
            simulate: true,
          },
        },
      },
      {
        id: 'execute-supply',
        type: 'action',
        data: {
          label: 'Execute top-up',
          description: 'Protective supply, idempotent',
          config: {
            actionType: 'web3/write-contract',
            network,
            contractAddress: AAVE_V3_SEPOLIA.pool,
            abi: POOL_ABI.supply,
            abiFunction: 'supply',
            args: [asset, amountWei, config.positionAddress, 0],
            idempotencyKey: `{{@execution.id}}-supply`,
          },
        },
      },
      {
        id: 'verify-health',
        type: 'action',
        data: {
          label: 'Re-read health factor',
          description: 'Verify the position after protection',
          config: {
            actionType: 'web3/read-contract',
            network,
            contractAddress: AAVE_V3_SEPOLIA.pool,
            abi: POOL_ABI.getUserAccountData,
            abiFunction: 'getUserAccountData',
            args: [config.positionAddress],
          },
        },
      },
      {
        id: 'notify',
        type: 'action',
        data: {
          label: 'Notify: tx hash + health factor',
          description: 'Telegram alert with the audit record',
          config: {
            actionType: 'telegram/send-message',
            message:
              `Cordon: position ${config.positionAddress.slice(0, 10)}… ` +
              `protected. Tx {{@execute-supply.transactionHash}} | ` +
              `HF {{@verify-health.result[5]}}`,
          },
        },
      },
    ],
    edges: [
      { id: 'e1', source: 'trigger-schedule', target: 'read-health' },
      { id: 'e2', source: 'read-health', target: 'code-hf' },
      { id: 'e3', source: 'code-hf', target: 'condition-at-risk' },
      { id: 'e4', source: 'condition-at-risk', target: 'simulate-supply', sourceHandle: 'true' },
      { id: 'e5', source: 'simulate-supply', target: 'execute-supply' },
      { id: 'e6', source: 'execute-supply', target: 'verify-health' },
      { id: 'e7', source: 'verify-health', target: 'notify' },
    ],
  }
}