---
phase: quick-2
plan: 1
subsystem: infra
tags: [npm-scope, rename, nx-plugin, workspace]

# Dependency graph
requires:
  - phase: 01-plugin-foundation-repo-assembly
    provides: Plugin source code and project structure
provides:
  - '@op-nx/polyrepo npm-scoped package name'
  - '@op-nx/source root workspace identity'
  - 'Renamed project directories packages/op-nx-polyrepo and packages/op-nx-polyrepo-e2e'
affects: [all-phases]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - 'Scoped npm package @op-nx/polyrepo'
    - 'Root workspace package @op-nx/source'

key-files:
  created: []
  modified:
    - 'packages/op-nx-polyrepo/package.json'
    - 'packages/op-nx-polyrepo-e2e/package.json'
    - 'nx.json'
    - 'package.json'
    - 'tsconfig.base.json'
    - 'README.md'

key-decisions:
  - 'Used @op-nx/polyrepo as Nx project name (derived from scoped package name)'
  - 'Regenerated package-lock.json from scratch to eliminate stale workspace entries'

patterns-established:
  - 'Plugin registers as @op-nx/polyrepo in nx.json'
  - 'Executors referenced as @op-nx/polyrepo:sync and @op-nx/polyrepo:status'

requirements-completed: []

# Metrics
duration: 12min
completed: 2026-03-10
---

# Quick Task 2: Rename Package to @op-nx/polyrepo Summary

**Rebranded workspace from nx-openpolyrepo to @op-nx scope: plugin as @op-nx/polyrepo, root as @op-nx/source, all 83 unit tests passing**

## Performance

- **Duration:** 12 min
- **Started:** 2026-03-10T22:34:03Z
- **Completed:** 2026-03-10T22:47:02Z
- **Tasks:** 2
- **Files modified:** 32

## Accomplishments

- Moved plugin project from packages/nx-openpolyrepo to packages/op-nx-polyrepo with import path @op-nx/polyrepo
- Moved e2e project from packages/nx-openpolyrepo-e2e to packages/op-nx-polyrepo-e2e
- Replaced all string references across source code, configs, tests, and documentation
- Build and all 83 unit tests pass after rename

## Task Commits

Each task was committed atomically:

1. **Task 1: Move projects using Nx move generator** - `e3d8b66` (feat)
2. **Task 2: Replace all remaining string references and update documentation** - `ce1da48` (feat)

**Plan metadata:** pending (docs: complete quick task 2)

## Files Created/Modified

- `packages/op-nx-polyrepo/package.json` - Plugin package with name @op-nx/polyrepo
- `packages/op-nx-polyrepo-e2e/package.json` - E2e package with implicitDependencies on @op-nx/polyrepo
- `nx.json` - Plugin registration updated to @op-nx/polyrepo
- `package.json` - Root package renamed to @op-nx/source
- `tsconfig.base.json` - customConditions updated to @op-nx/source
- `tsconfig.json` - Project references updated to new paths
- `README.md` - Title changed to OpNx Polyrepo
- `packages/op-nx-polyrepo/src/index.ts` - Executor strings updated
- `packages/op-nx-polyrepo/src/index.spec.ts` - Test assertions updated
- `packages/op-nx-polyrepo/src/lib/config/validate.ts` - Error message updated
- `packages/op-nx-polyrepo/src/lib/executors/status/executor.ts` - Plugin lookup updated
- `packages/op-nx-polyrepo/src/lib/executors/status/executor.spec.ts` - Test fixtures updated
- `packages/op-nx-polyrepo/src/lib/executors/sync/executor.ts` - Plugin lookup updated
- `packages/op-nx-polyrepo/src/lib/executors/sync/executor.spec.ts` - Test fixtures updated
- `packages/op-nx-polyrepo-e2e/src/op-nx-polyrepo.spec.ts` - All e2e references updated
- `tools/scripts/start-local-registry.ts` - Local registry target updated
- `packages/op-nx-polyrepo/tsconfig.lib.json` - outDir and tsBuildInfoFile paths
- `packages/op-nx-polyrepo/vitest.config.mts` - cacheDir and test name
- `packages/op-nx-polyrepo-e2e/vitest.config.mts` - cacheDir and test name
- `packages/op-nx-polyrepo/README.md` - Package README updated
- `package-lock.json` - Regenerated with new package names

