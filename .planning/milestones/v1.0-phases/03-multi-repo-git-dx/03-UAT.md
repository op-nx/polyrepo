---
status: complete
phase: 03-multi-repo-git-dx
source: 03-01-SUMMARY.md, 03-02-SUMMARY.md, 03-03-SUMMARY.md
started: 2026-03-11T12:00:00Z
updated: 2026-03-11T23:00:00Z
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
note: Hooks silently skipped via core.hooksPath=**op-nx_polyrepo_disable-hooks**. Sync succeeds with [OK].

### 9. Quiet Install / --verbose

expected: Run `npm exec nx polyrepo-sync`. Install output is suppressed (silent mode). Log shows "(pnpm via corepack, silent mode)..." or similar. Run again with `--verbose` — full PM output streams through.
result: pass
note: Per-PM quiet flags (pnpm --reporter=silent, yarn --silent, npm --loglevel=error). --verbose bypasses quiet flags. stdin closed to suppress interactive prompts.

### 10. Install Failure Tracking

expected: When dependency install fails (e.g. cypress on arm64), results table shows `[WARN: install failed]` instead of `[OK]`. Summary line counts warnings separately: "1 synced with warning".
result: pass
note: Verified with cypress postinstall failure on arm64. First run shows warning correctly.

### 11. Install Retry After Failure

expected: When install fails on first sync, re-running sync for the same ref retries the install instead of silently reporting [OK]. Uses stored lockfile hash — if the hash file is missing or mismatched, install runs.
result: pass
note: Stored hash (.op-nx-installed-lock-hash) written after successful install. Missing hash triggers retry. Verified: switch to tag 20.0.0 (install fails), re-run sync (install retried, still shows warning).

### 12. Corepack Download Prompt

expected: When syncing between refs that use different pnpm versions (e.g. tag 20.3.0 uses pnpm@9.x, master uses pnpm@9.8.0), corepack does not stall waiting for download confirmation. Install proceeds non-interactively.
result: pass
note: COREPACK_ENABLE_DOWNLOAD_PROMPT=0 set in spawn env. Previously stalled indefinitely when switching between tags with different packageManager versions.

### 13. Branch Transition (tag-to-branch)

expected: Set ref to a tag (e.g. "21.0.0"), sync, then change ref to a branch (e.g. "master") and sync again. The sync correctly switches from detached HEAD to the target branch before pulling. No "fatal: not on a branch" error.
result: pass
note: gitCheckoutBranch does fetch origin <branch> + checkout with -b fallback. Dry-run shows "would switch to master and pull".

### 14. Sync --dry-run Branch Switch

expected: When repo is on a different branch/detached HEAD than configured ref, dry-run shows "would switch to <ref> and <strategy>" instead of just "would pull".
result: pass
note: Verified with detached HEAD at tag while ref configured as branch.

## Summary

total: 14
passed: 14
issues: 0
pending: 0
skipped: 0

## Gaps

Resolved gaps (03-06 through 03-09 and follow-up fixes):

- Row dirty summary "behind"/"ahead" without count — fixed in 03-06
- disableHooks config for external repos — fixed in 03-07
- isTagRef regex replaced with git-based isGitTag — fixed in 03-08
- Conditional dep install (lockfile hash, not unconditional) — fixed in 03-09
- Corepack download prompt stall — fixed (COREPACK_ENABLE_DOWNLOAD_PROMPT=0)
- Install failure not surfaced in results — fixed (installFailed flag, warning counts)
- Install retry after failure — fixed (stored lockfile hash replaces marker approach)
- Branch transition from tag/wrong branch — fixed (gitCheckoutBranch)

No open gaps remaining.
