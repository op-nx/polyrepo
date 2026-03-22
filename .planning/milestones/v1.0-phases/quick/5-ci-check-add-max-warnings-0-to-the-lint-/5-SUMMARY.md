---
phase: quick-5
plan: 1
subsystem: tooling
tags: [eslint, nx, ci, lint, zero-warnings]

provides:
  - Zero-warning lint enforcement via nx.json targetDefaults
  - Host-only scoped package.json scripts (build, test, lint, typecheck)
affects: [ci, lint]

tech-stack:
  added: []
  patterns: [underscore-prefix convention for unused vars in eslint config]

key-files:
  created: []
  modified:
    - nx.json
    - package.json
    - eslint.config.mjs
    - packages/op-nx-polyrepo/src/index.spec.ts
    - packages/op-nx-polyrepo/src/lib/graph/cache.spec.ts

key-decisions:
  - 'Use argsIgnorePattern/varsIgnorePattern with ^_ for unused vars convention'
  - 'Remove top-level mock variables in cache.spec.ts (replaced by loadMocks pattern)'
  - 'Scope package.json scripts to host projects only (-p @op-nx/polyrepo @op-nx/source)'

requirements-completed: [LINT-ZERO-WARNINGS]

duration: 5min
completed: 2026-03-12
---

# Quick Task 5: CI Check - Add --max-warnings=0 to Lint Summary

**Zero-warning lint enforcement via nx.json targetDefaults with eslint underscore-prefix convention for unused vars**

## Performance

- **Duration:** 5 min
- **Started:** 2026-03-12T17:23:10Z
- **Completed:** 2026-03-12T17:28:07Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments

- Fixed all 22 lint warnings across 3 files (9 non-null assertions, 12 unused vars, 1 underscore-prefixed param)
- Added `--max-warnings=0` to lint target in nx.json targetDefaults
- Scoped all package.json run-many scripts to host workspace projects only (excludes synced repos)
- Added underscore-prefix convention for unused vars/args in eslint config

## Task Commits

Each task was committed atomically:

1. **Task 1: Fix all 22 lint warnings across 3 files** - `185f3cd` (fix)
2. **Task 2: Add --max-warnings=0 to Nx lint configuration and verify all scripts** - `e905bfd` (feat)

## Files Created/Modified

- `eslint.config.mjs` - Added @typescript-eslint/no-unused-vars rule with argsIgnorePattern/varsIgnorePattern
- `nx.json` - Added lint targetDefaults with --max-warnings=0
- `package.json` - Scoped build/test/lint/typecheck scripts to host projects only
- `packages/op-nx-polyrepo/src/index.spec.ts` - Replaced 9 non-null assertions with optional chaining
- `packages/op-nx-polyrepo/src/lib/graph/cache.spec.ts` - Removed 10 unused top-level mock variables and 1 unused type import

## Decisions Made

- Used `argsIgnorePattern: '^_'` and `varsIgnorePattern: '^_'` in eslint config instead of removing underscore-prefixed params (standard TypeScript convention, preserves API signatures)
- Removed top-level mock variables in cache.spec.ts entirely rather than prefixing with underscore, since they were truly unused (tests use `loadMocks()` for fresh mocks after module reset)
- Scoped package.json scripts with `-p @op-nx/polyrepo @op-nx/source` to exclude synced repo projects from CI checks

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Removed top-level mock variables instead of prefixing**

- **Found during:** Task 2 (verification)
- **Issue:** Prefixing unused mock variables with `_` fixed ESLint but triggered TS6133 (declared but never read). The variables were truly unused because `loadMocks()` pattern provides fresh mocks per test.
- **Fix:** Removed the 9 top-level mock variable declarations and their associated imports entirely
- **Files modified:** packages/op-nx-polyrepo/src/lib/graph/cache.spec.ts
- **Verification:** Lint passes with 0 warnings, all 280 tests pass
- **Committed in:** e905bfd (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 bug fix)
**Impact on plan:** Cleaner solution than plan suggested. No scope creep.

## Issues Encountered

- `typecheck` script fails due to pre-existing issues (missing `disableHooks` property in test fixtures, read-only property assignments). These are not caused by this task's changes and were failing before.
- `nx sync` attempts to add hundreds of `.repos/` project references to tsconfig.json -- reverted since that's synced repo pollution.

## User Setup Required

None - no external service configuration required.

---

_Quick task: 5-ci-check-add-max-warnings-0-to-the-lint-_
_Completed: 2026-03-12_
