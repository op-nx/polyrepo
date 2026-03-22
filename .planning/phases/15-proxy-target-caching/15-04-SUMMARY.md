---
phase: 15-proxy-target-caching
plan: 04
subsystem: graph
tags: [nx-plugin, proxy-targets, caching, cache-key, plugin-version]

# Dependency graph
requires:
  - phase: 15-proxy-target-caching
    plan: 01
    provides: cache-enabled proxy targets with env-based inputs
  - phase: 15-proxy-target-caching
    plan: 02
    provides: preTasksExecution hook computing per-repo git state hashes
provides:
  - computeRepoHash includes plugin version in cache key for auto-invalidation on upgrade
affects: [e2e tests, disk cache invalidation on plugin upgrade]

# Tech tracking
tech-stack:
  added: []
  patterns: [module-level plugin version constant for cache key invalidation]

key-files:
  created: []
  modified:
    - packages/op-nx-polyrepo/src/lib/graph/cache.ts
    - packages/op-nx-polyrepo/src/lib/graph/cache.spec.ts

key-decisions:
  - 'PLUGIN_VERSION read at module load via readJsonFile and __dirname to avoid per-invocation I/O'
  - 'Fallback to dev-${Date.now()} on unreadable package.json forces cache miss (safe default)'
  - 'Plugin version placed as first element in hashArray for clarity of intent'

patterns-established:
  - 'Module-level IIFE for one-time package.json reads with try/catch fallback'

requirements-completed: [PROXY-01, PROXY-04]

# Metrics
duration: 5min
completed: 2026-03-22
---

# Phase 15 Plan 04: Plugin Version in Graph Disk Cache Key Summary

**PLUGIN_VERSION module constant included in computeRepoHash so plugin upgrades auto-invalidate stale disk caches**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-22T13:14:23Z
- **Completed:** 2026-03-22T13:19:50Z
- **Tasks:** 1
- **Files modified:** 2

## Accomplishments

- Added `PLUGIN_VERSION` module-level constant that reads the plugin's own `package.json` version at load time via `readJsonFile` and `__dirname`
- Included `PLUGIN_VERSION` as the first element in `computeRepoHash`'s `hashArray` call, ensuring all per-repo disk caches auto-invalidate when the plugin is upgraded
- Added 4 new tests covering version inclusion, different-version detection, stability, and fallback behavior
- Fixed 3 pre-existing lint errors in cache.spec.ts and 1 new lint error in cache.ts

## Task Commits

Each task was committed atomically:

1. **Task 1 (RED): Add failing tests for plugin version in cache key** - `a0f38d7` (test)
2. **Task 1 (GREEN): Include plugin version in graph disk cache key** - `b3987f6` (feat)

_Note: Task 1 used TDD with RED-GREEN commits_

## Files Created/Modified

- `packages/op-nx-polyrepo/src/lib/graph/cache.ts` - Added PLUGIN_VERSION constant and included it in computeRepoHash
- `packages/op-nx-polyrepo/src/lib/graph/cache.spec.ts` - 4 new tests for plugin version cache key behavior, 3 lint fixes

## Decisions Made

- Used `readJsonFile` with `__dirname`-relative path resolution (3 levels up to package.json) -- works identically in both source (SWC dev-time) and compiled (dist/) contexts since the project uses CJS (`module: "node16"`)
- Fallback to `dev-${Date.now()}` when package.json is unreadable ensures cache miss on every invocation (safe default) rather than silently serving stale data
- Plugin version placed as first element in `hashArray([PLUGIN_VERSION, ...])` to make its role visually clear in the code

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Removed stray debug console.error from preTasksExecution**

- **Found during:** Task 1 (GREEN phase)
- **Issue:** `console.error('[DEBUG polyrepo] preTasksExecution called')` was left in index.ts from a previous debugging session, producing stderr noise during every test run
- **Fix:** Removed the debug line; index.ts returned to committed state
- **Files modified:** packages/op-nx-polyrepo/src/index.ts (reverted to HEAD)
- **Verification:** Full test suite passes with no stderr debug output
- **Committed in:** Not needed -- removing the line restored the file to HEAD state

**2. [Rule 1 - Bug] Fixed lint errors in plan 04 code**

- **Found during:** Task 1 (GREEN phase)
- **Issue:** RED commit had 3 lint violations (non-null assertion, unused variable, prefer-expect-type-of) and implementation had 1 (restrict-template-expressions on Date.now())
- **Fix:** Changed `callArgs!` to `callArgs?.`, removed unused `mocks1` variable, replaced `expect(typeof hash).toBe('string')` with `expectTypeOf(hash).toBeString()`, wrapped `Date.now()` in `String()`
- **Files modified:** cache.ts, cache.spec.ts
- **Verification:** Lint error count 62 -> 59 (3 fewer than pre-existing 61 due to fixing shared issues)
- **Committed in:** b3987f6 (GREEN commit)

---

**Total deviations:** 2 auto-fixed (2 bugs)
**Impact on plan:** Both fixes necessary for code quality. No scope creep.

## Issues Encountered

None

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 15 gap closure complete: plugin version now part of cache key, resolving the stale `cache: false` disk cache issue identified in UAT
- Full caching pipeline: plugin version + repos config + git state -> deterministic cache key -> auto-invalidation on any change
- 386 tests passing, no new lint errors introduced
- Ready for Phase 16 (static edge migration) or milestone completion

## Self-Check: PASSED

All 2 modified files verified present. Both task commits verified in git log.

---

_Phase: 15-proxy-target-caching_
_Completed: 2026-03-22_
