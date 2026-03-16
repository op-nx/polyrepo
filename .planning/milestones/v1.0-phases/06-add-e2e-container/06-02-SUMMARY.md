---
phase: 06-add-e2e-container
plan: 02
subsystem: testing
tags: [testcontainers, docker, e2e, vitest, container-exec]

# Dependency graph
requires:
  - phase: 06-add-e2e-container
    plan: 01
    provides: "Prebaked Docker image, testcontainers global setup, ProvidedContext types"
provides:
  - "Container-based e2e tests using testcontainers container.exec()"
  - "23s e2e wall time on warm Docker cache (down from ~3min host-based)"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns: [container-exec-testing, vitest-inject-snapshot-image]

key-files:
  created:
    - packages/op-nx-polyrepo-e2e/docker/verdaccio.yaml
  modified:
    - packages/op-nx-polyrepo-e2e/src/op-nx-polyrepo.spec.ts
    - packages/op-nx-polyrepo-e2e/vitest.config.mts
    - packages/op-nx-polyrepo-e2e/src/setup/global-setup.ts
    - packages/op-nx-polyrepo-e2e/docker/Dockerfile

key-decisions:
  - "Used file:///repos/nx URL scheme for local repo reference (schema validation requires URL format)"
  - "Used Docker CLI for image build instead of fromDockerfile() (Windows path issues with testcontainers)"
  - "Added container-specific verdaccio.yaml with correct storage path for npm auth token publishing"
  - "Used RegExp#exec() for JSON extraction from nx show output (more robust than replace)"

patterns-established:
  - "container.exec() pattern: all Nx commands run inside container, not on host"
  - "nx.json written via heredoc through sh -c in container.exec()"

requirements-completed: []

# Metrics
duration: 8min
completed: 2026-03-16
---

# Phase 6 Plan 2: Rewrite E2E Tests to Use Testcontainers Summary

**E2E tests rewritten from host execSync to container.exec() with 23s wall time on warm cache, using inject('snapshotImage') from global setup**

## Performance

- **Duration:** ~8 min (active execution, excludes checkpoint wait)
- **Started:** 2026-03-16T06:55:14Z
- **Completed:** 2026-03-16T07:30:00Z
- **Tasks:** 2 (1 auto + 1 human-verify checkpoint)
- **Files modified:** 5

## Accomplishments
- Replaced all host-based execSync calls with container.exec() running inside Docker containers
- Vitest config now uses testcontainers global setup with reduced timeouts (60s test, 120s hook)
- All 3 e2e tests pass: plugin installed, unsynced repo detection, target registration
- Wall time 23.3s on warm Docker cache (target was under 30s)

## Task Commits

Each task was committed atomically:

1. **Task 1: Rewrite spec + update Vitest config** - `50747ec` (feat)
2. **Task 2: Verification fixes during human-verify** (orchestrator commits):
   - `4c12642` - fix: Docker CLI for image build instead of fromDockerfile()
   - `4fb9960` - fix: Dockerfile ca-certificates and exit code handling
   - `ce2f3dd` - fix: Verdaccio auth, URL scheme, project name, JSON parsing
   - `ca45c9f` - fix: lint errors in e2e spec

## Files Created/Modified
- `packages/op-nx-polyrepo-e2e/src/op-nx-polyrepo.spec.ts` - Rewritten to use inject('snapshotImage'), GenericContainer, container.exec() for all Nx commands
- `packages/op-nx-polyrepo-e2e/vitest.config.mts` - globalSetup points to new setup, reduced timeouts from 300s to 60s/120s
- `packages/op-nx-polyrepo-e2e/src/setup/global-setup.ts` - Switched to Docker CLI build, added npm auth token for Verdaccio publish
- `packages/op-nx-polyrepo-e2e/docker/Dockerfile` - Added ca-certificates, fixed create-nx-workspace exit code handling
- `packages/op-nx-polyrepo-e2e/docker/verdaccio.yaml` - Container-specific Verdaccio config with correct storage path

## Decisions Made
- Used `file:///repos/nx` URL scheme for local repo reference in nx.json -- the plugin's schema validation requires a URL format, bare paths are rejected
- Switched from `GenericContainer.fromDockerfile()` to Docker CLI build -- testcontainers path handling has issues with Windows paths
- Added container-specific `verdaccio.yaml` -- default Verdaccio config uses wrong storage path in container context
- Used `@workspace/source` as project name (matches create-nx-workspace output) instead of `@org/source`
- Used `RegExp#exec()` for JSON extraction from `nx show` output -- more robust than `String#replace()` for stripping Nx warnings

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed restrict-template-expressions lint error in global-setup.ts**
- **Found during:** Task 1 (lint verification)
- **Issue:** `registryPort` (number) used directly in template literal violated @typescript-eslint/restrict-template-expressions
- **Fix:** Wrapped in `String(registryPort)`
- **Files modified:** packages/op-nx-polyrepo-e2e/src/setup/global-setup.ts
- **Verification:** `npm exec nx lint op-nx-polyrepo-e2e` passes
- **Committed in:** 50747ec (Task 1 commit)

### Orchestrator Fixes During Verification

The following issues were discovered and fixed by the orchestrator during the human-verify checkpoint:

**2. Windows path issues with fromDockerfile()** -- switched to Docker CLI build (4c12642)
**3. Dockerfile missing ca-certificates and exit code handling** -- added package and || guard (4fb9960)
**4. Verdaccio auth, URL scheme, project name, JSON parsing** -- multiple fixes for runtime correctness (ce2f3dd)
**5. Lint errors in updated spec** -- fixed after runtime fixes changed the spec (ca45c9f)

---

**Total deviations:** 1 auto-fixed (blocking), 4 orchestrator-fixed during verification
**Impact on plan:** All fixes necessary for runtime correctness. The core spec structure and test strategy remained as planned.

## Issues Encountered
- `tsconfig.json` polluted by `nx sync` adding .repos/nx external project references -- restored via `git checkout`, unrelated to plan changes
- Pre-existing lint error in global-setup.ts from Plan 01 (restrict-template-expressions) had to be fixed to pass lint

## User Setup Required

None - Docker Desktop must be running for e2e test execution.

## Next Phase Readiness
- Phase 6 is complete. All e2e tests run inside Docker containers via testcontainers.
- No further plans in this phase.

## Self-Check: PASSED

Verified below.

---
*Phase: 06-add-e2e-container*
*Completed: 2026-03-16*
