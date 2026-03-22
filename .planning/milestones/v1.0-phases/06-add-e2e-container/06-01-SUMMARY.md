---
phase: 06-add-e2e-container
plan: 01
subsystem: testing
tags: [testcontainers, docker, verdaccio, vitest, e2e]

# Dependency graph
requires:
  - phase: 01-plugin-foundation-repo-assembly
    provides: 'Plugin package and e2e project structure'
provides:
  - 'Prebaked Docker image with Nx workspace and nrwl/nx clone'
  - 'testcontainers-based global setup with Verdaccio + snapshot pattern'
  - 'ProvidedContext type augmentation for Vitest provide/inject'
affects: [06-add-e2e-container]

# Tech tracking
tech-stack:
  added: [testcontainers]
  patterns:
    [testcontainers-lifecycle, docker-snapshot-pattern, vitest-provide-inject]

key-files:
  created:
    - packages/op-nx-polyrepo-e2e/docker/Dockerfile
    - packages/op-nx-polyrepo-e2e/src/setup/global-setup.ts
    - packages/op-nx-polyrepo-e2e/src/setup/provided-context.ts
  modified:
    - package.json
    - package-lock.json
    - packages/op-nx-polyrepo-e2e/tsconfig.spec.json

key-decisions:
  - 'Used GenericContainer.fromDockerfile() with cache for image builds instead of shelling out to docker CLI'
  - 'Empty export in provided-context.ts to make module augmentation work (script vs module scope)'

patterns-established:
  - 'testcontainers lifecycle: Network -> Verdaccio -> publish -> workspace -> install -> commit -> provide -> teardown'
  - 'ProvidedContext augmentation for sharing container state from globalSetup to test files'

requirements-completed: []

# Metrics
duration: 6min
completed: 2026-03-16
---

# Phase 6 Plan 1: Docker Image and Testcontainers Global Setup Summary

**Prebaked Docker workspace image with testcontainers lifecycle orchestrating Verdaccio registry, plugin publish, snapshot commit, and Vitest provide/inject**

## Performance

- **Duration:** 6 min
- **Started:** 2026-03-16T06:45:58Z
- **Completed:** 2026-03-16T06:51:31Z
- **Tasks:** 2
- **Files modified:** 6

## Accomplishments

- Dockerfile prebakes node:22-slim with create-nx-workspace output and nrwl/nx shallow clone, with NX_DAEMON=false
- testcontainers global-setup.ts orchestrates full container lifecycle: shared network, Verdaccio registry, host-side plugin publish via nx/release, workspace container install, snapshot commit, Vitest provide
- ProvidedContext type augmentation exports snapshotImage and networkName keys for test files via inject()

## Task Commits

Each task was committed atomically:

1. **Task 1: Dockerfile + testcontainers dependency + ProvidedContext types** - `76f5b91` (feat)
2. **Task 2: Global setup with testcontainers lifecycle** - `3f30b37` (feat)

## Files Created/Modified

- `packages/op-nx-polyrepo-e2e/docker/Dockerfile` - Prebaked Nx workspace image with git, create-nx-workspace, nrwl/nx clone
- `packages/op-nx-polyrepo-e2e/src/setup/global-setup.ts` - testcontainers lifecycle with Network, Verdaccio, publish, install, commit, provide, teardown
- `packages/op-nx-polyrepo-e2e/src/setup/provided-context.ts` - Vitest ProvidedContext module augmentation for snapshotImage and networkName
- `package.json` - Added testcontainers devDependency
- `package-lock.json` - Lock file updated for testcontainers
- `packages/op-nx-polyrepo-e2e/tsconfig.spec.json` - Added src/setup/\*_/_.ts to includes

## Decisions Made

- Used `GenericContainer.fromDockerfile()` with `.withCache(true)` for building the workspace image instead of shelling out to `docker build` -- keeps the entire lifecycle within the testcontainers typed API
- Added empty `export {}` to provided-context.ts to make it a proper module -- TypeScript treats files without top-level imports/exports as scripts, and `declare module` augmentation only works inside modules
- Used `build('op-nx-e2e-workspace', { deleteOnExit: false })` to give the image a stable name and prevent Ryuk cleanup of the base image (snapshot is deleteOnExit: true)
- Restore original `npm_config_registry` env var after publish using try/finally to prevent test pollution

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed ProvidedContext module augmentation**

- **Found during:** Task 2 (typecheck verification)
- **Issue:** provided-context.ts had no top-level import/export, so TypeScript treated it as a script. Module augmentation (`declare module 'vitest'`) only works inside modules, causing `provide()` calls to fail with 'never' type errors.
- **Fix:** Added `export {};` at the top of provided-context.ts to make it a module
- **Files modified:** packages/op-nx-polyrepo-e2e/src/setup/provided-context.ts
- **Verification:** `npm exec nx typecheck op-nx-polyrepo-e2e` passes
- **Committed in:** 3f30b37 (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Essential fix for TypeScript correctness. No scope creep.

## Issues Encountered

- Docker Desktop not running on the machine, so Dockerfile build could not be verified at execution time. Dockerfile syntax and structure are correct; build verification deferred to when Docker is available.
- `nx sync` warning about tsconfig.json references to .repos/nx external projects -- unrelated to plan changes, ignored.

## User Setup Required

None - no external service configuration required. Docker Desktop must be running for actual e2e test execution.

## Next Phase Readiness

- Global setup and Dockerfile are ready for Plan 02 to consume
- Plan 02 will update vitest.config.mts to point globalSetup at the new setup file
- Plan 02 will refactor test files to use inject() for snapshot image and container.exec() for commands

## Self-Check: PASSED

All 4 files verified present. Both task commits (76f5b91, 3f30b37) verified in git log.

---

_Phase: 06-add-e2e-container_
_Completed: 2026-03-16_
