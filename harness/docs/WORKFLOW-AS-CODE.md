# WORKFLOW-AS-CODE.md — the guardian as a KeeperHub workflow

Cordon exists in two forms that run the same protect loop:

1. **The CLI guardian** (`src/guardian.ts` + `npm run guard`) — what produced the
   505-execution evidence corpus in `receipts.json`.
2. **A KeeperHub platform workflow** — the same loop expressed as a versioned,
   platform-executed workflow, built from code and pushed through the MCP
   server's `create_workflow` surface.

## The workflow definition lives in code

`src/workflows/aave-v3-guardian.ts` exports `buildGuardianWorkflow(config)`, a
deterministic builder (same config → byte-identical JSON, covered by tests).
It emits the **exact node envelope KeeperHub's platform uses** — verified
against a real existing workflow via `get_workflow` and against the 457-entry
`list_action_schemas` catalog:

| Node | KeeperHub action type |
|---|---|
| Schedule trigger (every 5 min, UTC) | `trigger` / `Schedule` |
| Read position health factor | `aave-v3/get-user-account-data` |
| At-risk condition (raw 1e18 HF < threshold × 1e18) | `Condition` |
| Protective top-up | `aave-v3/supply` |

Because the comparison runs in 1e18 space (the same shape as KeeperHub's own
"Aave Health Factor Monitor" template), no paid-plan `code/run-code` action is
needed — the workflow validates and runs on a free plan.

## Pushed and validated live

`npm run workflow:push` (in `harness/`) pushes the code-built definition to
KeeperHub over MCP and validates it back:

```
create_workflow   → cordon-aave-v3-guardian-0xf3f9aa  (id q2bo3mi6xrhm5ws4fae2m)
validate_workflow → { ok: true, result: { valid: true, nodeCount: 4 } }
```

The platform's own validation confirms the definition is well-formed; the
workflow is created `enabled: false` (dormant — a schedule trigger only fires
once a human enables it), which is the safe, deterministic default.

The exact workflow JSON as it exists on the platform is committed at
[`harness/workflows/guardian.platform.json`](workflows/guardian.platform.json).

## Why this matters for the theme

The KeeperHub theme is about **agents composing workflows deterministically**
— nothing inferred at execution time. Cordon's workflow is the demonstration:
authored as code, reviewed in the repo, dry-run and simulated before any
broadcast, and only ever executed exactly as written. The platform workflow
and the CLI guardian are two surfaces over one auditable definition.
