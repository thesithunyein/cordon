# BUIDL draft — BOUNTY (Best KeeperHub Feature)

> Separate BUIDL from the main track. Link PR #2361 everywhere.

## Project name

End-to-end execution latency instrumentation for KeeperHub
(Cordon bounty entry — PR: https://github.com/KeeperHub/keeperhub/pull/2361)

## One-liner

A correlation id minted the moment KeeperHub first observes a workflow event, traced
through every stage of execution — event-tracker → SQS → executor → runner — with
per-stage timestamps and latency histograms, implementing the complete accepted issue
#2289.

## What the feature does

KeeperHub executes onchain value movement; operators had no way to answer "how long
did an execution take, and where did it spend that time?" This PR instruments the full
pipeline:

- **`event-tracker`** mints a `correlationId` when an event is first observed and
  stamps `observedAt`; both travel on the SQS message to the executor.
- **`executor`** reuses the tracker's id (no forked trace), adds the `observed` stage,
  and emits per-stage timestamps: `observed → received → started → dispatched →
  broadcast → completed`, with latency histograms over the stages.
- **`workflow-runner`** emits the correlation id on start/completion/fatal logs, so
  the runner joins the same trace.
- **Job pods** — the production dispatch path for web3 writes — ship point latency
  observations (`{correlationId, stage, durationMs}`) over the existing metrics
  ingest; the executor folds them into the central histograms. Pods cannot merge
  histogram state, but point samples compose exactly — so the headline
  observed→broadcast distribution is filled where nearly all production writes run,
  not just in-process executions. Clock-skew is bounded by anchoring completion on
  the executor's own received stamp; the correlation map is bounded and degrades
  gracefully.

Result: one grep-able key joins logs across three systems, and per-stage latency is
measurable in production — the groundwork for the SLO dashboards the issue calls for.

## Why it's valuable to the platform

- It implements **issue #2289 end to end** — the accepted, "PR welcome"-labeled issue
  on the executor backlog, in full rather than as a partial slice.
- Backward compatible: legacy messages without the correlation fields work unchanged;
  the executor mints its own id when the tracker didn't provide one.
- Zero new dependencies; follows existing repo patterns (idempotent marks, JSON-safe
  logs).

## Code quality and tests

- Full suites green: executor **168 tests** (143 before the PR), event-tracker
  **222 tests**; `tsc` clean in both packages; biome-formatted; LF-clean diff.
- Diff: 31 files, +1,920/−36 across 4 commits — round one implemented the pipeline,
  round two (same day as review) closed the Job-pod dispatch-path gap the first
  round left open.
- Review status: all four reviewer defects fixed point-by-point within a day,
  follow-up pushed; **CHANGES_REQUESTED, awaiting re-review**. If the size is a
  concern we'll split into reviewable pieces — offered publicly in the thread.

## Scope and completeness

Complete through the whole pipeline the issue describes, on both dispatch paths
(in-process and k8s Jobs). Both new metrics are documented in the platform's
`METRICS_REFERENCE.md`. The only documented follow-up is the consumer of the new
latency histograms (dashboard/alerting) — the issue's stage-2, not missing scope;
the instrumentation contract it needs is fully in place.

## Links

- PR: https://github.com/KeeperHub/keeperhub/pull/2361
- Accepted issue: https://github.com/KeeperHub/keeperhub/issues/2289
- Parent project (main-track entry): Cordon — https://github.com/thesithunyein/cordon
- Contact: sithunyein.mailto@gmail.com · X: [handle] · Discord: [handle]
