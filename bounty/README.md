# Bounty submission — Best KeeperHub Feature (track 2, $500)

The bounty deliverable is a **pull request to `keeperhub/keeperhub`**, separate
from the main-track BUIDL.

## ✅ Status: PR OPEN

**https://github.com/KeeperHub/keeperhub/pull/2360** — `feat(executor): end-to-end
latency instrumentation with correlation ids`, based on `staging`, verified
MERGEABLE, 13 new tests, executor suite at 138 passing.

Everything needed is in this folder:

| File | What it is |
|---|---|
| `PR-2289.patch` | The complete implementation as a git patch (committed branch `feat/executor-latency-instrumentation`, 6 files, 13 new tests) |
| `PR-2289-DESCRIPTION.md` | The pull-request body, ready to paste |

## Target: issue #2289 (latency instrumentation)

https://github.com/KeeperHub/keeperhub/issues/2289

- Labeled `accepted` — *"Reason, scope and plan all stand — a PR for this is
  welcome"* + `good first issue` + `help wanted`
- Chosen over #2331 (list-approvals), which is still `needs-discussion` and
  self-describes as *"not a call, it is a subsystem"* — too large for the
  bounty window

## To submit (≈3 minutes, only you can do this — it's your GitHub)

1. **Fork** `KeeperHub/keeperhub` on GitHub (one click, no files needed).
2. In a local clone of *your fork*, apply the patch and push the branch:

   ```bash
   git checkout -b feat/executor-latency-instrumentation
   git am PR-2289.patch          # or: git apply PR-2289.patch
   git push origin feat/executor-latency-instrumentation
   ```

3. **Open the PR** from your fork against `KeeperHub/keeperhub` with the body
   from `PR-2289-DESCRIPTION.md`. Reference `Closes #2289`.
4. File the **separate bounty BUIDL** on DoraHacks linking that PR.

> Say the word and I can push the branch for you the moment your fork exists
> (the branch + commit are ready in the local keeperhub clone).