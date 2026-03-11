---
phase: 03-multi-repo-git-dx
plan: 09
subsystem: git
tags: [git, sync, dependency-install, head-sha, conditional]

# Dependency graph
requires:
  - phase: 03-multi-repo-git-dx
    provides: getHeadSha utility in git/detect.ts, sync executor structure from 03-08
provides:
  - Conditional dependency installation based on HEAD SHA comparison before/after sync
  - Clone path always installs (unconditional), tag-fetch/strategy/local paths install only when HEAD moved
affects: [sync-executor]

# Tech tracking
tech-stack:
  added: []
  patterns: ["HEAD SHA before/after comparison for conditional side effects"]

key-files:
  created: []
  modified:
    - packages/op-nx-polyrepo/src/lib/executors/sync/executor.ts
    - packages/op-nx-polyrepo/src/lib/executors/sync/executor.spec.ts

key-decisions:
  - "getHeadSha called before and after sync operation to detect HEAD movement -- simple string comparison determines if deps need install"
  - "Clone path remains unconditional -- fresh checkout always needs dependency install regardless of HEAD state"

patterns-established:
  - "Before/after SHA comparison: capture state before mutation, compare after, conditionally execute side effects"

requirements-completed: [GITX-02]

# Metrics
duration: 3min
completed: 2026-03-11
---

# Phase 3 Plan 9: Conditional Dep Install Only When HEAD Changes Summary

**Sync executor skips dependency installation when HEAD SHA unchanged, saving time on tag fetches and pulls that are already up to date**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-11T17:25:25Z
- **Completed:** 2026-03-11T17:28:08Z
- **Tasks:** 1 (TDD: RED + GREEN)
- **Files modified:** 2

## Accomplishments
- Imported `getHeadSha` from `git/detect` module in sync executor
- Tag-fetch path now captures HEAD before/after and only installs deps when SHA differs
- Strategy path (pull/fetch/rebase/ff-only) captures HEAD before/after and only installs when SHA differs
- Local repo path applies the same conditional install pattern
- Clone path remains unconditional (always installs after fresh checkout)
- 6 new unit tests verify all conditional install behaviors

## Task Commits

Each task was committed atomically (TDD flow):

1. **Task 1 RED: Failing conditional install tests** - `db3aba7` (test)
2. **Task 1 GREEN: Implement conditional install logic** - `b3b7b6f` (feat)

## Files Created/Modified
- `packages/op-nx-polyrepo/src/lib/executors/sync/executor.ts` - Added getHeadSha import, HEAD before/after comparison for conditional tryInstallDeps
- `packages/op-nx-polyrepo/src/lib/executors/sync/executor.spec.ts` - Added getHeadSha mock, 6 new conditional install tests

## Decisions Made
- Used `getHeadSha` (already exported from `git/detect.ts`) for simple string comparison of HEAD SHA before and after sync operations
- Clone path stays unconditional because a fresh clone always needs deps installed (HEAD goes from nonexistent to something)
- Default mock in beforeEach uses auto-incrementing counter so every call returns a unique SHA, preserving existing test behavior that expects install to run

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- All 9 Phase 3 gap closure plans complete
- Phase 3 (Multi-Repo Git DX) fully delivered
- All GITX requirements satisfied

## Self-Check: PASSED

- All 3 files verified present on disk
- Commit db3aba7 (RED) verified in git log
- Commit b3b7b6f (GREEN) verified in git log

---
*Phase: 03-multi-repo-git-dx*
*Completed: 2026-03-11*
