---
phase: 09-cross-repo-dependency-detection
plan: '02'
subsystem: graph
tags:
  [
    nx,
    dependency-detection,
    tsconfig,
    path-aliases,
    overrides,
    minimatch,
    cross-repo,
    graph-edges,
  ]

# Dependency graph
requires:
  - phase: 09-cross-repo-dependency-detection
    plan: '01'
    provides: detectCrossRepoDependencies with lookup map and package.json dep-list scan
provides:
  - Complete detectCrossRepoDependencies — tsconfig path alias expansion (DETECT-04), override emission (OVRD-01), negation suppression (OVRD-02), unknown-project validation (OVRD-03)
  - Unit tests for all four remaining Phase 9 requirements added to detect.spec.ts
affects: [10-integration-and-e2e, createDependencies plugin hook]

# Tech tracking
tech-stack:
  added:
    - minimatch ^10.0.0 — glob pattern matching for implicitDependencies key/target patterns
  patterns:
    - 'tsConfigPathsSchema: z.object({ compilerOptions: z.object({ paths: ... }).loose() }).loose() — same loose() pattern as resolve.ts/types.ts'
    - 'readTsconfigPaths: silent-skip on read/parse/validation failure; normalize path to forward slashes before readFileSync'
    - 'expandTsconfigPathsIntoMap: strips filename from value, walks up path segments to find matching project root, Map.has() guard preserves precedence'
    - 'Override processing order: validate first (OVRD-03) -> accumulate auto-detected -> build negation set -> filter -> emit overrides (OVRD-01)'
    - "Negation suppression via Set<'source::target'> keys — O(1) lookup, applied as post-filter after accumulation"
    - 'allProjectNames built from both external nodes and host projects for uniform override validation'

key-files:
  created: []
  modified:
    - packages/op-nx-polyrepo/src/lib/graph/detect.ts
    - packages/op-nx-polyrepo/src/lib/graph/detect.spec.ts
    - packages/op-nx-polyrepo/package.json

key-decisions:
  - "Normalize tsconfig path to forward slashes before readFileSync — Windows join() returns backslashes but mock predicates use endsWith('/path')"
  - 'Override validation uses allProjectNames (external + host) — enables validating patterns that target host projects'
  - 'Negation suppression applied as post-filter after full auto-detection accumulation — not inline during scan (avoids Pitfall 4)'
  - 'Override deduplication uses separate overrideEmitted set seeded from filteredEdges — prevents double-emitting edges already present from auto-detection'
  - 'minimatch added to package.json dependencies (not devDependencies) — used at runtime in createDependencies plugin hook'

patterns-established:
  - 'expandTsconfigPathsIntoMap(paths, nodeRoots, map): reusable for both external repos and host workspace tsconfig expansion'
  - 'readTsconfigPathsWithFallback(dirPath): try tsconfig.base.json first, fall back to tsconfig.json — same pattern as Nx itself'

requirements-completed: [DETECT-04, OVRD-01, OVRD-02, OVRD-03]

# Metrics
duration: 6min
completed: 2026-03-17
---

# Phase 9 Plan 02: Cross-Repo Dependency Detection (tsconfig aliases + overrides) Summary

**`detectCrossRepoDependencies` completed with tsconfig path alias expansion, glob-matched implicit dependency overrides, negation suppression, and unknown-project validation**

## Performance

- **Duration:** ~6 min
- **Started:** 2026-03-17T22:05:44Z
- **Completed:** 2026-03-17T22:11:13Z
- **Tasks:** 2 (both TDD: RED + GREEN commits each)
- **Files modified:** 3

## Accomplishments

- Provider-side tsconfig.base.json / tsconfig.json path aliases expand the lookup map for repos that don't set packageName on nodes (DETECT-04)
- `implicitDependencies` config entries emit `DependencyType.implicit` edges for glob-matched project pairs (OVRD-01)
- `!target` negation entries suppress auto-detected edges as a post-filter — source of detection does not matter (OVRD-02)
- Unknown patterns in implicitDependencies (key or target, including negation targets) throw once with all unknown names in one error message (OVRD-03)
- 20 new detect.spec.ts tests added; 325 total suite tests pass

## Task Commits

Each task was committed atomically (TDD):

