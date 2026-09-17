## What

End-to-end execution latency instrumentation for the full pipeline issue #2289 describes — **event-tracker → SQS → executor → runner/broadcast** — in two halves:

### 1. Correlation ids + per-stage histograms

Every event trigger gets a **correlation id** minted at the moment it is first observed and carried through every stage, with **per-stage timestamps** and **latency histograms**:

```
observed → received → started → dispatched → broadcast → completed
```

### 2. A real broadcast stage across process boundaries

The web3 write paths (`lib/web3/chain-adapter/evm.ts`, `lib/web3/chain-adapter/solana.ts`, `lib/web3/sponsored-transaction-manager.ts`) call `markBroadcast()` at the exact broadcast point. The timestamp reaches the run that owns it through a per-execution **marker registry** (`keeperhub-executor/lib/broadcast-marker.ts`), the runner folds it into the latency timeline it ships to the executor, and the in-process path reads it back directly. The registered `keeperhub_executor_broadcasts_total` counter makes the stage observable even where the per-run file cannot be read back.

## Why

Latency today is only observable per-workflow from inside the engine (`workflow.execution.duration_ms`). Nothing distinguishes *producer → queue → executor* delay from *executor → runner* delay or *dispatch → broadcast* delay, and there is no key that joins an event's tracker-stage logs to its SQS/executor/runner-stage logs. This implements #2289's ask directly: a correlation id and stage timestamps from the event-tracker through the executor and into the web3 broadcast, plus histograms, so a slow producer, a slow queue, a slow runner and a slow broadcast are each visible independently — and a single run can be traced across three systems on one key.

## What changed (16 commits, 36 files, +3248/−36)

**Correlation-id half (`1d53470`, `4e6330e`, `edc6193`, `14c4390`, `1667d01`):**

