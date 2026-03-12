---
phase: 05-avoid-type-casting-and-prefer-satisfies
plan: 01
subsystem: tooling
tags: [eslint, typescript-eslint, tsconfig, vitest, strict-type-checked, type-safety]

requires:
  - phase: 04-code-cleanup
    provides: Clean codebase with zero lint warnings and passing typecheck
provides:
  - Strict ESLint config with strictTypeCheckedOnly + stylisticTypeCheckedOnly layered on Nx presets
  - Hardened TSConfig with noUncheckedIndexedAccess and noPropertyAccessFromIndexSignature
  - Vitest ESLint plugin with all preset and SIFER enforcement via no-hooks rule
  - Type-checked linting enabled via parserOptions.projectService
affects: [05-02, 05-03, 05-04, 05-05, 05-06]

tech-stack:
  added: ["@vitest/eslint-plugin"]
  patterns: ["strictTypeCheckedOnly layered on Nx flat/typescript", "disableTypeChecked for JS files", "projectService for type-checked linting"]

key-files:
  created: []
  modified: ["eslint.config.mjs", "tsconfig.base.json", "packages/op-nx-polyrepo/vitest.config.mts", "package.json", "package-lock.json"]

key-decisions:
  - "Removed exactOptionalPropertyTypes: conflicts with @nx/devkit types (TargetConfiguration, ProjectConfiguration assign undefined to optional properties)"
  - "Removed allowAsConst from consistent-type-assertions: assertionStyle 'never' schema does not support allowAsConst option"
  - "Kept assertionStyle 'never' without allowAsConst: as const usage already removed from vitest.config.mts, future needs use satisfies patterns"

patterns-established:
  - "ESLint config layering: Nx base -> Nx typescript -> Nx javascript -> strictTypeCheckedOnly -> stylisticTypeCheckedOnly -> eslintComments -> vitest (test files) -> disableTypeChecked (JS files) -> project overrides"
  - "Type-checked linting: parserOptions.projectService: true for TS files, disableTypeChecked for JS/MJS/CJS"
  - "Vitest test linting: vitest.configs.all scoped to *.spec.ts and *.test.ts with explicit-function-return-type off"

requirements-completed: [SAFE-ESLINT, SAFE-TSCONFIG]

duration: 12min
completed: 2026-03-12
---

# Phase 5 Plan 01: ESLint/TSConfig Hardening Summary

**Strict-type-checked ESLint preset with vitest plugin, noUncheckedIndexedAccess, and noPropertyAccessFromIndexSignature enabled as detection foundation for subsequent fix plans**

## Performance

- **Duration:** 12 min
- **Started:** 2026-03-12T21:57:28Z
- **Completed:** 2026-03-12T22:09:05Z
- **Tasks:** 2
- **Files modified:** 5

## Accomplishments
- Rewrote ESLint config with strictTypeCheckedOnly + stylisticTypeCheckedOnly layered on Nx presets
- Installed @vitest/eslint-plugin with all preset + no-hooks rule for SIFER enforcement
- Enabled parserOptions.projectService for type-checked linting on TS files
- Disabled type-checked rules for JS/MJS/CJS files to prevent "no program found" errors
- Promoted all warn-level rules to error (no-unused-vars, no-explicit-any, no-non-null-assertion)
- Added consistent-type-imports, consistent-type-exports, consistent-type-definitions, explicit-function-return-type rules
- Hardened tsconfig with noUncheckedIndexedAccess and noPropertyAccessFromIndexSignature
- Removed redundant `as const` from vitest.config.mts

## Task Commits

Each task was committed atomically:

1. **Task 1: Install @vitest/eslint-plugin and rewrite ESLint config** - `f59a6ed` (feat)
2. **Task 2: Harden TSConfig and fix vitest.config.mts** - `0eb71ae` (feat)

## Files Created/Modified
- `eslint.config.mjs` - Rewritten with strict-type-checked preset, vitest plugin, SIFER enforcement
- `tsconfig.base.json` - Added noUncheckedIndexedAccess, noPropertyAccessFromIndexSignature
- `packages/op-nx-polyrepo/vitest.config.mts` - Removed redundant `as const` cast
- `package.json` - Added @vitest/eslint-plugin devDependency
- `package-lock.json` - Updated lockfile

## Decisions Made
- Removed `exactOptionalPropertyTypes` from tsconfig: conflicts with @nx/devkit types (TargetConfiguration, ProjectConfiguration) that assign `undefined` to optional properties (Pitfall 4 from research)
- Removed `allowAsConst` from consistent-type-assertions rule: the `assertionStyle: 'never'` schema variant does not support additional properties. Since `as const` usage was already removed from vitest.config.mts, this is not a functional loss -- future `as const` needs use `satisfies` patterns instead
- Kept `assertionStyle: 'never'` as the strictest possible mode for type assertions

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Removed invalid allowAsConst ESLint option**
- **Found during:** Task 2 (typecheck revealed ESLint config parse error)
- **Issue:** `consistent-type-assertions` with `assertionStyle: 'never'` does not accept `allowAsConst` property -- ESLint schema validation fails, blocking Nx project graph processing
- **Fix:** Removed `allowAsConst: true` from the rule config
- **Files modified:** `eslint.config.mjs`
- **Verification:** Typecheck runs without ESLint config errors
- **Committed in:** `0eb71ae` (Task 2 commit)

---

**Total deviations:** 1 auto-fixed (1 blocking)
**Impact on plan:** Minimal -- `as const` was already removed from vitest.config.mts, and `assertionStyle: 'never'` is the strictest mode. No scope reduction.

## Issues Encountered
- Typecheck reports 142 violations from the new strict flags (noUncheckedIndexedAccess, noPropertyAccessFromIndexSignature) and type-checked rules. This is expected and intentional -- subsequent plans 02-05 fix these violations.
- `nx sync` attempted to add `.repos/` project references to `tsconfig.json` -- discarded as unrelated to this plan.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- ESLint strict-type-checked rules are active and detecting violations in all TS files
- TSConfig hardening flags are enabled, revealing 142 typecheck violations for subsequent plans to fix
- Vitest ESLint plugin is enforcing test quality rules including no-hooks for SIFER migration
- Plans 02-06 can now detect and fix specific violation categories

---
*Phase: 05-avoid-type-casting-and-prefer-satisfies*
*Completed: 2026-03-12*
