---
phase: 05-avoid-type-casting-and-prefer-satisfies
plan: 02
subsystem: api
tags: [zod, runtime-validation, type-safety, json-parse]

# Dependency graph
requires:
  - phase: 05-01
    provides: strict ESLint and TSConfig settings enabling type-safe enforcement
provides:
  - Zod-validated JSON.parse at all 3 system boundaries
  - ExternalGraphJson type derived from Zod schema (single source of truth)
  - nxJsonPluginSubsetSchema for nx.json validation
  - packageJsonSchema for package.json packageManager field validation
affects: [05-03, 05-04]

# Tech tracking
tech-stack:
  added: []
  patterns:
    [zod-safeParse-at-boundaries, z-infer-for-types, loose-schema-passthrough]

key-files:
  created: []
  modified:
    - packages/op-nx-polyrepo/src/lib/graph/types.ts
    - packages/op-nx-polyrepo/src/lib/config/resolve.ts
    - packages/op-nx-polyrepo/src/lib/graph/extract.ts
    - packages/op-nx-polyrepo/src/lib/executors/sync/executor.ts

key-decisions:
  - 'Replaced ExternalGraphJson interfaces with Zod schemas, deriving types via z.infer for single source of truth'
  - 'Used z.unknown() for targets values since TargetConfiguration is too complex to validate at runtime'
  - 'Used .loose() (passthrough) on outer objects to allow unvalidated extra fields'

patterns-established:
  - 'Zod safeParse at system boundaries: every JSON.parse wrapped in schema.safeParse with descriptive error on failure'
  - 'z.infer single source of truth: define Zod schema first, derive TypeScript type from it'

requirements-completed: [SAFE-ZOD]

# Metrics
duration: 3min
completed: 2026-03-12
---

# Phase 05 Plan 02: Zod Validation at System Boundaries Summary

**Zod safeParse validation at all 3 JSON.parse sites with schema-derived types and descriptive error messages**

## Performance

- **Duration:** 3 min
- **Started:** 2026-03-12T22:28:45Z
- **Completed:** 2026-03-12T22:32:31Z
- **Tasks:** 1
- **Files modified:** 4

## Accomplishments

- All 3 JSON.parse system boundaries now validated via Zod safeParse
- ExternalGraphJson type derived from Zod schema (z.infer) as single source of truth
- Descriptive error messages include file paths and repo context for debugging
- All 280 existing tests pass with new Zod-validated types

## Task Commits

Each task was committed atomically:

1. **Task 1: Add Zod schemas at all 3 JSON.parse system boundaries** - `9ba20d3` (feat)

## Files Created/Modified

- `packages/op-nx-polyrepo/src/lib/graph/types.ts` - Replaced interfaces with Zod schemas, ExternalGraphJson now derived via z.infer
- `packages/op-nx-polyrepo/src/lib/config/resolve.ts` - Added nxJsonPluginSubsetSchema with safeParse for nx.json plugin discovery
- `packages/op-nx-polyrepo/src/lib/graph/extract.ts` - Added externalGraphJsonSchema.safeParse for graph JSON validation
- `packages/op-nx-polyrepo/src/lib/executors/sync/executor.ts` - Added packageJsonSchema with safeParse for package.json packageManager field

## Decisions Made

- Replaced ExternalGraphJson interfaces with Zod schemas, deriving types via z.infer for single source of truth -- avoids interface/schema drift
- Used z.unknown() for target values since TargetConfiguration is a complex Nx type not suitable for runtime validation
- Used .loose() (Zod passthrough) on outer objects to allow extra fields we don't need to validate (nx.json has many fields, package.json has many fields)
- executor.ts getCorepackPm returns undefined on safeParse failure (graceful fallback) rather than throwing

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- Working tree contained mixed changes from parallel agents (05-02, 05-03, 05-04). Required careful separation: staged only 05-02 files, preserved 05-03/05-04 changes as unstaged for their respective agents.
- Transform.spec.ts test failures were caused by 05-03 agent's transform.ts refactoring (not 05-02 changes). Confirmed by restoring committed transform.ts -- all 280 tests pass.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Zod schemas in place for Plan 03 (strict lint/typecheck fixes) to build upon
- transform.ts needs Plan 03's refactoring to handle z.unknown() target values (uses Object.keys instead of Object.entries)

---

_Phase: 05-avoid-type-casting-and-prefer-satisfies_
_Completed: 2026-03-12_
