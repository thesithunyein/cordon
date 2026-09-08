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

- **20 new tests** across both packages; full suites green: executor **143 tests**,
  event-tracker **222 tests**.
- `tsc` clean in both packages; LF-clean diff (13 files, +614/−13); biome-formatted.
- PR: **OPEN and MERGEABLE** against `staging` (no conflicts, issue-link check
  passing).

## Scope and completeness

Complete through the whole pipeline the issue describes. The only documented
follow-up is the consumer of the new latency histograms (dashboard/alerting), which
is the issue's stage-2 rather than missing scope — the instrumentation contract it
needs is fully in place.

## Links

- PR: https://github.com/KeeperHub/keeperhub/pull/2361
- Accepted issue: https://github.com/KeeperHub/keeperhub/issues/2289
- Parent project (main-track entry): Cordon — https://github.com/thesithunyein/cordon
- Contact: sithunyein.mailto@gmail.com · X: [handle] · Discord: [handle]