| File | Change |
|---|---|
| `keeperhub-executor/latency.ts` (new) | `ExecutionLatency` stage tracker — idempotent marks (first wins), derived durations, JSON-safe log fields, CSPRNG `generateCorrelationId()` (16 hex, no new deps) |
| `keeperhub-executor/index.ts` | Correlation id reused/minted at receive; `dispatchExecution` marks `dispatched`, emits the receive→dispatch histogram and a structured `execution latency stages` line through `logInfo` (skipped for in-process, which records its own full-timeline line) |
| `keeperhub-executor/in-process.ts` | Marks `started`/`completed` around the engine call; receive→started + receive→completed histograms; correlation id on Completed/Fatal logs |
| `keeperhub-executor/k8s-job.ts` | `KH_CORRELATION_ID` env var + `correlation-id` pod label |
| `keeperhub-events/event-tracker/lib/correlation.ts` (new) | Shared `generateCorrelationId()` (same format as the executor's) |
| `.../lib/workflow-sqs.ts` | Optional `correlationId`/`observedAt` carried on the SQS message; absent for legacy callers (`undefined` is dropped by `JSON.stringify`) |
| `.../src/listener/event-listener.ts` | Id + `observedAt` minted at the moment the event is first observed; `observed <tx> correlationId=…` log line |
| `keeperhub-executor/types.ts` + `message-schema.ts` | Optional `correlationId`/`observedAt` on event messages; legacy messages without them still validate (drift guard kept) |
| `keeperhub-executor/workflow-runner.ts` | Emits `KH_CORRELATION_ID` on start, completion and fatal logs so the pod joins the same trace key |

**Broadcast-stage half (`39f978e`, `1ec86a2`, `063d858e3`):**

| File | Change |
|---|---|
| `keeperhub-executor/lib/broadcast-marker.ts` (new) | `markBroadcast()` — counters always increment, marker file written **only in a gated consumer process** (`enableBroadcastMarkers()` at `:98`, check at `:131`); per-execution file names (concurrent in-process runs cannot overwrite each other); `[A-Za-z0-9_-]{1,128}` id allowlist before any path or `rmSync`; reader-level content-vs-filename id checks in `peek`/`take` (a misfiled marker is consumed and discarded, never returned); `sweepBroadcastMarkers()` deletes only `.json` entries, non-recursive, counting only markers removed; lazy registered counter with pre-resolution buffering and a deterministic test seam |
| `lib/web3/chain-adapter/evm.ts:129,249`, `solana.ts:333`, `sponsored-transaction-manager.ts:144,214` | `markBroadcast()` at the exact broadcast points (transaction on the wire / Gas Station submit) |
| `keeperhub-executor/in-process.ts` | `recordInProcessLatency` reads the marker back inside the `try`; the failure catch takes the run's own marker (cleanup only — no latency stage is recorded on a failure path, so histograms never count a fake-fast sample) |
| `keeperhub-executor/workflow-runner.ts` | `enableBroadcastMarkers()` in `main()` (`:218`); `collectLatencyObservations` takes the marker after `executeWorkflow` and folds the stage into the shipped timeline; ALS bootstrap side-effect import so `currentExecutionId()` resolves without Next's `instrumentation.ts` |
| `keeperhub-executor/index.ts` | `enableBroadcastMarkers()` + `sweepBroadcastMarkers()` in `listen()` (`:1036`, `:1040`) — before the health server and the poll loop, so a startup sweep covers a process killed mid-run |
| `keeperhub-executor/lib/latency-observations.ts` | Collects runner-shipped observations, executor-side apply with regression test that a second collect does not re-ship |
| `keeperhub-executor/lib/workflow-error-context-bootstrap.ts` (new) | Registers the async-local error-context storage in non-Next processes (executor, runner); the same registration `instrumentation.ts` performs in the Next runtime |
| `lib/workflow/executor/executor.workflow.ts:2151-2160` | Comment only — states honestly that `enterWith` is the weaker mechanism, why it holds at run start, and that web3 writes take the proper `run()` at step level |

## Design notes

- **The registry is bounded by construction, not by cleanup.** Only processes that also remove markers may write them: the executor (`listen()`) and the runner (`main()`) call `enableBroadcastMarkers()`; the Next app pod runs the same `lib/web3` write paths (via `executeViaApi` for `EXECUTION_MODE=process`, webhook and MCP routes) and writes nothing. Inside a gated process, three removal paths bound the registry: the success take, the failure catch, and the startup sweep.
- **Counters are the guarantee, the sidecar is the optimization.** Every broadcast increments `keeperhub_executor_broadcasts_total` and the process-local count; an unsafe id or an ungated process never touches the filesystem. A missed marker degrades to a missing optional stage, never to a wrong number.
- **First mark wins** — a recovered/redelivered path can never overwrite the first observation, keeping the histograms honest.
- **Failure never fabricates latency** — `completed` is only marked when a terminal status lands; a crash shows as a missing series, not a fast fake reading. Error paths still carry the correlation id.
- **Backward compatible** — all new message fields are optional and the tracker omits them for legacy callers, so older producers/messages behave exactly as before (the executor falls back to minting its own id).
- **No new dependencies** — `node:crypto` and `node:fs` only.
- **Emission points are single** — in-process runs record their own full timeline; handed-off targets (k8s-job/api) record the receive→dispatch handoff. No double counts.

## Risk surface

### One fix in here is not about latency

`lib/workflow-error-context-bootstrap.ts` is a production fix riding along with this PR, and it deserves stating on its own rather than as a row under the broadcast table. `getWorkflowErrorContext()` was permanently `undefined` in the executor and runner images: `instrumentation.ts` performs that registration and those processes never load it, so workflow and org attribution was missing from every error log in those pods. The bootstrap registers the same storage as a side-effect import. It is not latency instrumentation and nothing in the histograms depends on it - it is the reason the async-local `currentExecutionId()` resolves outside Next at all.

The one piece of this PR that touches the filesystem from the write path is the marker registry, so it is hardened accordingly: writes are gated to consumer processes, ids are allowlisted before they reach `join()` or `rmSync`, every filesystem error is swallowed (observability cannot fail a transaction), the sweep deletes only `.json` entries non-recursively, and the counters carry the observable guarantee even when the sidecar is unavailable (read-only fs, sandbox, ungated process).

## Testing

- Executor suite: **205 tests passing** (13 latency/schema, 5 observed stage/queue leg/ordering, broadcast-marker unit tests incl. gate, allowlist, misfiled-marker rejection, sweep filter, deterministic counter, first-wins retention across a multi-write run; negative-epoch rejection and raw-vs-clamped stage delta; every TRIGGER_TYPES value accepted by the ingest validator (the allowlist is the platform’s own set, not a copy) and inherited object members rejected; an integration test drives the real `executeInProcess` failure catch with an engine mock that broadcasts through the real `markBroadcast` and throws)
- Event-tracker unit suite: **222 tests passing** (incl. SQS payload carry/legacy omission)
- `pnpm type-check:tsc:executor` and `pnpm type-check:tsc` clean (full repo)

## Verification for reviewers

```bash
pnpm install
npx vitest run keeperhub-executor
pnpm type-check:tsc:executor && pnpm type-check:tsc
cd keeperhub-events/event-tracker && npx vitest run tests/unit
```

Sample emitted line (tracker):

```
[EventListener:abc123] observed 0xdead… correlationId=1a2b3c4d5e6f7890
```

Sample emitted line (executor, in-process run). Emitted through `logInfo` (lib/logging), so it is the canonical structured line the pipeline already parses rather than a second, parallel format:

```
{"level":"info","ts":"…","msg":"execution latency stages","component":"executor_latency","correlation_id":"1a2b3c4d5e6f7890","workflow_id":"wf-1","execution_id":"exec-1","trigger_type":"event","dispatch_target":"in-process","observedAt":"…","receivedAt":"…","startedAt":"…","completedAt":"…","queueToStartMs":"50","totalMs":"200"}
```

## Follow-up (deliberately out of scope)

- Dashboard/alert wiring on the new histograms.
- Scheduler (cron/block) producers could carry the same id/observedAt — the executor already handles it whenever a message carries the fields.



