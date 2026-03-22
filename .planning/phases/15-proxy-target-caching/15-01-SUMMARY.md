---
phase: 15-proxy-target-caching
plan: 01
subsystem: graph
tags: [nx-plugin, proxy-targets, caching, git, env-inputs]

# Dependency graph
requires:
  - phase: 14-temp-dir-rename
    provides: stable temp directory layout for child repos
provides:
  - toProxyHashEnvKey utility for shared env key normalization
  - getStatusPorcelain git helper for dirty detection
  - createProxyTarget with cache: true and env-based inputs
affects: [15-02, preTasksExecution hook, e2e tests]

# Tech tracking
tech-stack:
  added: []
  patterns:
    [env-based proxy target cache inputs, shared env key normalization utility]

key-files:
  created:
    - packages/op-nx-polyrepo/src/lib/graph/proxy-hash.ts
    - packages/op-nx-polyrepo/src/lib/graph/proxy-hash.spec.ts
  modified:
    - packages/op-nx-polyrepo/src/lib/git/detect.ts
    - packages/op-nx-polyrepo/src/lib/git/detect.spec.ts
    - packages/op-nx-polyrepo/src/lib/graph/transform.ts
    - packages/op-nx-polyrepo/src/lib/graph/transform.spec.ts

key-decisions:
  - 'toProxyHashEnvKey placed in dedicated proxy-hash.ts module for shared import between createProxyTarget and future preTasksExecution'
  - 'getStatusPorcelain uses execGitOutput (trimmed) since only empty vs non-empty matters for dirty detection'

patterns-established:
  - 'Env key normalization: POLYREPO_HASH_ prefix + uppercase + replace non-alphanumeric with underscore'
  - 'Proxy targets declare cache: true with inputs: [{ env: toProxyHashEnvKey(alias) }] for host-level caching'

requirements-completed: [PROXY-01, PROXY-02]

# Metrics
duration: 8min
completed: 2026-03-22
---

# Phase 15 Plan 01: Proxy Hash Utility and Cache-Enabled Proxy Targets Summary

**Shared env key normalization utility (toProxyHashEnvKey), git status porcelain helper, and cache: true with env-based inputs on all proxy targets**

## Performance

- **Duration:** 8 min
- **Started:** 2026-03-22T11:14:45Z
- **Completed:** 2026-03-22T11:23:42Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments

- Created `toProxyHashEnvKey` utility that normalizes any repo alias to a valid `POLYREPO_HASH_<ALIAS>` env var name, shared between `createProxyTarget` and the future `preTasksExecution` hook
- Added `getStatusPorcelain` to detect.ts for lightweight dirty detection via `git status --porcelain`
- Updated `createProxyTarget` from `cache: false, inputs: []` to `cache: true, inputs: [{ env: envKey }]`, enabling host-level Nx caching for proxy targets

## Task Commits

Each task was committed atomically:

1. **Task 1: Create proxy-hash utility and add getStatusPorcelain** - `5b6c65b` (test: RED), `21303fb` (feat: GREEN)
2. **Task 2: Update createProxyTarget to enable caching with env input** - `23c2db2` (feat)

_Note: Task 1 used TDD with RED-GREEN commits_

## Files Created/Modified

- `packages/op-nx-polyrepo/src/lib/graph/proxy-hash.ts` - toProxyHashEnvKey utility for env key normalization
- `packages/op-nx-polyrepo/src/lib/graph/proxy-hash.spec.ts` - 6 test cases for env key normalization edge cases
- `packages/op-nx-polyrepo/src/lib/git/detect.ts` - Added getStatusPorcelain helper
- `packages/op-nx-polyrepo/src/lib/git/detect.spec.ts` - 3 test cases for getStatusPorcelain
- `packages/op-nx-polyrepo/src/lib/graph/transform.ts` - createProxyTarget now uses cache: true and env input
- `packages/op-nx-polyrepo/src/lib/graph/transform.spec.ts` - Updated assertions for cache/inputs behavior

## Decisions Made

- Placed `toProxyHashEnvKey` in a dedicated `proxy-hash.ts` module rather than inlining in transform.ts, because both `createProxyTarget` (declares the input) and the future `preTasksExecution` hook (sets the env var) need identical normalization
- Used `execGitOutput` (trimmed) for `getStatusPorcelain` since only empty vs non-empty matters for dirty detection -- the trimming is acceptable

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Plan 02 can now implement `preTasksExecution` hook using the `toProxyHashEnvKey` and `getStatusPorcelain` utilities established here
- All proxy targets already declare `cache: true` with the correct env input key pattern
- Full test suite green (370 tests passing)
- Pre-existing lint errors (58) are out of scope for this plan

## Self-Check: PASSED

All 6 files verified present. All 3 task commits verified in git log.

---

_Phase: 15-proxy-target-caching_
_Completed: 2026-03-22_
