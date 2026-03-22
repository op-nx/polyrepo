---
phase: 02-unified-project-graph
plan: 03
subsystem: plugin-integration
tags:
  [
    nx-plugin,
    typescript,
    executor,
    createNodesV2,
    createDependencies,
    proxy-targets,
  ]

# Dependency graph
requires:
  - phase: 02-unified-project-graph
    plan: 01
    provides: 'Graph types, git utilities, config schema'
  - phase: 02-unified-project-graph
    plan: 02
    provides: 'extractGraphFromRepo, populateGraphReport, getCurrentGraphReport, transformGraphForRepo'
provides:
  - 'Run executor: proxy target execution to child repos via runCommandsImpl'
  - 'createNodesV2 extension: registers external projects from graph report'
  - 'createDependencies: exports intra-repo edges as implicit dependencies'
  - 'Batched unsynced repo warning'
affects: [phase-03]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - 'Proxy executor pattern: @op-nx/polyrepo:run delegates to child repo nx CLI via runCommandsImpl'
    - 'createNodesV2 projects keyed by host root path (.repos/<alias>/<root>) with name override'
    - 'createDependencies guard: only emit edges where both source and target exist in context.projects'
    - 'Proxy targets: inputs:[], cache:false, no dependsOn -- child repo handles all internally'
    - 'Cache stored in .repos/ (not .nx/) to survive nx reset'

key-files:
  created:
    - 'packages/op-nx-polyrepo/src/lib/executors/run/executor.ts'
    - 'packages/op-nx-polyrepo/src/lib/executors/run/executor.spec.ts'
    - 'packages/op-nx-polyrepo/src/lib/executors/run/schema.json'
  modified:
    - 'packages/op-nx-polyrepo/executors.json'
    - 'packages/op-nx-polyrepo/src/index.ts'
    - 'packages/op-nx-polyrepo/src/index.spec.ts'
    - 'packages/op-nx-polyrepo/src/lib/config/validate.ts'
    - 'packages/op-nx-polyrepo/src/lib/config/validate.spec.ts'
    - 'packages/op-nx-polyrepo/src/lib/graph/transform.ts'
    - 'packages/op-nx-polyrepo/src/lib/graph/transform.spec.ts'
    - 'packages/op-nx-polyrepo/src/lib/graph/cache.ts'
    - 'packages/op-nx-polyrepo/src/lib/graph/cache.spec.ts'

key-decisions:
  - 'Strip dependsOn from proxy targets -- host Nx builds cascading task graph across all external projects, triggering native Rust hasher on projects without projectFileMap entries'
  - 'Set inputs:[] on proxy targets -- undefined inputs causes native hasher to fall back to default inputs requiring file resolution; empty array means nothing to hash'
  - 'Move graph cache from .nx/workspace-data/ to .repos/ -- nx reset wipes .nx/ which forces re-extraction exceeding daemon plugin worker timeout'
  - 'Use exec() not execFile() for all child processes -- .bin/* are .cmd shims on Windows that execFile cannot execute'
  - 'Corepack support via packageManager field detection -- corepack <pm> install instead of direct PM invocation'
  - "Proxy targets omit inputs/outputs -- external repos define named inputs (e.g. 'native') in their own nx.json that the host can't resolve"

patterns-established:
  - 'Proxy execution: construct command string with quoted nxBin path, delegate via runCommandsImpl'
  - "Degraded mode: extraction failure logs warning but doesn't crash Nx -- root project targets still available"
  - 'windowsHide: true on all child_process calls to prevent console window flashes'

requirements-completed: [GRPH-01, GRPH-02, GRPH-03, GRPH-04]

# Metrics
duration: ~45min (including post-plan Windows fixes and verification)
completed: 2026-03-11
---

# Phase 2 Plan 3: Plugin Integration Summary

**Run executor, createNodesV2 extension for external project registration, createDependencies for intra-repo edges, and verification fixes for Windows/daemon compatibility**

## Performance

- **Duration:** ~45 min (across two sessions: execution + verification fixes)
- **Tasks:** 3 (2 auto + 1 human-verify checkpoint)
- **Files created:** 3
- **Files modified:** 10

## Accomplishments

- Run executor proxies target execution to child repo Nx via `runCommandsImpl` with transparent output streaming
- `createNodesV2` extended to register all external projects from graph report alongside root workspace targets
- `createDependencies` exports intra-repo dependency edges as `DependencyType.implicit`, guarded by `context.projects` existence check
- Batched unsynced repo warning (single message listing all unsynced repos)
- Proxy targets stripped of `dependsOn` and set `inputs: []` to prevent native Rust hasher crashes
- Graph cache moved from `.nx/workspace-data/` to `.repos/` to survive `nx reset`

