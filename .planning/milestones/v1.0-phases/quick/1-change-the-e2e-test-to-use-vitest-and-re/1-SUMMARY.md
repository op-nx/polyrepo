---
phase: quick
plan: 1
subsystem: testing
tags: [vitest, jest, e2e, nx-plugin, verdaccio]

# Dependency graph
requires: []
provides:
  - 'Unified Vitest test runner for all projects (unit + e2e)'
  - 'Jest-free workspace'
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - 'Vitest globalSetup/globalTeardown for e2e local registry lifecycle'
    - 'createRequire(import.meta.url) for require.resolve in ESM test files'

key-files:
  created:
    - 'packages/nx-openpolyrepo-e2e/vitest.config.mts'
  modified:
    - 'packages/nx-openpolyrepo-e2e/package.json'
    - 'packages/nx-openpolyrepo-e2e/tsconfig.spec.json'
    - 'packages/nx-openpolyrepo-e2e/src/nx-openpolyrepo.spec.ts'
    - 'tools/scripts/start-local-registry.ts'
    - 'tools/scripts/stop-local-registry.ts'
    - 'nx.json'
    - 'package.json'

key-decisions:
  - 'Used @nx/vitest:test executor instead of deprecated @nx/vite:test'
  - 'Used maxWorkers: 1 instead of deprecated poolOptions.forks.singleFork for Vitest 4'
  - 'Added hookTimeout: 300_000 alongside testTimeout for beforeAll/afterAll hooks'

patterns-established:
  - 'E2e vitest config with 5-min test+hook timeouts, forks pool, single worker'

requirements-completed: []

# Metrics
duration: 10min
completed: 2026-03-10
---

# Quick Task 1: Migrate E2E Tests from Jest to Vitest Summary

**E2e tests migrated to Vitest with globalSetup/globalTeardown for Verdaccio registry lifecycle, all Jest tooling removed from workspace**

## Performance

- **Duration:** 10 min
- **Started:** 2026-03-10T22:01:30Z
- **Completed:** 2026-03-10T22:11:30Z
- **Tasks:** 2
- **Files modified:** 10

## Accomplishments

- E2e tests run and pass using Vitest via @nx/vitest:test executor
- All Jest dependencies, config files, and plugin references removed from workspace
- Unit tests unaffected and still passing (83 tests)

## Task Commits

Each task was committed atomically:

1. **Task 1: Create Vitest config and update e2e project target** - `408a344` (feat)
2. **Task 2: Remove all Jest tooling from the workspace** - `910512e` (chore)

## Files Created/Modified

- `packages/nx-openpolyrepo-e2e/vitest.config.mts` - Vitest config with globalSetup/globalTeardown, 5-min timeouts, forks pool
- `packages/nx-openpolyrepo-e2e/package.json` - Switched executor from @nx/jest:jest to @nx/vitest:test
- `packages/nx-openpolyrepo-e2e/tsconfig.spec.json` - Updated types from jest to vitest/globals, removed CJS module settings
- `packages/nx-openpolyrepo-e2e/src/nx-openpolyrepo.spec.ts` - Added createRequire for ESM compatibility
- `tools/scripts/start-local-registry.ts` - Updated JSDoc from Jest to Vitest
- `tools/scripts/stop-local-registry.ts` - Updated JSDoc from Jest to Vitest
- `nx.json` - Removed @nx/jest/plugin and jest.config namedInput exclusion
- `package.json` - Removed 8 Jest-related devDependencies
- `package-lock.json` - Updated lockfile after uninstalling Jest packages
- `jest.config.ts` - Deleted (root Jest multi-project config)
- `jest.preset.js` - Deleted (Jest preset)
- `packages/nx-openpolyrepo-e2e/jest.config.cts` - Deleted (e2e Jest config)

## Decisions Made

- Used `@nx/vitest:test` executor instead of `@nx/vite:test` which is deprecated and scheduled for removal in Nx 23
- Used `maxWorkers: 1` as the Vitest 4 replacement for the removed `poolOptions.forks.singleFork` option
- Added `hookTimeout: 300_000` in addition to `testTimeout` because Vitest has separate timeout defaults for hooks (10s) vs tests
- Kept `tools/scripts/registry.d.ts` for global.stopLocalRegistry type declaration
- Kept the `global.stopLocalRegistry` pattern in start/stop scripts as instructed

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Added hookTimeout for beforeAll/afterAll**

- **Found during:** Task 1 (Vitest config creation)
- **Issue:** Vitest default hookTimeout is 10s, but beforeAll creates an Nx workspace which takes ~75s. Tests were skipped due to hook timeout.
- **Fix:** Added `hookTimeout: 300_000` to vitest.config.mts
- **Files modified:** packages/nx-openpolyrepo-e2e/vitest.config.mts
- **Verification:** E2e tests pass with 3/3 tests succeeding
- **Committed in:** 408a344 (Task 1 commit)

**2. [Rule 1 - Bug] Fixed deprecated poolOptions for Vitest 4**

- **Found during:** Task 1 (Vitest config creation)
- **Issue:** `test.poolOptions` was removed in Vitest 4. Using it caused a deprecation warning.
- **Fix:** Replaced `poolOptions.forks.singleFork: true` with top-level `maxWorkers: 1`
- **Files modified:** packages/nx-openpolyrepo-e2e/vitest.config.mts
- **Verification:** No deprecation warnings, tests run serially as expected
- **Committed in:** 408a344 (Task 1 commit)

**3. [Rule 1 - Bug] Used @nx/vitest:test instead of @nx/vite:test**

- **Found during:** Task 1 (e2e target update)
- **Issue:** Plan specified `@nx/vite:test` but this executor is deprecated in favor of `@nx/vitest:test`
- **Fix:** Used `@nx/vitest:test` executor in package.json
- **Files modified:** packages/nx-openpolyrepo-e2e/package.json
- **Verification:** Executor resolves correctly, no deprecation warning
- **Committed in:** 408a344 (Task 1 commit)

---

**Total deviations:** 3 auto-fixed (3 bugs)
**Impact on plan:** All auto-fixes necessary for correctness with Vitest 4 and current Nx version. No scope creep.

## Issues Encountered

None beyond the auto-fixed deviations above.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Workspace fully unified on Vitest for both unit and e2e tests
- No Jest tooling remains to maintain or update

## Self-Check: PASSED

All created files exist, all deleted files confirmed removed, both task commits verified.

---

_Phase: quick_
_Completed: 2026-03-10_
