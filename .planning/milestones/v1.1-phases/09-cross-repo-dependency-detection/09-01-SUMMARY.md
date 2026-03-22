---
phase: 09-cross-repo-dependency-detection
plan: '01'
subsystem: graph
tags: [nx, dependency-detection, package-json, cross-repo, graph-edges]

# Dependency graph
requires:
  - phase: 08-schema-extension-and-data-extraction
    provides: TransformedNode with packageName/dependencies/devDependencies/peerDependencies fields extracted from external repos
provides:
  - detectCrossRepoDependencies pure function — lookup map construction and package.json dep-list edge emission
  - Unit tests for DETECT-01 (dependencies), DETECT-02 (devDependencies), DETECT-03 (peerDependencies) behaviors
affects: [10-integration-and-e2e, createDependencies plugin hook]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - 'Lookup map (Map<string,string>) built in two passes: external nodes first (take precedence), host projects second'
    - "Repo membership sentinel '__host__' distinguishes host projects from namespaced external projects in cross-repo guard"
    - "Deduplication via Set<'source::target'> keys before appending to result array"
    - 'SIFERS test pattern: no beforeEach/afterEach, all setup inside local setup() functions per describe block'

key-files:
  created:
    - packages/op-nx-polyrepo/src/lib/graph/detect.ts
    - packages/op-nx-polyrepo/src/lib/graph/detect.spec.ts
  modified: []

key-decisions:
  - 'External TransformedNode.packageName wins over host project metadata.js.packageName on collision (external inserted first in map)'
  - 'All three dep fields (dependencies, devDependencies, peerDependencies) always emit DependencyType.static edges — dep type is inferred from presence in lookup map, not from dev/prod distinction'
  - 'Host projects read package.json from disk at detection time via readFileSync with silent try/catch (same approach as transform.ts)'
  - 'sourceFile is node.root + /package.json for external nodes (already .repos/<alias>/...), join(projectConfig.root, package.json) for host nodes'
  - "Cross-repo guard uses repo alias prefix from namespaced project name (before first slash) and '__host__' sentinel for host projects"

patterns-established:
  - 'extractRepoAlias(namespacedName): string | undefined — prefix before first slash in project name'
  - 'isRecord(value) guard pattern reused from transform.ts for safe unknown narrowing'

requirements-completed: [DETECT-01, DETECT-02, DETECT-03]

# Metrics
duration: 4min
completed: 2026-03-17
---

# Phase 9 Plan 01: Cross-Repo Dependency Detection (package.json) Summary

**`detectCrossRepoDependencies` pure function with two-pass lookup map and dep-list scan emitting static cross-repo edges for dependencies, devDependencies, and peerDependencies**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-03-17T21:58:49Z
- **Completed:** 2026-03-17T22:02:57Z
- **Tasks:** 1 (TDD: RED + GREEN commits)
- **Files modified:** 2

## Accomplishments

- `detectCrossRepoDependencies(report, config, context): RawProjectGraphDependency[]` implemented as pure function
- Two-pass lookup map: external TransformedNode packageNames inserted first (precedence), host projects from context.projects metadata second
- Cross-repo guard correctly blocks intra-repo edges and host-to-host edges
- Deduplication ensures same package appearing in multiple dep fields emits one edge
- 15 new detect.spec.ts tests; all 305 suite tests pass

## Task Commits

Each task was committed atomically (TDD):

1. **Task 1 RED: Failing tests for lookup map + dep-list scan** - `499dccc` (test)
2. **Task 1 GREEN: detectCrossRepoDependencies implementation** - `5587325` (feat)

_No REFACTOR commit needed — implementation was clean on first pass._

## Files Created/Modified

- `packages/op-nx-polyrepo/src/lib/graph/detect.ts` — Pure detection function: lookup map, repo membership map, dep-list scan, deduplication, cross-repo guard
- `packages/op-nx-polyrepo/src/lib/graph/detect.spec.ts` — 15 tests covering all three dep fields, lookup map construction, precedence, cross-repo guard, host-as-source, deduplication, no-mutation

## Decisions Made

- External nodes' packageName takes precedence over host project packageName on map key collision. This ensures external cross-repo edges resolve to the correct external project when there is a naming conflict.
- `DependencyType.static` used for all dep list edges regardless of field (dependencies vs devDependencies vs peerDependencies). The distinction between static/implicit is about declaration mechanism (package.json vs config file), not dev/prod classification. **Note:** Phase 10 Plan 03 later changed auto-detected edges to `DependencyType.implicit` because `static` edges require a `sourceFile` in the fileMap, which `.repos/` gitignoring prevents.
- `__host__` sentinel used instead of `undefined` as repo alias for host projects. This makes cross-repo guard logic uniform: any two projects with the same alias (including `__host__`) are intra-repo and suppressed.

## Deviations from Plan

None — plan executed exactly as written.

## Issues Encountered

- The `pnpm nx test @op-nx/polyrepo` command fails with `externalDependency 'vitest' could not be found` due to the package's `package.json` not listing `vitest` as a devDependency (it is a workspace root devDependency only). This is a pre-existing issue not introduced by this plan. Tests were verified by running `pnpm exec vitest run packages/op-nx-polyrepo/src --reporter=verbose` from the workspace root (305/305 pass). The build target (`pnpm nx build @op-nx/polyrepo`) is unaffected.

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- `detectCrossRepoDependencies` is ready to be called from the `createDependencies` plugin hook (Phase 10 integration)
- Function accepts `PolyrepoConfig` but does not yet use it (reserved for Plan 02 implicit dependency overrides)
- Host project dep reading requires `context.workspaceRoot` to be accurate (standard Nx contract)
