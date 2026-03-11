---
phase: 02-unified-project-graph
plan: 02
subsystem: graph
tags: [nx-plugin, typescript, graph-extraction, caching, namespacing, vitest]

# Dependency graph
requires:
  - phase: 02-unified-project-graph
    plan: 01
    provides: "ExternalGraphJson, TransformedNode, PolyrepoGraphReport types, getHeadSha, getDirtyFiles, normalizeRepos"
provides:
  - "extractGraphFromRepo: shells out to nx graph --print in child repos"
  - "populateGraphReport: two-layer cache (in-memory + disk) with hash invalidation"
  - "getCurrentGraphReport: module-level state accessor for createDependencies"
  - "transformGraphForRepo: namespace prefixing, target rewriting, tag injection"
affects: [02-03-PLAN]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Two-layer cache pattern: in-memory hash check + disk JSON for cold start restoration"
    - "Outer hash = hashArray(pluginOptionsHash + per-repo alias + HEAD SHA + dirty files)"
    - "@nx/gradle-style module-level variable shared between createNodesV2 and createDependencies"
    - "Proxy target pattern: rewrite all targets to @op-nx/polyrepo:run executor with original project metadata"
    - "Namespace pattern: repoAlias/ prefix on all project names, roots, and dependency edges"

key-files:
  created:
    - "packages/op-nx-polyrepo/src/lib/graph/extract.ts"
    - "packages/op-nx-polyrepo/src/lib/graph/extract.spec.ts"
    - "packages/op-nx-polyrepo/src/lib/graph/cache.ts"
    - "packages/op-nx-polyrepo/src/lib/graph/cache.spec.ts"
    - "packages/op-nx-polyrepo/src/lib/graph/transform.ts"
    - "packages/op-nx-polyrepo/src/lib/graph/transform.spec.ts"
  modified: []

key-decisions:
  - "Defined LARGE_BUFFER locally (1GB) instead of importing from nx/src/executors/run-commands -- avoids import path fragility across Nx versions"
  - "Used hashArray from @nx/devkit (not nx/src/devkit-internals) -- the devkit-internals export was undefined for hashArray"
  - "Used readJsonFile/writeJsonFile from @nx/devkit for disk cache -- PluginCache not importable from nx/src/utils/plugin-cache-utils"
  - "Path normalization via simple backslash-to-forward-slash regex instead of importing normalizePath from @nx/devkit"

patterns-established:
  - "Graph extraction: execFile with NX_DAEMON=false and windowsHide=true to prevent child daemon processes"
  - "Cache restoration: try/catch readJsonFile for cold start, fall through to extraction on error"
  - "Transform pipeline: for each external project, rewrite name/root/sourceRoot/targets/tags/deps"

requirements-completed: [GRPH-03, GRPH-04]

# Metrics
duration: 7min
completed: 2026-03-11
---

# Phase 2 Plan 2: Graph Pipeline Summary

**Graph extraction via nx graph --print with two-layer cache (in-memory + disk) and transformation pipeline for namespace prefixing, proxy target rewriting, and auto-tag injection**

## Performance

- **Duration:** 7 min
- **Started:** 2026-03-11T06:30:05Z
- **Completed:** 2026-03-11T06:37:13Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments
- Graph extraction shells out to `nx graph --print` per child repo with 1GB maxBuffer and NX_DAEMON=false
- Two-layer cache: in-memory hash comparison (instant) + disk JSON in workspaceDataDirectory (cold start)
- Outer hash computation from plugin options + per-repo HEAD SHA + dirty files -- skips unsynced repos
- Transformation pipeline: namespace all project names with `repoAlias/`, rewrite roots to `.repos/<alias>/<root>`
- All targets rewritten to `@op-nx/polyrepo:run` proxy executor preserving inputs, outputs, cache, dependsOn
- Auto-tags `polyrepo:external` and `polyrepo:<alias>` injected on every external project
- Intra-repo dependency edges prefixed with repo alias for Nx graph consistency

## Task Commits

Each task was committed atomically (TDD: test then feat):

1. **Task 1: Graph extraction and two-layer cache**
   - `16cd05f` (test) - Failing tests for extractGraphFromRepo, populateGraphReport, getCurrentGraphReport
   - `71639b4` (feat) - Implementation: extract.ts, cache.ts, transform.ts stub

2. **Task 2: Graph transformation -- namespacing, tags, target rewriting**
   - `b8fcd2f` (test) - Failing tests for transformGraphForRepo (27 tests)
   - `3b437ac` (feat) - Full implementation replacing stub

## Files Created/Modified
- `packages/op-nx-polyrepo/src/lib/graph/extract.ts` - Shells out to nx graph --print with LARGE_BUFFER and NX_DAEMON=false
- `packages/op-nx-polyrepo/src/lib/graph/extract.spec.ts` - 8 tests: args, cwd, maxBuffer, env, windowsHide, JSON parsing, error, large output
- `packages/op-nx-polyrepo/src/lib/graph/cache.ts` - Two-layer cache with module-level state, computeOuterHash, disk persistence
- `packages/op-nx-polyrepo/src/lib/graph/cache.spec.ts` - 12 tests: caching, hash invalidation, parallel extraction, disk persistence
- `packages/op-nx-polyrepo/src/lib/graph/transform.ts` - Namespace prefixing, target rewriting, tag injection, dependency transformation
- `packages/op-nx-polyrepo/src/lib/graph/transform.spec.ts` - 29 tests: namespacing, paths, tags, targets, dependsOn, dependencies, edge cases

## Decisions Made
- Defined LARGE_BUFFER (1GB) locally instead of importing from nx/src/executors/run-commands -- the import works but coupling to an internal path is fragile across Nx version upgrades
- Used `hashArray` from `@nx/devkit` -- verified at runtime that `nx/src/devkit-internals` does not export hashArray (returns undefined), but `@nx/devkit` does
- Used `readJsonFile`/`writeJsonFile` from `@nx/devkit` for disk cache since `PluginCache` is not importable from `nx/src/utils/plugin-cache-utils` (module not found)
- Used simple `p.replace(/\\/g, '/')` for path normalization rather than importing `normalizePath` from `@nx/devkit` -- fewer dependencies for a one-liner utility

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Large JSON test fixture too small**
- **Found during:** Task 1 GREEN phase
- **Issue:** Test fixture with 5000 projects produced ~667KB JSON, not the expected 1.4MB+
- **Fix:** Increased fixture to 12000 projects to exceed 1.4MB threshold
- **Files modified:** `packages/op-nx-polyrepo/src/lib/graph/extract.spec.ts`
- **Verification:** Test passes with 12000 projects, JSON length > 1.4MB confirmed
- **Committed in:** `71639b4` (part of task 1 feat commit)

---

**Total deviations:** 1 auto-fixed (1 bug in test fixture)
**Impact on plan:** Minor test fixture adjustment. No scope creep.

## Issues Encountered
None beyond the auto-fixed deviation above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Complete graph pipeline (extract -> cache -> transform) ready for Plan 03 (createNodesV2/createDependencies wiring)
- `populateGraphReport` designed for dual-call pattern: createNodesV2 populates, createDependencies reads via getCurrentGraphReport
- Module-level state follows @nx/gradle pattern for process-lifetime caching
- All 159 tests pass, build succeeds

## Self-Check: PASSED

All 7 files verified present. All 4 commits verified in git log.

---
*Phase: 02-unified-project-graph*
*Completed: 2026-03-11*
