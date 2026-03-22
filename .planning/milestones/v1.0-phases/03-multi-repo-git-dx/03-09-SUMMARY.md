---
phase: 03-multi-repo-git-dx
plan: 09
subsystem: git
tags: [git, sync, dependency-install, lockfile-hash, conditional]

# Dependency graph
requires:
  - phase: 03-multi-repo-git-dx
    provides: sync executor structure from 03-08
provides:
  - Conditional dependency installation based on lockfile hash comparison before/after sync
  - Clone path always installs (unconditional), tag-fetch/strategy/local paths install only when lockfile changes
affects: [sync-executor]

# Tech tracking
tech-stack:
  added: []
  patterns: ['HEAD SHA before/after comparison for conditional side effects']

key-files:
  created: []
  modified:
    - packages/op-nx-polyrepo/src/lib/executors/sync/executor.ts
    - packages/op-nx-polyrepo/src/lib/executors/sync/executor.spec.ts

key-decisions:
  - 'Lockfile hash (SHA-256 of pnpm-lock.yaml/yarn.lock/package-lock.json) compared before and after sync -- only installs deps when lockfile content changes'
  - 'Clone path remains unconditional -- fresh checkout always needs dependency install'
  - 'Installed hash persisted to .repos/.<alias>.lock-hash so conditional install survives across sessions'

patterns-established:
  - 'Lockfile hash comparison: hash lockfile before/after mutation, conditionally execute side effects on change'

requirements-completed: [GITX-02]

# Metrics
duration: 3min
completed: 2026-03-11
---

# Phase 3 Plan 9: Conditional Dep Install Only When HEAD Changes Summary

**Sync executor skips dependency installation when lockfile hash unchanged, saving time on tag fetches and pulls that are already up to date**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-11T17:25:25Z
- **Completed:** 2026-03-11T17:28:08Z
- **Tasks:** 1 (TDD: RED + GREEN)
- **Files modified:** 2

## Accomplishments

- Added lockfile hash utilities (`hashLockfile`, `needsInstall`, `readInstalledHash`, `writeInstalledHash`) to sync executor
- Tag-fetch path checks lockfile hash and only installs deps when hash differs
- Strategy path (pull/fetch/rebase/ff-only) checks lockfile hash and only installs when hash differs
- Local repo path applies the same conditional install pattern
- Clone path remains unconditional (always installs after fresh checkout)
- Installed hash persisted to `.repos/.<alias>.lock-hash` for cross-session continuity
- 6 new unit tests verify all conditional install behaviors

## Task Commits

Each task was committed atomically (TDD flow):

1. **Task 1 RED: Failing conditional install tests** - `db3aba7` (test)
2. **Task 1 GREEN: Implement conditional install logic** - `b3b7b6f` (feat)

## Files Created/Modified

- `packages/op-nx-polyrepo/src/lib/executors/sync/executor.ts` - Added lockfile hash utilities and conditional tryInstallDeps based on hash comparison
- `packages/op-nx-polyrepo/src/lib/executors/sync/executor.spec.ts` - Added lockfile hash mocks, 6 new conditional install tests

## Decisions Made

- Used lockfile content hashing (SHA-256) rather than HEAD SHA comparison -- lockfile hash triggers install only when dependencies actually change, which is more precise than HEAD movement
- Clone path stays unconditional because a fresh clone always needs deps installed
- Installed hash persisted to `.repos/.<alias>.lock-hash` file so conditional install state survives Nx daemon restarts and `nx reset`

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

_Phase: 03-multi-repo-git-dx_
_Completed: 2026-03-11_
