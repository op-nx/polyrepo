---
phase: 12-resolve-the-cross-repo-build-cascade-issue-when-syncing-external-nrwl-nx-repo-on-windows
plan: 02
subsystem: graph
tags: [nx, targetDefaults, preVersionCommand, exclude-task-dependencies, verification]

# Dependency graph
requires:
  - phase: 12-resolve-the-cross-repo-build-cascade-issue-when-syncing-external-nrwl-nx-repo-on-windows
    provides: dependsOn preservation and env isolation in proxy targets and executor
provides:
  - removal of --exclude-task-dependencies workaround from preVersionCommand
  - verified end-to-end cross-repo build cascade via proxy executor on Windows
affects: [e2e tests, release workflow]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "preVersionCommand uses --exclude tag:polyrepo:external alone (no --exclude-task-dependencies) since proxy executor handles cascade correctly"

key-files:
  created: []
  modified:
    - nx.json

key-decisions:
  - "--exclude-task-dependencies removed from preVersionCommand: proxy executor with env isolation handles cross-repo cascade correctly, making the overly aggressive flag unnecessary"
  - "Stale disk cache (.polyrepo-graph-cache.json) must be cleared after plugin transform logic changes: cache hash is based on repo state (git SHA), not plugin code version, so transform changes are invisible to cache invalidation"
  - "Host targetDefaults.test.dependsOn still overwrites plugin dependsOn on external test targets due to Nx mergeTargetDefaultWithTargetDefinition behavior: functionally harmless since proxy executor delegates to child repo"

patterns-established:
  - "After plugin transform logic changes: clear .repos/<alias>/.polyrepo-graph-cache.json and run nx reset to force re-extraction"

requirements-completed: [BUILD-02]

# Metrics
duration: 18min
completed: 2026-03-21
---

# Phase 12 Plan 02: End-to-end Verification and --exclude-task-dependencies Cleanup Summary

**Removed --exclude-task-dependencies workaround from preVersionCommand after verifying cross-repo build cascade works end-to-end via proxy executor with dependsOn preservation and env isolation**

## Performance

- **Duration:** 18 min
- **Started:** 2026-03-21T11:20:48Z
- **Completed:** 2026-03-21T11:39:01Z
- **Tasks:** 1 of 2 (Task 2 is human-verify checkpoint)
- **Files modified:** 1

## Accomplishments
- Verified `nx test @op-nx/polyrepo` passes without `--exclude-task-dependencies` (359 tests green)
- Verified `nx build @op-nx/polyrepo` succeeds with full cross-repo cascade through proxy executor (8 dependent tasks including nx:build-native, nx:build-base, devkit:build-base, devkit:build)
- Verified `nx run-many -t build --exclude tag:polyrepo:external` succeeds without `--exclude-task-dependencies`
- Removed `--exclude-task-dependencies` from preVersionCommand in nx.json
- Discovered and fixed stale disk cache issue (Rule 1 auto-fix): old cache from before Plan 12-01 had `dependsOn: undefined` on all targets, causing host targetDefaults to leak despite the new rewriteDependsOn function

## Task Commits

Each task was committed atomically:

1. **Task 1: Verify nx test works without --exclude-task-dependencies and evaluate preVersionCommand** - `2da3471` (fix)
2. **Task 2: Human verification of end-to-end fix** - awaiting checkpoint

## Files Created/Modified
- `nx.json` - Removed `--exclude-task-dependencies` from preVersionCommand (line 74)

## Decisions Made
- **Removed --exclude-task-dependencies:** Testing proved it redundant. The `--exclude tag:polyrepo:external` flag already filters external projects from `run-many`. The only remaining cascade is `@op-nx/polyrepo -> nx/devkit:build` via `^build`, which now works correctly through the proxy executor with env isolation.
- **Stale cache cleared, not code-fixed:** The disk cache hash is based on repo state (git SHA, dirty files, config hash) not plugin code version. Clearing the cache file was the appropriate fix for this one-time transition. A more robust solution (including plugin version in cache hash) is a potential future enhancement but out of scope.
- **Host targetDefaults.test.dependsOn override accepted:** Nx's `mergeTargetDefaultWithTargetDefinition` overwrites plugin-registered `dependsOn` on test targets with the host's `targetDefaults.test.dependsOn: ["^build"]`. This is cosmetically incorrect (external test targets show `["^build"]` instead of their native dependsOn) but functionally harmless -- the proxy executor delegates to the child repo regardless.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Stale disk cache blocked dependsOn preservation**
- **Found during:** Task 1 (verification of targetDefaults isolation)
- **Issue:** `.repos/nx/.polyrepo-graph-cache.json` contained cached proxy targets from before Plan 12-01 with `dependsOn: undefined` on all targets. The cache hash (based on repo git state) still matched, so the plugin loaded stale data instead of re-extracting with the new `rewriteDependsOn` function.
- **Fix:** Deleted the stale cache file and ran `nx reset` to clear in-memory state. Re-extraction produced correct cache with preserved dependsOn values.
- **Files modified:** `.repos/nx/.polyrepo-graph-cache.json` (deleted and regenerated)
- **Verification:** Post-fix cache shows `test.dependsOn: ["test-native","build-native","^build-native"]`, `build.dependsOn: ["^build","build-base","legacy-post-build"]`, `lint.dependsOn: ["build-native","^build-native"]` -- all correct.
- **Committed in:** Not committed (runtime operation on gitignored cache file)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Cache fix was necessary to verify the dependsOn preservation feature actually works end-to-end. No scope creep.

## Issues Encountered
- First test run after fresh graph extraction timed out (exit code 130) due to full dependency cascade through the external repo (8 tasks instead of 1). Adding `NX_PLUGIN_NO_TIMEOUTS=true` resolved the timeout. Subsequent runs use Nx cache and are fast.
- `lint.executor` on external projects shows `nx:run-commands` instead of `@op-nx/polyrepo:run` -- this is the host `targetDefaults.lint.command` leaking the `command` field which causes Nx to infer `nx:run-commands` as the executor. The `dependsOn` fix doesn't address this because `command` is a separate field. Noted as a potential future enhancement (setting explicit `command: undefined` or empty on proxy targets) but out of scope for this plan.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Phase 12 is functionally complete: dependsOn preservation, env isolation, and preVersionCommand cleanup all verified
- Task 2 checkpoint awaiting user verification of end-to-end fix
- The "Task cascading via ^build" blocker in STATE.md can be removed once user confirms

## Self-Check: PENDING

Self-check will be completed after Task 2 checkpoint is resolved.

---
*Phase: 12-resolve-the-cross-repo-build-cascade-issue-when-syncing-external-nrwl-nx-repo-on-windows*
*Completed: 2026-03-21*