## Task Commits

### Wave 3 -- Plan 02-03 Tasks 1-2 (4 commits)

1. **Task 1: Run executor with runCommandsImpl**
   - `43c5908` (test) - Failing tests for run executor
   - `8e26b5b` (feat) - Run executor implementation + schema.json + executors.json update

2. **Task 2: createNodesV2 extension + createDependencies**
   - `456c31e` (test) - Failing tests for createNodesV2 extension and createDependencies
   - `d52a8c5` (feat) - Extended createNodesV2 + createDependencies + batched warnings

### Post-plan Windows fixes (7 commits)

- `33d7b2b` - windowsHide: true on all git child processes
- `f1e5fb6` - Corepack support for package manager detection
- `52aefee` - Replace execFile+shell with exec to fix DEP0190 warning
- `debfd08` - Use exec for graph extraction (.bin/nx is .cmd shim on Windows)
- `fb87bd3` - Add .repos/ to .gitignore and eslint ignores
- `a586063` - Replace "assembled" with "synced" across all planning artifacts
- `fda7cc4` - Omit inputs/outputs from proxy targets, set cache:false

### Verification fixes (2 commits)

- `4d6d0d6` - Strip dependsOn from proxy targets, set inputs to empty array
- `e7141d2` - Move graph cache from .nx/ to .repos/ to survive nx reset

## Verified Behavior (PowerShell on Windows 11 arm64)

1. `npm exec nx -- show projects` -- 152 projects including all `nx/*` externals
2. `npm exec nx -- show projects --type=lib` -- filter works correctly
3. `npm exec nx graph` -- browser visualization with dependency edges
4. `npm exec nx -- show project nx/devkit --json` -- proxy targets with correct executor, tags, inputs:[], cache:false
5. `npm exec nx -- run nx/devkit:build` -- proxied to child repo, built devkit + 7 deps
6. `npm exec nx -- run-many --targets=test,lint --projects=@op-nx/polyrepo` -- 178 tests pass, 0 lint errors
7. Cache survives `nx reset` -- 152 projects on subsequent runs with daemon enabled

## Known Limitations

- **Pop-over cmd windows on Windows**: Nx's `runCommandsImpl` spawns shell processes without `windowsHide`. Outside our control without forking the implementation.
- **Cold start with daemon**: First-ever extraction after `nx polyrepo-sync` needs `NX_DAEMON=false` to avoid daemon timeout. Subsequent runs (even after `nx reset`) use persisted cache.
- **Scaling**: ~4s for 150 projects from cached graph. May need optimization (binary cache format, lazy per-repo loading) for 3x500+ project workspaces.
- **targetDefaults leak**: Host workspace `targetDefaults` (e.g., `test.dependsOn: ["^build"]`) merge into proxy targets. Cosmetic -- child repo handles its own task ordering.

## Deviations from Plan

### Auto-fixed Issues

**1. Native task hasher crash ("project X not found")**

- **Found during:** Task 3 human verification
- **Issue:** Rust hasher fails resolving dynamically registered external projects in projectFileMap
- **Root cause:** `dependsOn` caused cascading task graph; undefined `inputs` triggered default file resolution
- **Fix:** Strip `dependsOn`, set `inputs: []` on all proxy targets
- **Commits:** `4d6d0d6`

**2. External projects missing after nx reset**

- **Found during:** Task 3 human verification
- **Issue:** `nx reset` wipes `.nx/workspace-data/` including disk cache; re-extraction exceeds daemon timeout
- **Fix:** Move cache to `.repos/.polyrepo-graph-cache.json`
- **Commits:** `e7141d2`

---

**Total deviations:** 2 auto-fixed during verification (both Windows/daemon integration issues not catchable by unit tests)
**Impact on plan:** No scope change. Both fixes are refinements to proxy target configuration and cache location.

## Issues Encountered

All issues were Windows-specific integration problems discovered during real-device verification (not catchable by unit tests which mock child_process). See post-plan fix commits above.

## User Setup Required

None beyond Phase 1 setup (repos configured in nx.json, synced via `nx polyrepo-sync`).

## Next Phase Readiness

- All GRPH requirements (01-04) satisfied
- Phase 2 complete: external repo projects visible in unified Nx graph
- Phase 3 (Multi-Repo Git DX) depends only on Phase 1 -- can proceed independently
- 178 unit tests pass, build succeeds, lint clean (0 errors)

## Self-Check: PASSED

All 13 files verified present/modified. All 13 commits verified in git log.

---

_Phase: 02-unified-project-graph_
_Completed: 2026-03-11_
