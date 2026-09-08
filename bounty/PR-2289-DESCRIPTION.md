# PR description — use this as the pull-request body

Copy everything below into the PR you open on `keeperhub/keeperhub`.

---

## What

End-to-end execution latency instrumentation for the executor (closes #2289's
executor-stage slice): every trigger message now gets a **correlation id** minted
at SQS receive and threaded through dispatch, the runner pod and the in-process
engine, with **per-stage timestamps** and **latency histograms**:

```
received → started → dispatched → broadcast → completed
```

## Why

Latency today is only observable per-workflow from inside the engine
(`workflow.execution.duration_ms`). Nothing distinguishes *producer → queue →
executor* delay from *executor → runner* delay, and there is no key that joins
an execution's SQS-stage logs to its runner-stage logs. The issue asks for
exactly this: a correlation id and stage timestamps from event-tracker through
the executor, plus a histogram, so a slow producer, a slow queue and a slow
runner are each visible independently.

## What changed

| File | Change |
|---|---|
| `keeperhub-executor/latency.ts` (new) | `ExecutionLatency` stage tracker — idempotent marks (first wins), derived durations, JSON-safe log fields, CSPRNG `generateCorrelationId()` (16 hex, no new deps) |
| `keeperhub-executor/index.ts` | Correlation id minted at the earliest receipt in `processMessage`; `dispatchExecution` marks `dispatched`, emits the receive→dispatch histogram and a structured `[Executor:Latency]` summary line (skipped for in-process, which records its own full-timeline line) |
| `keeperhub-executor/in-process.ts` | Marks `started` immediately before the engine call and `completed` after the terminal status lands; emits receive→started + receive→completed histograms; correlation id appended to the existing Completed/Fatal log lines |
| `keeperhub-executor/k8s-job.ts` | `KH_CORRELATION_ID` env var + `correlation-id` pod label so runner-pod logs join the same trace key |
| `lib/metrics/types.ts` | `executor.dispatch.latency_ms`, `executor.execution.latency_ms` histograms; `correlation_id`, `dispatch_target` labels |
| `keeperhub-executor/latency.test.ts` (new) | 13 unit tests: id format/uniqueness, stage order, idempotency, durations, JSON-safe serialization, summary-line format, metric-constant drift guards |

## Design notes

- **First mark wins** — a recovered/redelivered path can never overwrite the
  first observation, which keeps the histogram honest.
- **Failure never fabricates latency** — `completed` is only marked when a
  terminal status lands, so a crash shows as a missing series, not a fast fake
  reading. The error path still carries the correlation id.
- **No new dependencies** — `node:crypto` only.
- **Emission points are single** — in-process runs record their own full
  timeline (they see started/completed); handed-off targets (k8s-job/api)
  record the receive→dispatch handoff in `dispatchExecution`. No double counts.

## Testing

- 13 new unit tests (`keeperhub-executor/latency.test.ts`)
- Executor suite: **138 tests passing** (`npx vitest run keeperhub-executor`)
- `tsgo -p keeperhub-executor --noEmit`: no errors in the touched files

## Follow-ups (deliberately out of scope)

- Event-tracker side: mint/propagate the correlation id at observation time and
  include it in the SQS message body, so the producer→queue leg is captured.
- Runner-side broadcast timestamp (`broadcast` stage) from the runner process.
- Dashboard/alert wiring on the new histograms.

## Verification steps for reviewers

```bash
pnpm install
npx vitest run keeperhub-executor/latency.test.ts
npx vitest run keeperhub-executor
```

A sample emitted line (from the unit test's summaryLine):

```
[Executor:Latency] correlationId=corr-1 workflowId=wf-1 executionId=exec-1 triggerType=event dispatchTarget=in-process receivedAt=... startedAt=... completedAt=... queueToStartMs=50 totalMs=200
```