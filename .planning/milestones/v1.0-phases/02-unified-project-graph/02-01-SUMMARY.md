---
phase: 02-unified-project-graph
plan: 01
subsystem: graph
tags: [nx-plugin, typescript, zod, git, url-normalization, vitest]

# Dependency graph
requires:
  - phase: 01-plugin-foundation-repo-assembly
    provides: "Config schema, git commands, sync executor, detect.ts"
provides:
  - "ExternalGraphJson, TransformedNode, PolyrepoGraphReport type interfaces"
  - "getHeadSha and getDirtyFiles git utility functions"
  - "normalizeGitUrl for SSH/HTTPS/git:// URL normalization"
  - "Duplicate repo URL detection in config schema"
  - "Dependency installation after clone/pull in sync executor"
affects: [02-02-PLAN, 02-03-PLAN]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "zod .check() for custom multi-field validation (duplicate URL detection)"
    - "Lock file detection for package manager selection (pnpm-lock.yaml/yarn.lock/npm)"
    - "Git URL normalization algorithm (SSH->HTTPS, strip .git, lowercase host)"

key-files:
  created:
    - "packages/op-nx-polyrepo/src/lib/graph/types.ts"
    - "packages/op-nx-polyrepo/src/lib/git/normalize-url.ts"
    - "packages/op-nx-polyrepo/src/lib/git/normalize-url.spec.ts"
  modified:
    - "packages/op-nx-polyrepo/src/lib/git/detect.ts"
    - "packages/op-nx-polyrepo/src/lib/git/detect.spec.ts"
    - "packages/op-nx-polyrepo/src/lib/config/schema.ts"
    - "packages/op-nx-polyrepo/src/lib/config/schema.spec.ts"
    - "packages/op-nx-polyrepo/src/lib/executors/sync/executor.ts"
    - "packages/op-nx-polyrepo/src/lib/executors/sync/executor.spec.ts"

key-decisions:
  - "Used zod .check() instead of .refine() for duplicate URL detection -- zod v4 .check() provides ctx.issues for custom error messages"
  - "Guard normalizeGitUrl URL parsing with https:// prefix check to prevent Windows drive letters being parsed as URL protocols"
  - "Install deps for ALL repos (remote + local) per user decision in CONTEXT.md"

patterns-established:
  - "Lock file detection pattern: pnpm-lock.yaml -> pnpm, yarn.lock -> yarn, default -> npm"
  - "Graceful degradation pattern: install failure logs warning but does not fail the parent operation"

requirements-completed: [GRPH-03, GRPH-04]

# Metrics
duration: 8min
completed: 2026-03-11
---

# Phase 2 Plan 1: Foundations Summary

**Graph type contracts for nx graph --print output, git HEAD/dirty detection, URL normalization for duplicate repo detection, and sync executor dependency installation**

## Performance

- **Duration:** 8 min
- **Started:** 2026-03-11T06:18:56Z
- **Completed:** 2026-03-11T06:26:39Z
- **Tasks:** 2
- **Files modified:** 9

## Accomplishments
- Graph type interfaces (ExternalGraphJson, TransformedNode, PolyrepoGraphReport) matching nx graph --print output structure
- Git HEAD SHA and dirty file detection functions for two-layer cache invalidation
- Git URL normalization handling SSH, ssh://, git://, HTTPS protocols with hostname lowercasing
- Config schema duplicate URL detection catching SSH/HTTPS/git:// variants of the same repo
- Sync executor installs dependencies after clone/pull for all repos with package manager auto-detection

## Task Commits

Each task was committed atomically (TDD: test then feat):

1. **Task 1: Graph type interfaces, git HEAD/dirty detection, and URL normalization**
   - `220ef7d` (test) - Failing tests for graph types, getHeadSha, getDirtyFiles, normalizeGitUrl
   - `48d6fd7` (feat) - Implementation passing all tests

