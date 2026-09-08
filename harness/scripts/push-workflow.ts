/**
 * Cordon — workflow-as-code, pushed to the real platform.
 *
 * The guardian workflow lives in this repo as TypeScript
 * (src/workflows/aave-v3-guardian.ts — built deterministically from config and
 * covered by tests). This script pushes that exact definition to KeeperHub
 * through the MCP server's create_workflow surface, then validates it back.
 *
 * Result: the same loop Cordon runs from the CLI also exists as a versioned,
 * reviewable, platform-executed workflow — workflow-as-code on KeeperHub.
 *
 * Run with: npm run workflow:push
 * Needs KH_API_KEY + the same env as the harness.
 */

import { loadConfig } from '../src/config.js'
import { buildGuardianWorkflow } from '../src/workflows/aave-v3-guardian.js'

async function mcpCall(name: string, args: Record<string, unknown>, apiKey: string): Promise<any> {
  const headers = new Headers({
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    Authorization: `Bearer ${apiKey}`,
  })
  const initRes = await fetch('https://app.keeperhub.com/mcp', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'cordon-push', version: '0.1.0' } },
    }),
  })
  const sid = initRes.headers.get('mcp-session-id') ?? ''
  if (sid) headers.set('Mcp-Session-Id', sid)
  await fetch('https://app.keeperhub.com/mcp', { method: 'POST', headers, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }) })
  const res = await fetch('https://app.keeperhub.com/mcp', {
    method: 'POST',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } }),
  })
  const raw = await res.text()
  let json: any
  try { json = JSON.parse(raw) } catch { return { raw: raw.slice(0, 400) } }
  const content = json.result?.content ?? []
  const texts = content.filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n')
  if (json.error) return { error: json.error }
  if (json.result?.isError) return { isError: true, text: texts }
  return { text: texts, data: texts ? safeParse(texts) : undefined }
}

function safeParse(text: string): Record<string, unknown> | undefined {
  try { return JSON.parse(text) } catch { return undefined }
}

async function main() {
  const cfg = loadConfig()
  const workflow = buildGuardianWorkflow(cfg)

  console.log('Cordon — push guardian workflow to KeeperHub\n')
  console.log(`Workflow name: ${workflow.name}`)
  console.log(`Nodes: ${workflow.nodes.length} | Edges: ${workflow.edges.length}\n`)

  // 1. Create the workflow through the platform's MCP surface. The nodes and
  //    edges are exactly what buildGuardianWorkflow() produced in code.
  const created = await mcpCall('create_workflow', {
    name: workflow.name,
    description: workflow.description,
    nodes: workflow.nodes,
    edges: workflow.edges,
    enabled: false, // dormant: schedule triggers stay off until enabled
  }, cfg.khApiKey)

  console.log('create_workflow →')
  console.log(' ', JSON.stringify(created).slice(0, 600), '\n')

  const wfId = created?.data?.id ?? created?.data?.workflowId ?? (created?.data && (created.data as any).workflow?.id)

  // 2. Validate it back through the platform (deep ABI check optional).
  if (wfId) {
    const val = await mcpCall('validate_workflow', { workflowId: wfId, deepCheck: true }, cfg.khApiKey)
    console.log('validate_workflow →')
    console.log(' ', JSON.stringify(val).slice(0, 600), '\n')
  }

  if (created?.error || created?.isError) {
    console.error('\nPush failed — the platform rejected the definition. See above.')
    process.exit(1)
  }
  console.log('Done. The guardian workflow now exists on KeeperHub as workflow-as-code.')
}

main().catch((err) => {
  console.error(`\nPush failed: ${err.message}`)
  process.exit(1)
})
