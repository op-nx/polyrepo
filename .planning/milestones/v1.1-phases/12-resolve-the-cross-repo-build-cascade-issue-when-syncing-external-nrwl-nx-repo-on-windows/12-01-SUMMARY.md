---
phase: 12-resolve-the-cross-repo-build-cascade-issue-when-syncing-external-nrwl-nx-repo-on-windows
plan: 01
subsystem: graph
tags: [nx, targetDefaults, dependsOn, proxy-executor, environment-isolation]

# Dependency graph
requires:
  - phase: 11-full-nx-daemon-support
    provides: per-repo cache architecture and daemon-aware extraction pipeline
provides:
  - rewriteDependsOn function for namespacing dependsOn project references
  - explicit dependsOn on all proxy targets blocking host targetDefaults merge
  - NX_DAEMON and NX_WORKSPACE_DATA_DIRECTORY env isolation in proxy executor
affects: [12-02 (e2e verification and workaround cleanup)]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - 'dependsOn preservation: proxy targets set explicit dependsOn (preserved or []) to block host targetDefaults merge'
    - 'env isolation: proxy executor passes NX_DAEMON=false and NX_WORKSPACE_DATA_DIRECTORY to child Nx via runCommandsImpl env option'

key-files:
  created: []
  modified:
    - packages/op-nx-polyrepo/src/lib/graph/transform.ts
    - packages/op-nx-polyrepo/src/lib/graph/transform.spec.ts
    - packages/op-nx-polyrepo/src/lib/executors/run/executor.ts
    - packages/op-nx-polyrepo/src/lib/executors/run/executor.spec.ts

key-decisions:
  - 'rewriteDependsOn namespaces only project names in object entries with projects arrays; string entries (caret, bare) and special keywords (self, dependencies) pass through unchanged'
  - 'Tag selectors (tag:*) in projects arrays pass through without namespacing since tags are preserved on namespaced projects'
  - 'Non-array dependsOn values treated as absent and return [] for safety'

patterns-established:
  - 'dependsOn preservation: every proxy target gets explicit dependsOn to block host targetDefaults merge'
  - 'env isolation: child Nx processes get their own workspace-data directory to prevent SQLite conflicts'

requirements-completed: [TDEF-01, TDEF-02, TDEF-03, BUILD-01]

# Metrics
duration: 6min
completed: 2026-03-21
---

# Phase 12 Plan 01: targetDefaults Isolation and Proxy Executor Env Isolation Summary

**rewriteDependsOn function preserves external repo dependsOn on proxy targets (blocking host targetDefaults merge), and proxy executor passes NX_DAEMON=false + NX_WORKSPACE_DATA_DIRECTORY to child processes for SQLite isolation**

## Performance

- **Duration:** 6 min
- **Started:** 2026-03-21T10:55:14Z
- **Completed:** 2026-03-21T11:01:26Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- Added `rewriteDependsOn` function that correctly handles all 5 dependsOn entry types: caret strings, bare strings, object entries with projects arrays (namespaced), object entries with string projects (self/dependencies pass-through), and tag selectors (pass-through)
- Every proxy target now gets an explicit `dependsOn` value -- either the preserved/rewritten original or `[]` for targets without dependsOn -- blocking host `targetDefaults` from leaking in
- Proxy executor now passes `NX_DAEMON=false` and `NX_WORKSPACE_DATA_DIRECTORY` to child Nx processes, preventing SQLite database conflicts between host and child workspaces
- 11 new tests added (9 dependsOn preservation + 2 env isolation), all 359 tests pass

## Task Commits

Each task was committed atomically:

1. **Task 1: Preserve dependsOn in proxy targets with rewriteDependsOn** - `af498f6` (feat)
2. **Task 2: Add environment isolation to proxy executor** - `221bf7d` (feat)

_Note: TDD tasks had RED/GREEN phases within each commit (tests written first, then implementation, committed together after GREEN)_

## Files Created/Modified

- `packages/op-nx-polyrepo/src/lib/graph/transform.ts` - Added `rewriteDependsOn` function and `dependsOn` field to `createProxyTarget` return value
- `packages/op-nx-polyrepo/src/lib/graph/transform.spec.ts` - Replaced "dependsOn omission" tests with 9 "dependsOn preservation" test cases
- `packages/op-nx-polyrepo/src/lib/executors/run/executor.ts` - Added `env` option to `runCommandsImpl` call with NX_DAEMON and NX_WORKSPACE_DATA_DIRECTORY
- `packages/op-nx-polyrepo/src/lib/executors/run/executor.spec.ts` - Added 2 tests for env var passing and Windows path normalization

## Decisions Made

- `rewriteDependsOn` namespaces only project names in object entries with explicit `projects` arrays; bare string entries like `"build-base"` are same-project target references and pass through unchanged
- Tag selectors (`tag:npm:public`) in projects arrays pass through without namespacing since tags are preserved on the namespaced projects by `transformGraphForRepo`
- Non-array `dependsOn` values (e.g., a raw string instead of an array) are treated as absent and return `[]`, providing the same host targetDefaults blocking behavior

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- dependsOn preservation and env isolation are in place
- Plan 12-02 can now verify the end-to-end fix by running builds through proxy targets and removing the `--exclude-task-dependencies` workaround

## Self-Check: PASSED

- [x] transform.ts exists
- [x] transform.spec.ts exists
- [x] executor.ts exists
- [x] executor.spec.ts exists
- [x] 12-01-SUMMARY.md exists
- [x] Commit af498f6 found in git log
- [x] Commit 221bf7d found in git log

---

_Phase: 12-resolve-the-cross-repo-build-cascade-issue-when-syncing-external-nrwl-nx-repo-on-windows_
_Completed: 2026-03-21_
