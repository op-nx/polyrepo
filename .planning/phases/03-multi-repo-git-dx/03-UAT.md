---
status: complete
phase: 03-multi-repo-git-dx
source: 03-01-SUMMARY.md, 03-02-SUMMARY.md, 03-03-SUMMARY.md
started: 2026-03-11T12:00:00Z
updated: 2026-03-11T15:00:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Status - Aligned Multi-Repo Output
expected: Run `npm exec nx polyrepo-status` with synced repos. Output shows each repo on its own line with aligned columns: alias, branch, ahead/behind, dirty summary, project count. Summary line and legend printed at the bottom.
result: pass (re-verified after 03-06 fix)
note: Dirty summary now shows "behind" without redundant count. Summary line correct.

### 2. Status - Auto-Fetch Before Ahead/Behind
expected: Run `npm exec nx polyrepo-status`. The command automatically fetches from remotes before displaying ahead/behind counts -- you should NOT need to manually fetch first. If a remote is unreachable, it still shows status (graceful fallback).
result: pass

### 3. Status - Dirty Working Tree Warning
expected: Make an uncommitted change in a synced repo (e.g. edit a file without committing). Run status. The output shows a warning for that repo indicating it has dirty/uncommitted changes.
result: pass

### 4. Status - Detached HEAD / Tag-Pinned Warning
expected: If any synced repo is pinned to a tag (detached HEAD), status shows an appropriate warning for that repo (e.g. "detached HEAD").
result: pass (re-test)
note: Shows both [WARN: dirty, sync may fail] and [WARN: tag-pinned] correctly.

### 5. Sync --dry-run Shows Predicted Actions
expected: Run `npm exec nx polyrepo-sync -- --dryRun`. Output shows what action WOULD be taken per repo (e.g. would clone, would pull, would fetch tag, would skip) without executing any git commands. No actual cloning or pulling happens.
result: pass

### 6. Sync --dry-run Dirty Warning
expected: Make an uncommitted change in a synced repo, then run sync with --dryRun. Output includes a warning like "[WARN: dirty, may fail]" for the dirty repo.
result: pass (re-test)
note: Shows both [WARN: dirty, may fail] and [WARN: tag-pinned] simultaneously. Multi-warning array working correctly.

### 7. Sync Results Table
expected: Run a normal `npm exec nx polyrepo-sync` (without --dryRun). After streaming progress, an aligned Results table is printed showing each repo with [OK] or [ERROR] and the action taken (cloned, pulled, fetched tag, etc.).
result: pass

### 8. disableHooks - Sync with tag-pinned repo
expected: Set ref to "20.0.0" and sync. Sync completes without husky hook failure.
result: pass (verified after 03-07 fix)
note: Hooks silently skipped via core.hooksPath=__op-nx_polyrepo_disable-hooks__. Sync succeeds with [OK].

## Summary

total: 8
passed: 8
issues: 0
pending: 0
skipped: 0

## Gaps

Resolved gaps (03-06, 03-07):
- Row dirty summary "behind"/"ahead" without count — fixed in 03-06
- disableHooks config for external repos — fixed in 03-07

New gaps discovered during verification (deferred to next phase):
- truth: "Sync only installs deps when HEAD actually changed"
  status: open
  reason: "User reported: sync installs deps after every tag fetch even when repo is already at that tag"
  severity: minor
  test: 8
  root_cause: "syncRepo always calls tryInstallDeps after gitFetchTag (line 170) without checking if HEAD moved"
  artifacts:
    - path: "packages/op-nx-polyrepo/src/lib/executors/sync/executor.ts"
      issue: "tryInstallDeps called unconditionally after every sync strategy"
  missing:
    - "Compare HEAD before/after sync, only install when HEAD changed"
- truth: "isTagRef detects any git tag, not just version-like strings"
  status: open
  reason: "User reported: isTagRef uses regex /^v?\\d+\\.\\d+/ which misses tags like 20.x, v20.x, and non-version tags"
  severity: major
  test: N/A
  root_cause: "isTagRef pattern-matches the ref string instead of querying git"
  artifacts:
    - path: "packages/op-nx-polyrepo/src/lib/executors/sync/executor.ts"
      issue: "isTagRef uses regex instead of git tag -l"
    - path: "packages/op-nx-polyrepo/src/lib/executors/status/executor.ts"
      issue: "Same isTagRef regex duplicated"
  missing:
    - "Replace isTagRef regex with git tag lookup (git tag -l or git show-ref --verify refs/tags/<ref>)"
    - "Works for any tag name without assumptions about naming conventions"