2. **Task 2: Duplicate URL detection and sync dependency installation**
   - `f3d7350` (test) - Failing tests for duplicate URL detection and sync dep install
   - `022371b` (feat) - Implementation passing all tests

## Files Created/Modified
- `packages/op-nx-polyrepo/src/lib/graph/types.ts` - TypeScript interfaces for external graph JSON, transformed nodes, graph report
- `packages/op-nx-polyrepo/src/lib/git/normalize-url.ts` - Git URL normalization (SSH/HTTPS/git:// to canonical HTTPS form)
- `packages/op-nx-polyrepo/src/lib/git/normalize-url.spec.ts` - 9 tests for URL normalization
- `packages/op-nx-polyrepo/src/lib/git/detect.ts` - Extended with getHeadSha and getDirtyFiles
- `packages/op-nx-polyrepo/src/lib/git/detect.spec.ts` - Extended with 5 tests for new git functions
- `packages/op-nx-polyrepo/src/lib/config/schema.ts` - Extended with duplicate URL detection via .check()
- `packages/op-nx-polyrepo/src/lib/config/schema.spec.ts` - Extended with 5 tests for duplicate URL detection
- `packages/op-nx-polyrepo/src/lib/executors/sync/executor.ts` - Extended with dependency installation after clone/pull
- `packages/op-nx-polyrepo/src/lib/executors/sync/executor.spec.ts` - Extended with 6 tests for dep install

## Decisions Made
- Used zod v4 `.check()` instead of `.refine()` for duplicate URL detection -- `.check()` provides `ctx.issues` for proper custom error messages with alias names in the error text
- Guarded `new URL()` parsing in normalizeGitUrl with `https://` prefix check to prevent Windows drive letters (e.g., `D:`) from being interpreted as URL protocols
- Install deps for ALL repos (remote and local path) per explicit user decision documented in CONTEXT.md

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Windows drive letter URL parsing in normalizeGitUrl**
- **Found during:** Task 1 (normalizeGitUrl implementation)
- **Issue:** `new URL('D:/projects/repo')` parses successfully with `D:` as protocol, corrupting local paths
- **Fix:** Only attempt URL parsing when string starts with `https://`
- **Files modified:** `packages/op-nx-polyrepo/src/lib/git/normalize-url.ts`
- **Verification:** Test "returns non-URL strings as-is (for local paths)" passes
- **Committed in:** `48d6fd7` (part of task 1 feat commit)

**2. [Rule 1 - Bug] Zod v4 .refine() message function not producing custom messages**
- **Found during:** Task 2 (duplicate URL detection)
- **Issue:** Zod v4's `.refine()` with function-form second argument produced "Invalid input" instead of custom message
- **Fix:** Switched to `.check()` API which provides `ctx.issues.push()` for custom error messages
- **Files modified:** `packages/op-nx-polyrepo/src/lib/config/schema.ts`
- **Verification:** All duplicate URL detection tests pass with correct error messages
- **Committed in:** `022371b` (part of task 2 feat commit)

---

**Total deviations:** 2 auto-fixed (2 bugs)
**Impact on plan:** Both auto-fixes necessary for correctness on Windows and zod v4 compatibility. No scope creep.

## Issues Encountered
None beyond the auto-fixed deviations above.

## User Setup Required
None - no external service configuration required.

## Next Phase Readiness
- Graph type interfaces ready for Plan 02 (graph extraction pipeline) and Plan 03 (createNodesV2/createDependencies)
- getHeadSha and getDirtyFiles ready for two-layer cache invalidation in Plan 02
- normalizeGitUrl integrated into config schema for Plan 02/03 duplicate detection
- Sync executor dep install ensures `node_modules/.bin/nx` exists in child repos for Plan 02 graph extraction
- All 108 tests pass, build succeeds, lint clean (no new warnings)

## Self-Check: PASSED

All 10 files verified present. All 4 commits verified in git log.

---
*Phase: 02-unified-project-graph*
*Completed: 2026-03-11*
