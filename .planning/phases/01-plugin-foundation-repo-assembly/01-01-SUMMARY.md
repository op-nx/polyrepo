---
phase: 01-plugin-foundation-repo-assembly
plan: 01
subsystem: plugin
tags: [nx-plugin, zod, createNodesV2, config-validation, vitest]

# Dependency graph
requires: []
provides:
  - "nx-openpolyrepo plugin project with build, test, typecheck targets"
  - "Zod config schema (polyrepoConfigSchema) with PolyrepoConfig type"
  - "NormalizedRepoEntry type and normalizeRepos function"
  - "Config validation (validateConfig, warnIfReposNotGitignored, warnUnsyncedRepos)"
  - "Plugin entry (createNodesV2) registering polyrepo-sync and polyrepo-status targets"
  - "executors.json with sync and status executor stubs"
affects: [01-02, 01-03, 02-graph-discovery]

# Tech tracking
tech-stack:
  added: [zod@4.3.6]
  patterns: [createNodesV2 plugin entry, zod schema validation, TDD red-green]

key-files:
  created:
    - packages/nx-openpolyrepo/src/lib/config/schema.ts
    - packages/nx-openpolyrepo/src/lib/config/validate.ts
    - packages/nx-openpolyrepo/src/index.ts
    - packages/nx-openpolyrepo/executors.json
    - packages/nx-openpolyrepo/src/lib/config/schema.spec.ts
    - packages/nx-openpolyrepo/src/lib/config/validate.spec.ts
    - packages/nx-openpolyrepo/src/index.spec.ts
  modified:
    - packages/nx-openpolyrepo/package.json
    - packages/nx-openpolyrepo/vitest.config.mts
    - package.json
    - tsconfig.json
    - nx.json

key-decisions:
  - "Changed vitest environment from jsdom to node -- plugin is Node.js code, not browser"
  - "Used .strict() on zod object schemas to reject objects with both url and path fields"
  - "Used .refine() on repos record to require at least one entry"

patterns-established:
  - "Zod schema validation pattern: safeParse + formatted error throw"
  - "createNodesV2 tuple pattern: glob on nx.json, validate options, register targets on root project"
  - "Test mocking pattern: vi.mock with importOriginal for node:fs and node:fs/promises"

requirements-completed: [ASSM-01, ASSM-04]

# Metrics
duration: 6min
completed: 2026-03-10
---

# Phase 1 Plan 01: Plugin Foundation Summary

**Nx plugin scaffolded with zod config schema validating URL/path repo entries, createNodesV2 registering polyrepo-sync and polyrepo-status targets on root project**

## Performance

- **Duration:** 6 min
- **Started:** 2026-03-10T20:10:22Z
- **Completed:** 2026-03-10T20:16:23Z
- **Tasks:** 3
- **Files modified:** 13

## Accomplishments
- Plugin project scaffolded with @nx/plugin:plugin generator, vitest, tsc build
- Zod config schema validates all forms from CONTEXT.md (string URL, string path, object with url/path/ref/depth)
- normalizeRepos converts all entry forms to typed NormalizedRepoEntry (remote with depth default 1, local)
- Plugin entry exports createNodesV2 that validates config at load time and registers executor targets
- 31 tests passing across schema, validation, and plugin entry

## Task Commits

Each task was committed atomically:

1. **Task 1: Scaffold plugin project and install zod** - `317d4b9` (feat)
2. **Task 2: Create config schema and validation with tests (RED)** - `84a0c72` (test)
3. **Task 2: Create config schema and validation with tests (GREEN)** - `05187c4` (feat)
4. **Task 3: Wire plugin entry point with createNodesV2** - `00f7218` (feat)

_Note: Task 2 used TDD with separate RED and GREEN commits._

## Files Created/Modified
- `packages/nx-openpolyrepo/src/lib/config/schema.ts` - Zod schema, PolyrepoConfig type, NormalizedRepoEntry type, normalizeRepos function
- `packages/nx-openpolyrepo/src/lib/config/validate.ts` - validateConfig, warnIfReposNotGitignored, warnUnsyncedRepos
- `packages/nx-openpolyrepo/src/index.ts` - Plugin entry with createNodesV2 tuple
- `packages/nx-openpolyrepo/executors.json` - Executor registration for sync and status
- `packages/nx-openpolyrepo/package.json` - Plugin package with executors field and build config
- `packages/nx-openpolyrepo/vitest.config.mts` - Vitest config (node environment)
- `packages/nx-openpolyrepo/src/lib/config/schema.spec.ts` - 22 schema tests
- `packages/nx-openpolyrepo/src/lib/config/validate.spec.ts` - 6 validation tests
- `packages/nx-openpolyrepo/src/index.spec.ts` - 3 plugin entry tests

## Decisions Made
- Changed vitest environment from jsdom (generator default) to node -- this is a Node.js Nx plugin, not browser code
- Used `.strict()` on zod object schemas so objects with both `url` and `path` fields are correctly rejected as ambiguous
- Used `.refine()` on repos record to require at least one entry (empty repos map rejected)
- Added `executors.json` to build assets so it gets copied to dist during build

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed vitest environment from jsdom to node**
- **Found during:** Task 2 (config schema tests)
- **Issue:** Generator scaffolded jsdom environment which cannot resolve node:fs/promises
- **Fix:** Changed `environment: 'jsdom'` to `environment: 'node'` in vitest.config.mts
- **Files modified:** packages/nx-openpolyrepo/vitest.config.mts
- **Verification:** All tests pass
- **Committed in:** 05187c4 (Task 2 GREEN commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Necessary for correctness. No scope creep.

## Issues Encountered
None beyond the vitest environment fix documented above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Config schema and validation are complete, ready for Plan 02 (polyrepo-sync executor) and Plan 03 (polyrepo-status executor)
- createNodesV2 plugin entry wired up, ready for integration testing after executors are implemented
- executors.json has sync and status entries pointing to not-yet-created executor files

## Self-Check: PASSED

All 8 key files verified present. All 4 task commits verified in git log.

---
*Phase: 01-plugin-foundation-repo-assembly*
*Completed: 2026-03-10*