1. **Task 1 RED: Failing tests for tsconfig path alias lookup map expansion** - `ca7871d` (test)
2. **Task 1 GREEN: Expand lookup map with provider-side tsconfig path aliases** - `d607423` (feat)
3. **Task 2 RED: Failing tests for override emission, negation, and unknown-project validation** - `97324b4` (test)
4. **Task 2 GREEN: Implement override processing and negation suppression** - `af6105d` (feat)

_No REFACTOR commits needed — both implementations were clean on first pass._

## Files Created/Modified

- `packages/op-nx-polyrepo/src/lib/graph/detect.ts` — Extended with tsConfigPathsSchema, readTsconfigPaths/WithFallback, expandTsconfigPathsIntoMap helpers, Step 1c/1d tsconfig expansion, Step 2b allProjectNames, Step 2c override validation, Step 4 negation set + filtering + override edge emission
- `packages/op-nx-polyrepo/src/lib/graph/detect.spec.ts` — 20 new tests: 8 for DETECT-04 (tsconfig paths), 3 for OVRD-01 (override emission), 4 for OVRD-02 (negation), 5 for OVRD-03 (unknown validation)
- `packages/op-nx-polyrepo/package.json` — Added minimatch ^10.0.0 to dependencies

## Decisions Made

- `readFileSync` path normalized to forward slashes before calling — Windows `path.join()` returns backslashes which breaks test mocks that use `endsWith('/repo-b/tsconfig.base.json')` pattern checks.
- Override validation checks both external repo nodes AND context.projects — needed to allow patterns targeting host projects in implicitDependencies.
- Negation is a post-filter on accumulated auto-detected edges. Building the negation set first and skipping during accumulation would be simpler but violates the documented algorithm and could incorrectly suppress edges added by other detection paths.
- Override deduplication initialized from filteredEdges (not the original emitted set) — ensures we correctly de-duplicate between filtered auto-detected edges and newly emitted override edges.
- minimatch goes in `dependencies` not `devDependencies` — the plugin uses it at runtime when Nx calls `createDependencies`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Normalize path to forward slashes before readFileSync**

- **Found during:** Task 1 GREEN (tsconfig path alias expansion)
- **Issue:** `path.join('/workspace', '.repos', 'repo-b', 'tsconfig.base.json')` returns `\workspace\.repos\repo-b\tsconfig.base.json` on Windows. Test mocks used `endsWith('repo-b/tsconfig.base.json')` and all 4 edge-detection tests were failing.
- **Fix:** Added `normalizePath(filePath)` call before `readFileSync` in `readTsconfigPaths`
- **Files modified:** packages/op-nx-polyrepo/src/lib/graph/detect.ts
- **Verification:** All 4 failing tests immediately passed
- **Committed in:** d607423 (Task 1 GREEN commit)

---

**Total deviations:** 1 auto-fixed (Rule 1 — bug)
**Impact on plan:** Essential Windows compatibility fix. Plan's description assumed Unix paths but test infrastructure uses forward-slash mock predicates. Fix is correct behavior in all environments.

## Issues Encountered

- The `pnpm nx test @op-nx/polyrepo` command fails with `externalDependency 'vitest' could not be found` (pre-existing issue from Plan 01). Tests verified via `pnpm exec vitest run packages/op-nx-polyrepo/src --reporter=verbose` (325/325 pass). Build target unaffected.

## Next Phase Readiness

- `detectCrossRepoDependencies` is complete — handles DETECT-01 through DETECT-04 and OVRD-01 through OVRD-03
- Function signature: `(report: PolyrepoGraphReport, config: PolyrepoConfig, context: CreateDependenciesContext) => RawProjectGraphDependency[]`
- Ready to be wired into the `createDependencies` plugin hook in Phase 10
- No `as` casts, no `any`, no `!` non-null assertions, no hooks in test file

## Self-Check: PASSED

- [FOUND] packages/op-nx-polyrepo/src/lib/graph/detect.ts
- [FOUND] packages/op-nx-polyrepo/src/lib/graph/detect.spec.ts
- [FOUND] .planning/phases/09-cross-repo-dependency-detection/09-02-SUMMARY.md
- [FOUND] af6105d feat(09-02): implement override processing and negation suppression
- [FOUND] d607423 feat(09-02): expand lookup map with provider-side tsconfig path aliases
- [FOUND] 97324b4 test(09-02): add failing tests for override emission, negation, and unknown-project validation
- [FOUND] ca7871d test(09-02): add failing tests for tsconfig path alias lookup map expansion
