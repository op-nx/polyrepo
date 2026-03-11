---
status: complete
phase: 03-multi-repo-git-dx
source: 03-01-SUMMARY.md, 03-02-SUMMARY.md, 03-03-SUMMARY.md
started: 2026-03-11T12:00:00Z
updated: 2026-03-11T12:15:00Z
---

## Current Test
<!-- OVERWRITE each test - shows where we are -->

[testing complete]

## Tests

### 1. Status - Aligned Multi-Repo Output
expected: Run `npm exec nx polyrepo-status` with synced repos. Output shows each repo on its own line with aligned columns: alias, branch, ahead/behind, dirty summary, project count. Summary line and legend printed at the bottom.
result: issue
reported: "works but summary line should list how many repos are behind and how many are ahead (e.g. '1 behind'), and 'clean' label could be more descriptive"
severity: minor

### 2. Status - Auto-Fetch Before Ahead/Behind
expected: Run `npm exec nx polyrepo-status`. The command automatically fetches from remotes before displaying ahead/behind counts -- you should NOT need to manually fetch first. If a remote is unreachable, it still shows status (graceful fallback).
result: pass

### 3. Status - Dirty Working Tree Warning
expected: Make an uncommitted change in a synced repo (e.g. edit a file without committing). Run status. The output shows a warning for that repo indicating it has dirty/uncommitted changes.
result: pass

### 4. Status - Detached HEAD / Tag-Pinned Warning
expected: If any synced repo is pinned to a tag (detached HEAD), status shows an appropriate warning for that repo (e.g. "detached HEAD").
result: issue
reported: "says 'dirty, sync may fail' instead of 'detached HEAD' when repo is pinned to a tag"
severity: major

### 5. Sync --dry-run Shows Predicted Actions
expected: Run `npm exec nx polyrepo-sync -- --dryRun`. Output shows what action WOULD be taken per repo (e.g. would clone, would pull, would fetch tag, would skip) without executing any git commands. No actual cloning or pulling happens.
result: pass

### 6. Sync --dry-run Dirty Warning
expected: Make an uncommitted change in a synced repo, then run sync with --dryRun. Output includes a warning like "[WARN: dirty, may fail]" for the dirty repo.
result: issue
reported: "dirty warning shows but masks detached HEAD warning — same root cause as Test 4"
severity: major

### 7. Sync Results Table
expected: Run a normal `npm exec nx polyrepo-sync` (without --dryRun). After streaming progress, an aligned Results table is printed showing each repo with [OK] or [ERROR] and the action taken (cloned, pulled, fetched tag, etc.).
result: pass

## Summary

total: 7
passed: 4
issues: 3
pending: 0
skipped: 0

## Gaps

- truth: "Summary line shows number of repos behind/ahead; dirty summary uses descriptive labels"
  status: failed
  reason: "User reported: works but summary line should list how many repos are behind and how many are ahead (e.g. '1 behind'), and 'clean' label could be more descriptive"
  severity: minor
  test: 1
  artifacts: []
  missing: []
- truth: "Status shows detached HEAD warning when repo is pinned to a tag"
  status: failed
  reason: "User reported: says 'dirty, sync may fail' instead of 'detached HEAD' when repo is pinned to a tag"
  severity: major
  test: 4
  artifacts: []
  missing: []
- truth: "Sync dry-run shows detached HEAD warning alongside dirty warning"
  status: failed
  reason: "User reported: dirty warning shows but masks detached HEAD warning — same root cause as Test 4"
  severity: major
  test: 6
  artifacts: []
  missing: []
