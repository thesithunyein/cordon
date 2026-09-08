# Bounty submission — Best KeeperHub Feature (track 2, $500)

The bounty deliverable is a **pull request to `keeperhub/keeperhub`**, separate
from the main-track BUIDL.

## ✅ Status: PR OPEN — full issue scope

**https://github.com/KeeperHub/keeperhub/pull/2361** — `feat(executor):
end-to-end latency instrumentation with correlation ids`, based on `staging`,
verified MERGEABLE.

Covers the **complete** pipeline from issue #2289 (not just the executor slice):

```
observed → received → started → dispatched → completed
(event-tracker → SQS → executor → runner/in-process)
```

- **2 commits, 13 files, +614/−13**, all authored as Sithu Nyein
  <sithunyein.mailto@gmail.com> (zero Codebuff / third-party attribution)
- **20 new unit tests**; executor suite **143 passing**; event-tracker unit
  suite **222 passing**; `tsc` clean for both packages
- Backward compatible: all new message fields optional, legacy callers
  unaffected
- Targets the **accepted** issue #2289 (labeled "PR welcome", good-first-issue)

Everything needed is in this folder:

| File | What it is |
|---|---|
| `PR-2361.diff` | The complete implementation as a git diff (13 files) |
| `PR-2361-DESCRIPTION.md` | The pull-request body (live on #2361) |

## Target: issue #2289 (latency instrumentation)

https://github.com/KeeperHub/keeperhub/issues/2289

- Labeled `accepted` — *"Reason, scope and plan all stand — a PR for this is
  welcome"* + `good first issue` + `help wanted`
- Chosen over #2331 (list-approvals), which is still `needs-discussion` and
  self-describes as *"not a call, it is a subsystem"* — too large for the
  bounty window

## State of the PR

- Fork: https://github.com/thesithunyein/keeperhub (branch
  `feat/executor-latency-instrumentation`)
- CI from forks waits for a maintainer to approve the run (standard GitHub
  behavior — the repo's own bot confirms "nothing is needed from you")
- Merge blocked only by branch protection's required review — no conflicts,
  issue-link check passing

> A polite nudge comment after 48h is fine; per the repo's bot, nothing is
> actually required from the author — this is a waiting game for maintainer
> approval + review.