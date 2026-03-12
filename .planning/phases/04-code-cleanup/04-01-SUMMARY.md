---
phase: 04-code-cleanup
plan: 01
subsystem: config
tags: [refactoring, deduplication, nx-plugin]

# Dependency graph
requires:
  - phase: 02-unified-project-graph
    provides: graph cache and executor infrastructure
provides:
  - Exported CACHE_FILENAME constant from graph/cache.ts
  - Shared resolvePluginConfig utility in config/resolve.ts
  - Unit tests for resolvePluginConfig
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Shared config resolution via resolvePluginConfig instead of inline nx.json parsing"

key-files:
  created:
    - packages/op-nx-polyrepo/src/lib/config/resolve.ts
    - packages/op-nx-polyrepo/src/lib/config/resolve.spec.ts
  modified:
    - packages/op-nx-polyrepo/src/lib/graph/cache.ts
    - packages/op-nx-polyrepo/src/lib/executors/status/executor.ts
    - packages/op-nx-polyrepo/src/lib/executors/sync/executor.ts

key-decisions:
  - "resolvePluginConfig returns { config, entries } tuple for flexibility -- some callers need config, others only entries"

patterns-established:
  - "Config resolution: import resolvePluginConfig from config/resolve instead of inline nx.json parsing"
  - "Cache filename: import CACHE_FILENAME from graph/cache instead of hardcoding string"

requirements-completed: []

# Metrics
duration: 2min
completed: 2026-03-12
---

# Phase 4 Plan 1: Deduplicate Constants and Config Reading Summary

**Exported CACHE_FILENAME constant and shared resolvePluginConfig utility, eliminating duplicated nx.json parsing from both executors**

## Performance

- **Duration:** 2 min
- **Started:** 2026-03-12T17:02:22Z
- **Completed:** 2026-03-12T17:04:24Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Exported CACHE_FILENAME from graph/cache.ts, replacing hardcoded string in status executor
- Created resolvePluginConfig shared utility with 3 unit tests (valid config, missing plugins, missing plugin entry)
- Refactored both sync and status executors to use shared utilities, removing 30 lines of duplicated boilerplate

## Task Commits

Each task was committed atomically:

1. **Task 1: Export CACHE_FILENAME and create resolvePluginConfig utility** - `14bdcea` (refactor)
2. **Task 2: Refactor both executors to use shared utilities** - `b2b349b` (refactor)

## Files Created/Modified
- `packages/op-nx-polyrepo/src/lib/graph/cache.ts` - Exported CACHE_FILENAME constant
- `packages/op-nx-polyrepo/src/lib/config/resolve.ts` - New shared resolvePluginConfig function
- `packages/op-nx-polyrepo/src/lib/config/resolve.spec.ts` - Unit tests for resolvePluginConfig
- `packages/op-nx-polyrepo/src/lib/executors/status/executor.ts` - Replaced hardcoded cache filename and config boilerplate
- `packages/op-nx-polyrepo/src/lib/executors/sync/executor.ts` - Replaced config boilerplate

## Decisions Made
- resolvePluginConfig returns `{ config, entries }` tuple so callers can destructure only what they need

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Tech debt items from v1.0 audit resolved
- All 280 tests passing (277 existing + 3 new)
- Lint passes with no new errors

## Self-Check: PASSED

- [x] resolve.ts created
- [x] resolve.spec.ts created
- [x] 04-01-SUMMARY.md created
- [x] Commit 14bdcea found
- [x] Commit b2b349b found

---
*Phase: 04-code-cleanup*
*Completed: 2026-03-12*
