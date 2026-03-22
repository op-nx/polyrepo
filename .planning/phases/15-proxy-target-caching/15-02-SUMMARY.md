---
phase: 15-proxy-target-caching
plan: 02
subsystem: graph
tags: [nx-plugin, proxy-targets, caching, preTasksExecution, git, env-inputs]

# Dependency graph
requires:
  - phase: 15-proxy-target-caching
    plan: 01
    provides: toProxyHashEnvKey utility, getStatusPorcelain git helper, cache-enabled proxy targets
provides:
  - preTasksExecution hook that sets POLYREPO_HASH_<ALIAS> env vars before task hashing
  - Conditional nx reset fallback (PROXY-04) documented in sync executor
affects: [e2e tests, proxy target caching validation]

# Tech tracking
tech-stack:
  added: []
  patterns:
    [
      preTasksExecution hook for pre-hash env var injection,
      per-repo git state hashing with UUID fallback,
      deduplicated warning logging,
    ]

key-files:
  created: []
  modified:
    - packages/op-nx-polyrepo/src/index.ts
    - packages/op-nx-polyrepo/src/index.spec.ts
    - packages/op-nx-polyrepo/src/lib/executors/sync/executor.ts
    - packages/op-nx-polyrepo/src/lib/executors/sync/executor.spec.ts

key-decisions:
  - 'Module-level warnedAliases Set for warning deduplication, with _resetWarnedAliases export for test cleanup'
  - 'PROXY-04 nx reset fallback kept as commented-out code since env inputs bypass the daemon caching bug entirely'

patterns-established:
  - 'preTasksExecution computes git state per repo independently with try/catch isolation'
  - 'UUID fallback on git failure ensures cache miss (safe default) rather than stale cache hit'

requirements-completed: [PROXY-02, PROXY-03, PROXY-04, PROXY-05]

# Metrics
duration: 10min
completed: 2026-03-22
---

# Phase 15 Plan 02: preTasksExecution Hook and Conditional nx Reset Summary

**preTasksExecution hook computing per-repo git state hashes as POLYREPO*HASH*<ALIAS> env vars with UUID fallback and PROXY-04 commented-out nx reset**

## Performance

- **Duration:** 10 min
- **Started:** 2026-03-22T11:30:15Z
- **Completed:** 2026-03-22T11:40:42Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- Implemented `preTasksExecution` export in index.ts that computes deterministic git state hashes (HEAD sha + dirty flag) for every configured repo and sets them as POLYREPO*HASH*<ALIAS> env vars
- Per-repo isolation: one repo failing git commands does not prevent others from being hashed; failed repos get a random UUID (cache miss every invocation)
- Warning deduplication: same alias warned at most once per invocation via module-level Set
- Documented PROXY-04 fallback as commented-out nx reset block in sync executor, disabled by default since env inputs bypass the daemon caching bug

## Task Commits

Each task was committed atomically:

1. **Task 1: Implement preTasksExecution hook with git state hashing** - `e99eb8a` (test: RED), `024e314` (feat: GREEN)
2. **Task 2: Add conditional nx reset to sync executor** - `874051c` (feat)

_Note: Task 1 used TDD with RED-GREEN commits_

## Files Created/Modified

- `packages/op-nx-polyrepo/src/index.ts` - Added preTasksExecution export, warnGitFailure helper, \_resetWarnedAliases test helper
- `packages/op-nx-polyrepo/src/index.spec.ts` - 11 new test cases for preTasksExecution covering all behaviors; fixed lint errors in mock factories
- `packages/op-nx-polyrepo/src/lib/executors/sync/executor.ts` - Documented PROXY-04 fallback as commented-out nx reset block
- `packages/op-nx-polyrepo/src/lib/executors/sync/executor.spec.ts` - Test confirming nx reset is not called during normal sync

## Decisions Made

- Exposed `_resetWarnedAliases()` as an internal export for test cleanup rather than restructuring the module-level Set pattern -- the underscore prefix convention signals internal-only usage
- PROXY-04 nx reset is documented as commented-out code rather than a config flag, since the primary env-inputs approach bypasses nrwl/nx#30170 entirely and the fallback may never be needed
- PROXY-05 (daemon-safe caching) satisfied by design: env inputs use the stateless hash_env.rs code path, so no daemon-specific code paths exist

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed mock interference between preTasksExecution and createNodesV2 tests**

- **Found during:** Task 1
- **Issue:** Adding `vi.mock('./lib/config/schema')` broke existing createNodesV2 tests because `validateConfig` (from `./lib/config/validate`) imports `polyrepoConfigSchema` from `./lib/config/schema`, and the mock didn't include it
- **Fix:** Used `importOriginal` pattern to spread actual exports and only override `normalizeRepos`, with the real implementation as default
- **Files modified:** packages/op-nx-polyrepo/src/index.spec.ts
- **Verification:** All 382 tests pass
- **Committed in:** 024e314 (GREEN commit)

**2. [Rule 1 - Bug] Fixed module-level warnedAliases persisting across tests**

- **Found during:** Task 1
- **Issue:** The `warnedAliases` Set at module level persisted across test cases, causing warning dedup tests to fail when previous tests already populated the set for the same alias
- **Fix:** Added `_resetWarnedAliases()` export and called it in `setupPreTasksExecution()`
- **Files modified:** packages/op-nx-polyrepo/src/index.ts, packages/op-nx-polyrepo/src/index.spec.ts
- **Verification:** Warning dedup test passes consistently
- **Committed in:** 024e314 (GREEN commit)

---

**Total deviations:** 2 auto-fixed (2 bugs)
**Impact on plan:** Both fixes necessary for test correctness. No scope creep.

## Issues Encountered

None

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 15 is now fully complete: proxy targets declare env inputs (Plan 01), preTasksExecution sets the env vars (Plan 02)
- Full caching pipeline: preTasksExecution computes git hash -> sets POLYREPO*HASH*<ALIAS> -> Nx task hasher reads env input -> cache key changes when repo changes
- 382 tests passing, no new lint errors introduced
- PROXY-04 fallback documented but disabled (primary approach bypasses daemon bug)
- PROXY-05 satisfied by design (no daemon-specific code paths)

## Self-Check: PASSED
