---
phase: 10-integration-and-end-to-end-validation
plan: 01
subsystem: graph
tags: [nx-plugin, createDependencies, cross-repo, dependency-detection, DETECT-06, DETECT-07]

# Dependency graph
requires:
  - phase: 09-cross-repo-dependency-detection
    provides: detectCrossRepoDependencies pure function with full unit test coverage
provides:
  - detectCrossRepoDependencies wired into createDependencies plugin hook
  - Cross-repo edges flow through Nx plugin pipeline to nx graph
  - OVRD-03 validation errors propagate to Nx (not silently caught)
  - DETECT-07 deferral rationale documented in codebase
affects: [e2e-validation, future-polyrepo-affected-executor]

# Tech tracking
tech-stack:
  added: []
  patterns: [separated-error-paths-extraction-vs-detection]

key-files:
  created: []
  modified:
    - packages/op-nx-polyrepo/src/index.ts
    - packages/op-nx-polyrepo/src/index.spec.ts

key-decisions:
  - "Extraction try/catch restructured so config and report survive to detection call while OVRD-03 errors propagate"
  - "DETECT-07 deferral documented inline in index.ts near the detection call with root cause and future solution"

patterns-established:
  - "Separated error paths: extraction failures degrade gracefully, detection validation errors propagate loudly"

requirements-completed: [DETECT-06, DETECT-07]

# Metrics
duration: 7min
completed: 2026-03-18
---

# Phase 10 Plan 01: Integration Wiring Summary

**Cross-repo dependency detection wired into createDependencies with separated error paths for extraction vs detection, plus DETECT-07 deferral documented**

## Performance

- **Duration:** 7 min
- **Started:** 2026-03-18T18:27:49Z
- **Completed:** 2026-03-18T18:35:40Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments
- detectCrossRepoDependencies called in createDependencies after successful extraction, merging cross-repo edges into the returned dependency array
- OVRD-03 validation errors propagate to Nx (not caught by extraction try/catch) so users see clear error messages
- Extraction failures still degrade gracefully with empty array without calling detection
- 4 new integration tests covering happy path, error propagation, extraction failure, and empty detection
- All 329 existing tests pass with no regressions
- DETECT-07 deferral rationale documented as code comment referencing the .gitignore root cause and research file

## Task Commits

Each task was committed atomically:

1. **Task 1: Wire detectCrossRepoDependencies into createDependencies** (TDD)
   - `ec0c530` (test: add failing tests for detectCrossRepoDependencies wiring)
   - `31cf4bc` (feat: wire detectCrossRepoDependencies into createDependencies)
   - `c7707f2` (fix: use DependencyType enum in cross-repo test assertions)
2. **Task 2: Document DETECT-07 deferral in codebase** - `b463e85` (docs)

**Plan metadata:** pending (docs: complete plan)

## Files Created/Modified
- `packages/op-nx-polyrepo/src/index.ts` - Added detectCrossRepoDependencies import, restructured createDependencies with separated error paths, added DETECT-07 documentation comment
- `packages/op-nx-polyrepo/src/index.spec.ts` - Added vi.mock for detect module, 4 new integration tests for cross-repo wiring, imported DependencyType for type-safe assertions

## Decisions Made
- Restructured createDependencies try/catch so config is declared with `let` outside the block, allowing detection to run after extraction succeeds while extraction errors still return empty array
- Used DependencyType.static (enum member) instead of string literal in test mock return values for type safety

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed TypeScript type error in test mock return value**
- **Found during:** Task 1 (GREEN phase verification)
- **Issue:** `type: 'static' as const` not assignable to `DependencyType` enum type in `RawProjectGraphDependency`
- **Fix:** Imported `DependencyType` from `@nx/devkit` and used `DependencyType.static` instead of string literal
- **Files modified:** packages/op-nx-polyrepo/src/index.spec.ts
- **Verification:** TypeScript typecheck passes for index.spec.ts, all tests still green
- **Committed in:** c7707f2

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Minor type safety correction. No scope creep.

## Issues Encountered
- Pre-existing lint errors in detect.spec.ts, schema.spec.ts, transform.spec.ts (55 errors total) -- all out of scope, not in files modified by this plan
- Pre-existing typecheck error in detect.spec.ts:513 ('edge' possibly undefined) -- out of scope
- nx sync warning about TypeScript project references -- pre-existing, unrelated to changes

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness
- Cross-repo detection is now fully wired into the Nx plugin pipeline
- Ready for e2e validation (Plan 02) to verify cross-repo edges appear in nx graph output inside containers
- DETECT-07 documented and deferred -- no blocker for Phase 10 completion

## Self-Check: PASSED

- [x] packages/op-nx-polyrepo/src/index.ts exists
- [x] packages/op-nx-polyrepo/src/index.spec.ts exists
- [x] .planning/phases/10-integration-and-end-to-end-validation/10-01-SUMMARY.md exists
- [x] Commit ec0c530 exists (test RED)
- [x] Commit 31cf4bc exists (feat GREEN)
- [x] Commit c7707f2 exists (fix type)
- [x] Commit b463e85 exists (docs DETECT-07)

---
*Phase: 10-integration-and-end-to-end-validation*
*Completed: 2026-03-18*
