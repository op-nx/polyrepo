---
phase: 11-full-nx-daemon-support
plan: 02
subsystem: sync-executor
tags: [nx-daemon, pre-caching, graph-extraction, sync-executor]

# Dependency graph
requires:
  - phase: 11-full-nx-daemon-support
    plan: 01
    provides: "computeRepoHash, writePerRepoCache exports from cache.ts"
provides:
  - "Pre-caching of graph data during polyrepo-sync for warm daemon startup"
  - "Progress logging during graph extraction and caching"
  - "Warn-and-continue on pre-cache extraction failure"
affects: [11-03]

# Tech tracking
tech-stack:
  added: []
  patterns: ["pre-cache graph after sync using shared hash function from cache.ts"]

key-files:
  created: []
  modified:
    - packages/op-nx-polyrepo/src/lib/executors/sync/executor.ts
    - packages/op-nx-polyrepo/src/lib/executors/sync/executor.spec.ts

key-decisions:
  - "Pre-cache at every syncRepo exit point where repo was successfully updated (clone, tag sync, pull/fetch, local pull) -- not just when install runs"
  - "hashObject(config.repos) computes reposConfigHash identically to index.ts, ensuring hash consistency between sync pre-cache and plugin cache"
  - "Pre-cache failure is non-blocking -- warns and continues, plugin extracts on next Nx command"

patterns-established:
  - "preCacheGraph helper encapsulates extract/transform/hash/write pipeline"
  - "Pre-caching runs regardless of whether install was needed, because source changes affect the graph even without lockfile changes"

requirements-completed: [DAEMON-04, DAEMON-05]

# Metrics
duration: 6min
completed: 2026-03-20
---

# Phase 11 Plan 02: Sync Pre-caching Summary

**Pre-caching graph data during polyrepo-sync so the first daemon invocation after sync hits a warm disk cache instead of triggering expensive extraction**

## Performance

- **Duration:** 6 min
- **Started:** 2026-03-20T12:59:14Z
- **Completed:** 2026-03-20T13:05:26Z
- **Tasks:** 1
- **Files modified:** 2

## Accomplishments
- Added `preCacheGraph` helper that runs extract/transform/hash/write pipeline after each successful repo sync
- Pre-caching runs at all 8 syncRepo exit points where the repo was updated (clone, tag sync with install, tag sync without install, pull with install, pull without install, local with install, local without install)
- Progress logging: "Extracting graph for ALIAS..." and "Cached graph for ALIAS (N projects)"
- Extraction failure during pre-cache warns and continues without blocking the sync
- Pre-caching skipped on dry run and when install fails
- Hash computation uses identical `hashObject(config.repos)` as the plugin cache layer, ensuring no hash mismatch
- 10 new unit tests covering all pre-cache scenarios

## Task Commits

Each task was committed atomically:

1. **Task 1: Add pre-caching to sync executor after install (TDD)**
   - `5ce1ea4` (test) -- Add failing tests for sync pre-caching (10 tests)
   - `0105e60` (feat) -- Implement preCacheGraph helper and wire into syncRepo
   - `1bcbb7a` (refactor) -- Remove unnecessary nullish coalescing on config.repos

## Files Created/Modified
- `packages/op-nx-polyrepo/src/lib/executors/sync/executor.ts` - Added preCacheGraph helper, imported graph pipeline modules, wired pre-caching into all syncRepo exit points
- `packages/op-nx-polyrepo/src/lib/executors/sync/executor.spec.ts` - 10 new tests in describe('pre-caching') block covering success, failure, dry-run, install-fail, local repos, and hash consistency

## Decisions Made
- Pre-cache at every syncRepo exit point where the repo was updated -- not just when install runs. Source changes (pull/fetch) affect the graph even without lockfile changes, so the cache should always be refreshed.
- `hashObject(config.repos)` used instead of `hashObject(config.repos ?? {})` because `config` from `resolvePluginConfig` is already validated, so `repos` is always defined.
- Pre-cache failure is non-blocking: warns "Plugin will extract on next Nx command" and lets the sync succeed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed unnecessary nullish coalescing lint error**
- **Found during:** Task 1 (GREEN step)
- **Issue:** `hashObject(config.repos ?? {})` flagged by `@typescript-eslint/no-unnecessary-condition` because `config.repos` is always defined after validation
- **Fix:** Changed to `hashObject(config.repos)`
- **Files modified:** packages/op-nx-polyrepo/src/lib/executors/sync/executor.ts
- **Verification:** Lint passes, all 350 tests pass
- **Committed in:** `1bcbb7a`

---

**Total deviations:** 1 auto-fixed (1 lint compliance fix)
**Impact on plan:** Minimal -- type-safe improvement, no scope creep.

## Issues Encountered
- Path separator mismatch in test assertions: `join()` on Windows produces backslashes, but test assertions initially used `expect.stringContaining('.repos/repo-a')` with forward slashes. Fixed by using `expect.stringMatching(/\.repos[\\/]repo-a/)` for cross-platform compatibility.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Pre-caching is complete and tested, ready for e2e verification in Plan 03
- The daemon's first graph computation after sync now reads from disk (~50-200ms) instead of spawning child `nx graph --print` processes (~4-60s per repo)
- All graph pipeline functions (extract, transform, computeRepoHash, writePerRepoCache) are exercised both by the plugin (cache.ts) and by the sync executor

## Self-Check: PASSED

All 2 modified files verified on disk. All 3 commits verified in git log.

---
*Phase: 11-full-nx-daemon-support*
*Completed: 2026-03-20*
