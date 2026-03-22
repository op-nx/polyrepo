---
phase: 03-multi-repo-git-dx
plan: 07
subsystem: git
tags: [git-hooks, sync, config, safety]

# Dependency graph
requires:
  - phase: 01-plugin-foundation-repo-assembly
    provides: git command wrappers, config schema, sync executor
provides:
  - disableHooks parameter on all git command functions
  - disableHooks boolean on NormalizedRepoEntry remote type (default true)
  - sync executor passes disableHooks from config to git commands
affects: [status-executor, future-git-operations]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - 'core.hooksPath=__op-nx_polyrepo_disable-hooks__ disables git hooks by pointing to nonexistent directory'
    - 'Opt-out pattern: safety feature defaults to on, user can disable per repo'

key-files:
  created: []
  modified:
    - packages/op-nx-polyrepo/src/lib/git/commands.ts
    - packages/op-nx-polyrepo/src/lib/config/schema.ts
    - packages/op-nx-polyrepo/src/lib/executors/sync/executor.ts
    - packages/op-nx-polyrepo/src/lib/executors/sync/executor.spec.ts
    - packages/op-nx-polyrepo/src/lib/git/commands.spec.ts
    - packages/op-nx-polyrepo/src/lib/config/schema.spec.ts

key-decisions:
  - 'Use __op-nx_polyrepo_disable-hooks__ as hooksPath value (nonexistent directory disables all hooks)'
  - 'disableHooks defaults to true (opt-out) because external repo hooks almost always fail in polyrepo context'
  - "Local repos do not get disableHooks (user's own repos where hooks should run normally)"

patterns-established:
  - 'Git config override via -c flag prepended before command args'
  - 'Per-repo boolean config with safe default, opt-out pattern'

requirements-completed: [GITX-02, GITX-03]

# Metrics
duration: 7min
completed: 2026-03-11
---

# Phase 03 Plan 07: Disable External Repo Git Hooks Summary

**Git hooks disabled by default during sync via core.hooksPath=**op-nx_polyrepo_disable-hooks** with per-repo opt-out**

## Performance

- **Duration:** 7 min
- **Started:** 2026-03-11T15:21:01Z
- **Completed:** 2026-03-11T15:28:01Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments

- All git command functions (clone, pull, fetch, pullRebase, pullFfOnly, fetchTag) accept disableHooks parameter
- execGit prepends `-c core.hooksPath=__op-nx_polyrepo_disable-hooks__` when disableHooks is true
- Config schema defaults disableHooks to true for remote repos, local repos unaffected
- Sync executor wires disableHooks from config to all git operations
- 249 tests pass (17 new tests added for disableHooks behavior)

## Task Commits

Each task was committed atomically:

1. **Task 1: Add disableHooks to git commands and config schema**
   - `737d914` (test: failing tests for disableHooks in git commands and config schema)
   - `10538cb` (feat: add disableHooks parameter to git commands and config schema)
2. **Task 2: Wire disableHooks through sync executor and add tests**
   - `aeca614` (test: failing tests for disableHooks wiring in sync executor)
   - `a1c3c80` (feat: wire disableHooks through sync executor to git commands)

_TDD: each task had RED (failing test) then GREEN (implementation) commits_

## Files Created/Modified

- `packages/op-nx-polyrepo/src/lib/git/commands.ts` - execGit accepts disableHooks, all exported functions pass it through
- `packages/op-nx-polyrepo/src/lib/config/schema.ts` - disableHooks on remoteRepoObject schema (default true), NormalizedRepoEntry type, normalizeRepos
- `packages/op-nx-polyrepo/src/lib/executors/sync/executor.ts` - getStrategyFn returns (cwd, dh?) signature, syncRepo passes entry.disableHooks
- `packages/op-nx-polyrepo/src/lib/executors/sync/executor.spec.ts` - 5 new disableHooks tests, all remote fixtures updated
- `packages/op-nx-polyrepo/src/lib/git/commands.spec.ts` - 10 new disableHooks tests covering all git functions
- `packages/op-nx-polyrepo/src/lib/config/schema.spec.ts` - 4 new tests for schema defaults and normalization

## Decisions Made

- Used `__op-nx_polyrepo_disable-hooks__` as the hooksPath value (a nonexistent directory effectively disables all hooks without relying on `/dev/null` which has cross-platform issues)
- disableHooks defaults to true for remote repos because external repo hooks (Husky, lint-staged) almost always fail in polyrepo context (wrong node path, missing deps)
- Local repos explicitly pass `undefined` for disableHooks since they are the user's own repos where hooks should run normally

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Updated existing test assertions for new function signatures**

- **Found during:** Task 2 (sync executor wiring)
- **Issue:** Existing tests for `gitPull` on local repos and `gitFetchTag` used strict argument matching that didn't account for the new `disableHooks` parameter
- **Fix:** Updated `toHaveBeenCalledWith('D:/projects/repo-b')` to `toHaveBeenCalledWith('D:/projects/repo-b', undefined)` and `gitFetchTag` to include 4th `true` argument
- **Files modified:** executor.spec.ts
- **Verification:** All 249 tests pass
- **Committed in:** a1c3c80 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Minor test assertion update required by the signature change. No scope creep.

## Issues Encountered

None

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- All Phase 3 gap closure plans (03-04 through 03-07) are complete
- Status executor's gitFetch call does not pass disableHooks yet (noted for future: status auto-fetch may want disableHooks too)
- The disableHooks pattern is established and can be extended to any new git operations

## Self-Check: PASSED

- All 7 files verified on disk
- All 4 task commits verified in git log (737d914, 10538cb, aeca614, a1c3c80)
- 249 tests pass with 0 failures

---

_Phase: 03-multi-repo-git-dx_
_Completed: 2026-03-11_
