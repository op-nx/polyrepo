---
phase: 11-full-nx-daemon-support
plan: 01
subsystem: graph-cache
tags: [nx-daemon, per-repo-cache, exponential-backoff, cache-invalidation]

# Dependency graph
requires:
  - phase: 10-integration-and-end-to-end-validation
    provides: 'populateGraphReport with monolithic single-file cache, extraction/transform pipeline'
provides:
  - 'Three-layer per-repo cache (global gate, per-repo disk, per-repo extraction)'
  - 'Exported computeRepoHash and writePerRepoCache for sync pre-caching (Plan 02)'
  - 'Exponential backoff with hash-change reset for extraction failures'
  - 'Actionable troubleshooting warnings on extraction failure'
  - 'Old monolithic cache cleanup on first invocation'
affects: [11-02, 11-03]

# Tech tracking
tech-stack:
  added: []
  patterns:
    [
      'per-repo cache invalidation with global in-memory gate',
      'exponential backoff with hash-change reset',
    ]

key-files:
  created: []
  modified:
    - packages/op-nx-polyrepo/src/lib/graph/cache.ts
    - packages/op-nx-polyrepo/src/lib/graph/cache.spec.ts
    - packages/op-nx-polyrepo/src/index.ts

key-decisions:
  - 'Per-repo hash uses hashArray([reposConfigHash, alias, headSha, dirtyFiles]) -- lockfile hash unnecessary'
  - 'Backoff formula: min(2000 * 2^(attempt-1), 30000)ms with immediate reset on hash change'
  - 'Global gate checks both hash match and all-repos-cached to retry failed repos'
  - 'RepoGraphData uses interface instead of type alias for consistency'

patterns-established:
  - 'Per-repo cache files at .repos/<alias>/.polyrepo-graph-cache.json'
  - 'Module-level failureStates Map for daemon-persistent backoff tracking'
  - 'computeRepoHash/writePerRepoCache exported for cross-module pre-caching'

requirements-completed:
  [DAEMON-01, DAEMON-02, DAEMON-03, DAEMON-06, DAEMON-07, DAEMON-08]

# Metrics
duration: 4min
completed: 2026-03-20
---

# Phase 11 Plan 01: Per-repo Cache Summary

**Three-layer per-repo cache with global in-memory gate, disk recovery, selective invalidation, and exponential backoff with hash-change reset**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-20T12:50:05Z
- **Completed:** 2026-03-20T12:54:49Z
- **Tasks:** 2
- **Files modified:** 3

## Accomplishments

- Refactored monolithic single-file graph cache into per-repo architecture with three layers (global gate, per-repo disk, per-repo extraction)
- Added exponential backoff (2s, 4s, 8s, 16s, 30s cap) with immediate reset when repo hash changes after failure
- Exported `computeRepoHash` and `writePerRepoCache` for Plan 02 sync pre-caching integration
- Added actionable troubleshooting warnings with 4 steps (polyrepo-sync, NX_DAEMON=false, check .repos dir, NX_PLUGIN_NO_TIMEOUTS)
- Cleanup of old monolithic `.repos/.polyrepo-graph-cache.json` on first invocation
- 16 comprehensive unit tests covering all cache layers, backoff, hash-change reset, failure isolation, and exports

## Task Commits

Each task was committed atomically:

1. **Task 1: Refactor cache.ts to per-repo architecture (TDD)**
   - `951688c` (test) -- Add failing tests for per-repo cache architecture
   - `1327b19` (feat) -- Implement per-repo cache with three-layer invalidation and backoff
   - `95b9dd6` (refactor) -- Remove redundant alias field from repoHashes Map value
   - `5e37bea` (refactor) -- Clean up cache types, optional chaining, and test style

2. **Task 2: Update index.ts parameter naming** - `62fa6b1` (refactor)

## Files Created/Modified

- `packages/op-nx-polyrepo/src/lib/graph/cache.ts` - Refactored to per-repo cache with three layers, backoff, actionable warnings
- `packages/op-nx-polyrepo/src/lib/graph/cache.spec.ts` - 16 tests covering global gate, selective invalidation, disk cache, backoff, exports
- `packages/op-nx-polyrepo/src/index.ts` - Renamed reposHash to reposConfigHash for consistency

## Decisions Made

- Per-repo hash uses `hashArray([reposConfigHash, alias, headSha, dirtyFiles])` -- lockfile hash unnecessary since headSha + dirtyFiles already covers lockfile changes
- Backoff formula: `min(2000 * 2^(attempt-1), 30000)ms` with immediate reset on hash change
- Global gate checks both hash match AND all-repos-cached to ensure failed repos get retried
- Used `interface` instead of `type` alias for `RepoGraphData` for consistency with project conventions

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed lint issues in cache.spec.ts**

- **Found during:** Task 1 (REFACTOR step)
- **Issue:** `Unsafe return of a value of type 'any'` from loggerWarn mock calls map, and missing blank lines between `expectTypeOf`/`expect` assertions
- **Fix:** Added `[string]` tuple type to map callback parameter, added blank lines between assertions
- **Files modified:** packages/op-nx-polyrepo/src/lib/graph/cache.spec.ts
- **Verification:** All 338 tests pass, no lint errors in modified files
- **Committed in:** `5e37bea`

---

**Total deviations:** 1 auto-fixed (1 bug fix for lint compliance)
**Impact on plan:** Minimal -- lint compliance fix required for correctness. No scope creep.

## Issues Encountered

- `npm exec nx -- test @op-nx/polyrepo` without `--exclude-task-dependencies` fails because cross-repo edges cascade into the synced nx repo's `devkit:build` target. Used `--exclude-task-dependencies` flag as documented workaround.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- `computeRepoHash` and `writePerRepoCache` are exported and ready for Plan 02 (sync pre-caching)
- Per-repo cache architecture is complete and tested, ready for e2e verification in Plan 03
- Old monolithic cache file will be cleaned up automatically on first invocation

## Self-Check: PASSED

All 3 files verified on disk. All 5 commits verified in git log.

---

_Phase: 11-full-nx-daemon-support_
_Completed: 2026-03-20_
