## What

End-to-end execution latency instrumentation for the full pipeline the issue
describes — **event-tracker → SQS → executor → runner/broadcast**. Every event
trigger now gets a **correlation id** minted at the moment it is first observed
and carried through every stage, with **per-stage timestamps** and **latency
histograms**:

```
observed → received → started → dispatched → broadcast → completed
```

## Why

Latency today is only observable per-workflow from inside the engine
(`workflow.execution.duration_ms`). Nothing distinguishes *producer → queue →
executor* delay from *executor → runner* delay, and there is no key that joins
an event's tracker-stage logs to its SQS/executor/runner-stage logs. This
implements #2289's ask directly: a correlation id and stage timestamps from the
event-tracker through the executor, plus histograms, so a slow producer, a slow
queue and a slow runner are each visible independently — and a single run can be
traced across three systems on one key.

## What changed (2 commits, 13 files, +614/−13)

**Commit 1 — executor stage (`1d53470`):**
| File | Change |
|---|---|
| `keeperhub-executor/latency.ts` (new) | `ExecutionLatency` stage tracker — idempotent marks (first wins), derived durations, JSON-safe log fields, CSPRNG `generateCorrelationId()` (16 hex, no new deps) |
| `keeperhub-executor/index.ts` | Correlation id reused/minted at receive; `dispatchExecution` marks `dispatched`, emits the receive→dispatch histogram and a structured `[Executor:Latency]` summary line (skipped for in-process, which records its own full-timeline line) |
| `keeperhub-executor/in-process.ts` | Marks `started`/`completed` around the engine call; receive→started + receive→completed histograms; correlation id on Completed/Fatal logs |
| `keeperhub-executor/k8s-job.ts` | `KH_CORRELATION_ID` env var + `correlation-id` pod label |
| `lib/metrics/types.ts` | `executor.dispatch.latency_ms`, `executor.execution.latency_ms`; `correlation_id`, `dispatch_target` labels |

**Commit 2 — tracker + runner legs (`4e6330e`):**
| File | Change |
|---|---|
| `keeperhub-events/event-tracker/lib/correlation.ts` (new) | Shared `generateCorrelationId()` (same format as the executor's) |
| `.../lib/workflow-sqs.ts` | Optional `correlationId`/`observedAt` carried on the SQS message; absent for legacy callers (`undefined` is dropped by `JSON.stringify`) |
| `.../src/listener/event-listener.ts` | Id + `observedAt` minted at the moment the event is first observed; `observed <tx> correlationId=…` log line |
| `keeperhub-executor/types.ts` + `message-schema.ts` | Optional `correlationId`/`observedAt` on event messages; legacy messages without them still validate (drift guard kept) |
| `keeperhub-executor/workflow-runner.ts` | Emits `KH_CORRELATION_ID` on start, completion and fatal logs so the pod joins the same trace key |

## Design notes

- **First mark wins** — a recovered/redelivered path can never overwrite the
  first observation, keeping the histograms honest.
- **Failure never fabricates latency** — `completed` is only marked when a
  terminal status lands; a crash shows as a missing series, not a fast fake
  reading. Error paths still carry the correlation id.
- **Backward compatible** — all new message fields are optional and the tracker
  omits them for legacy callers, so older producers/messages behave exactly as
  before (the executor falls back to minting its own id).
- **No new dependencies** — `node:crypto` only.
- **Emission points are single** — in-process runs record their own full
  timeline; handed-off targets (k8s-job/api) record the receive→dispatch
  handoff. No double counts.

## Testing

- **20 new unit tests** (13 executor latency + schema, 5 executor observed
  stage/queue leg/ordering, 2 tracker SQS payload carry/legacy omission)
- Executor suite: **143 tests passing**
- Event-tracker unit suite: **222 tests passing**
- `tsc --noEmit` clean for both packages (touched files)

## Follow-up (deliberately out of scope)

- Dashboard/alert wiring on the new histograms.
- Scheduler (cron/block) producers could carry the same id/observedAt — the
  executor already handles it whenever a message carries the fields.

## Verification for reviewers

```bash
pnpm install
npx vitest run keeperhub-executor/latency.test.ts
npx vitest run keeperhub-executor
cd keeperhub-events/event-tracker && npx vitest run tests/unit
```

Sample emitted line (tracker):

```
[EventListener:abc123] observed 0xdead… correlationId=1a2b3c4d5e6f7890
```

Sample emitted line (executor, in-process run):

```
[Executor:Latency] correlationId=1a2b3c4d5e6f7890 workflowId=wf-1 executionId=exec-1 triggerType=event dispatchTarget=in-process observedAt=… receivedAt=… startedAt=… completedAt=… queueToStartMs=50 totalMs=200
```