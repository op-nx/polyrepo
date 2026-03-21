---
phase: 11-full-nx-daemon-support
plan: 03
subsystem: e2e-testing
tags: [nx-daemon, e2e, docker, testcontainers, env-forwarding, skip-nx-cache]

# Dependency graph
requires:
  - phase: 11-full-nx-daemon-support
    plan: 01
    provides: "Per-repo cache architecture with three-layer invalidation"
  - phase: 11-full-nx-daemon-support
    plan: 02
    provides: "Pre-caching of graph data during polyrepo-sync"
provides:
  - "E2e verification under all three NX_DAEMON modes (true, false, unset)"
  - "Host NX_DAEMON env forwarding to test containers via withEnvironment"
  - "Cache-bypass test (--skip-nx-cache) proving graph correctness from scratch"
  - "Daemon reset after writeNxJson to prevent stale graph in daemon mode"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns: ["testcontainers withEnvironment for env forwarding to Docker containers", "daemon stop after config mutation in e2e helpers"]

key-files:
  created:
    - .planning/research/nx-sqlite-windows-locking.md
  modified:
    - packages/op-nx-polyrepo-e2e/docker/Dockerfile
    - packages/op-nx-polyrepo-e2e/src/setup/container.ts
    - packages/op-nx-polyrepo-e2e/src/cross-repo-deps.spec.ts
    - .gitignore
    - nx.json

key-decisions:
  - "NX_DAEMON removed from Dockerfile workspace ENV -- controlled by test environment via container.ts withEnvironment"
  - "Build-time RUN commands retain inline NX_DAEMON=false prefixes (nx-prep, workspace, snapshot stages)"
  - "Daemon stopped after every writeNxJson to prevent stale graph cache when daemon is running"
  - "E2e tests require --exclude-task-dependencies due to ^build cascade into synced repos"

patterns-established:
  - "NX_DAEMON forwarding from host to container via testcontainers withEnvironment API"
  - "Inline exec for tests needing extra flags not supported by helpers (e.g., --skip-nx-cache)"
  - "Daemon stop after config mutation in e2e helpers to ensure fresh graph computation"

requirements-completed: [DAEMON-09, DAEMON-10, DAEMON-11]

# Metrics
duration: 12min
completed: 2026-03-21
---

# Phase 11 Plan 03: E2e Daemon Mode Verification Summary

**E2e tests verified under all NX_DAEMON modes (true/false/unset) with host env forwarding, cache-bypass test, and daemon-stale-graph fix**

## Performance

- **Duration:** ~12 min (automated tasks) + human checkpoint verification
- **Started:** 2026-03-20T13:09:35Z
- **Completed:** 2026-03-21
- **Tasks:** 3
- **Files modified:** 6

## Accomplishments
- Removed `NX_DAEMON=false` from Dockerfile workspace stage ENV, enabling daemon mode testing
- Added host `NX_DAEMON` env forwarding to test containers via testcontainers `withEnvironment` API
- Added `--skip-nx-cache` verification test proving graph is computed correctly from scratch (DAEMON-11)
- Fixed daemon stale graph cache bug: `writeNxJson` now stops the daemon after config mutation
- Verified all 8 e2e tests pass under 6 combinations (3 daemon modes x 2 cache modes)
- All 350 unit tests continue to pass under all daemon modes
- Pinned synced nx repo to `22.5.4` tag for reproducible builds

## Task Commits

Each task was committed atomically:

1. **Task 1: Update Dockerfile and container.ts for daemon mode forwarding** - `daf475c` (feat)
2. **Task 2: Add --skip-nx-cache verification test** - `d5b2d2c` (test)
3. **Task 3: Verify e2e passes under both daemon modes** (checkpoint: human-verify)
   - `7820d15` (chore) -- Pin nx repo to 22.5.4 tag and add workspace data gitignore
   - `183019e` (fix) -- Stop daemon after writeNxJson to prevent stale graph cache

## Files Created/Modified
- `packages/op-nx-polyrepo-e2e/docker/Dockerfile` - Removed NX_DAEMON=false from workspace stage ENV, updated comments
- `packages/op-nx-polyrepo-e2e/src/setup/container.ts` - Added NX_DAEMON env forwarding via withEnvironment, daemon stop after writeNxJson
- `packages/op-nx-polyrepo-e2e/src/cross-repo-deps.spec.ts` - New --skip-nx-cache graph verification test
- `.gitignore` - Added .polyrepo-ws-data/ to gitignore
- `nx.json` - Pinned synced nx repo ref to 22.5.4 tag
- `.planning/research/nx-sqlite-windows-locking.md` - Research on SQLite locking issues in Windows containers

## Decisions Made
- **NX_DAEMON removed from Dockerfile workspace ENV:** The runtime NX_DAEMON value is now controlled by the test environment via `container.ts` `withEnvironment()`. Build-time `RUN` commands keep inline `NX_DAEMON=false` prefixes for safety.
- **Daemon stop after writeNxJson:** When `NX_DAEMON=true`, the Nx daemon caches project graph data. After modifying `nx.json`, the daemon must be stopped to force re-computation on the next Nx command. Without this, tests see stale graph data.
- **E2e --exclude-task-dependencies required:** Cross-repo edges cause `^build` to cascade into synced repo builds, which fail due to Windows-specific issues (SQLite locking, Gradle OOM). This is a known limitation documented for a future phase.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Daemon stale graph cache after writeNxJson**
- **Found during:** Task 3 (checkpoint verification with NX_DAEMON=true)
- **Issue:** With daemon enabled, `writeNxJson` modifies `nx.json` but the daemon continues serving stale cached graph data. Tests see old graph without the updated plugin config.
- **Fix:** Added `npx nx daemon --stop` exec call after writing `nx.json` in `writeNxJson` helper
- **Files modified:** `packages/op-nx-polyrepo-e2e/src/setup/container.ts`
- **Verification:** All 8 e2e tests pass under NX_DAEMON=true, NX_DAEMON=false, and NX_DAEMON unset
- **Committed in:** `183019e`

---

**Total deviations:** 1 auto-fixed (1 bug fix for daemon cache staleness)
**Impact on plan:** Essential fix for daemon mode correctness. Without it, tests fail under NX_DAEMON=true because the daemon serves stale graph data after config changes. No scope creep.

## Issues Encountered
- Pre-existing lint errors in e2e project (5 errors: unsafe `any` assignments, conditional in test, type assertion) are not caused by plan changes. Verified by running lint on unmodified code -- same 5 errors present.
- E2e tests require `--exclude-task-dependencies` flag because cross-repo edges cascade `^build` into synced repos, which fail on Windows (SQLite locking, Gradle OOM, native build artifacts). Documented as known limitation for future phase.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Phase 11 is complete: per-repo cache (Plan 01), sync pre-caching (Plan 02), and e2e daemon verification (Plan 03) all delivered
- Plugin works under all three daemon modes: NX_DAEMON=true, NX_DAEMON=false, and unset
- CI matrix can test both daemon modes by setting `NX_DAEMON` env var before running e2e
- v1.1 milestone (Cross-repo Dependencies) is feature-complete pending final audit

## Self-Check: PASSED

All 6 files verified on disk. All 4 commits verified in git log.

---
*Phase: 11-full-nx-daemon-support*
*Completed: 2026-03-21*