## Decisions Made

- Used @op-nx/polyrepo as Nx project name (derived from npm scoped package name in package.json)
- Regenerated package-lock.json from scratch (rm + npm install) to cleanly eliminate stale workspace entries that persisted through incremental npm install
- Fixed e2e implicitDependencies to reference `@op-nx/polyrepo` (the Nx project name, not directory name)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Nx move generator placed files at repo root instead of packages/**

- **Found during:** Task 1 (Move projects using Nx move generator)
- **Issue:** First attempt with `--destination=op-nx-polyrepo` placed files at repo root, not under packages/
- **Fix:** Reset and re-ran with `--destination=packages/op-nx-polyrepo`
- **Files modified:** All project files
- **Verification:** `ls packages/op-nx-polyrepo/package.json` confirmed correct placement

**2. [Rule 3 - Blocking] Nx move generator failed for e2e project due to stale plugin reference**

- **Found during:** Task 1 (Move projects using Nx move generator)
- **Issue:** After first move, nx.json still referenced `nx-openpolyrepo` plugin which pointed to non-existent old directory. E2e project also had stale implicitDependencies.
- **Fix:** Ran `npm install` to update workspace symlinks before moving e2e project
- **Files modified:** nx.json (temporarily), packages/nx-openpolyrepo-e2e/package.json (temporarily)
- **Verification:** Second move generator ran successfully

**3. [Rule 3 - Blocking] Move generator left stale path references in tsconfig/vitest configs**

- **Found during:** Task 1 (Move projects using Nx move generator)
- **Issue:** tsconfig.json project references, tsconfig.lib.json outDir/tsBuildInfoFile, and vitest.config.mts cacheDir/name still referenced old directory names
- **Fix:** Manually updated all stale path references
- **Files modified:** tsconfig.json, packages/op-nx-polyrepo/tsconfig.lib.json, packages/op-nx-polyrepo/vitest.config.mts, packages/op-nx-polyrepo-e2e/vitest.config.mts
- **Verification:** Build and tests pass

**4. [Rule 1 - Bug] Package README.md had stale project name references**

- **Found during:** Task 2 (Replace all remaining string references)
- **Issue:** packages/op-nx-polyrepo/README.md still contained `nx-openpolyrepo` in title and commands
- **Fix:** Replaced all occurrences with `op-nx-polyrepo`
- **Files modified:** packages/op-nx-polyrepo/README.md

**5. [Rule 3 - Blocking] package-lock.json retained stale workspace entries after npm install**

- **Found during:** Task 2 (Replace all remaining string references)
- **Issue:** Incremental npm install left old `nx-openpolyrepo-e2e` and `packages/nx-openpolyrepo` entries
- **Fix:** Deleted package-lock.json and regenerated from scratch with `npm install`
- **Files modified:** package-lock.json
- **Verification:** `git grep "nx-openpolyrepo" -- . ":(exclude).planning"` returns zero results

---

**Total deviations:** 5 auto-fixed (1 bug, 4 blocking)
**Impact on plan:** All auto-fixes were necessary to work around Nx move generator limitations. No scope creep.

## Issues Encountered

- Nx move generator does not update tsconfig.json project references, tsconfig.lib.json output paths, vitest config names, or string literals in source code -- all required manual correction as the plan anticipated
- E2e spec file not renamed by generator (nx-openpolyrepo.spec.ts to op-nx-polyrepo.spec.ts) -- renamed manually

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Workspace fully rebranded under @op-nx scope
- Ready for Phase 2 development or npm publishing under new scope

---

_Quick Task: 2-rename-package-to-op-nx-polyrepo-update-_
_Completed: 2026-03-10_
