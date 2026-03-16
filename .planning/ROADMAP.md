# Roadmap: nx-openpolyrepo

## Overview

This roadmap delivers a working Nx plugin for synthetic monorepos in three phases. Phase 1 establishes the plugin skeleton and repo assembly pipeline -- cloning and updating external repos from nx.json configuration. Phase 2 delivers the core value: external repo projects visible in `nx graph` and `nx show projects` with proper namespacing and cached graph extraction. Phase 3 adds multi-repo git DX so users can manage all synced repos from a single command surface.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Plugin Foundation + Repo Assembly** - Plugin skeleton, git clone/pull, nx.json config with validation
- [x] **Phase 2: Unified Project Graph** - External projects in nx graph with namespacing and cached extraction (completed 2026-03-12)
- [x] **Phase 3: Multi-Repo Git DX** - Combined status, bulk operations, per-repo output (completed 2026-03-11)
- [x] **Phase 4: Code Cleanup** - Extract shared constants and deduplicate config reading (tech debt from v1.0 audit, completed 2026-03-12)
- [x] **Phase 5: Maximum Type Safety** - Eliminate all `as` assertions and `any`, adopt strictest ESLint/tsconfig, establish `satisfies`/Zod/SIFER patterns (completed 2026-03-13)
- [x] **Phase 6: Add e2e container** - Docker container with prebaked Nx workspace and repo for fast e2e tests (completed 2026-03-16)
- [ ] **Phase 7: v1.0 Tech Debt Cleanup** - Remove dead exports, add sync->status e2e test, fix planning docs (gap closure from v1.0 audit)

## Phase Details

### Phase 1: Plugin Foundation + Repo Assembly
**Goal**: Users can configure external repos in nx.json and have them cloned/updated to disk automatically
**Depends on**: Nothing (first phase)
**Requirements**: ASSM-01, ASSM-02, ASSM-03, ASSM-04
**Success Criteria** (what must be TRUE):
  1. User can add repo entries (URL + optional local alias) to nx.json plugin options and the plugin reads them
  2. Running an Nx command triggers clone of configured repos into `.repos/` directory when not yet present
  3. Running an Nx command triggers pull for already-cloned repos to bring them up to date
  4. Invalid config entries (missing URL, malformed options) produce clear error messages at plugin load time
**Plans**: 3 plans

Plans:
- [x] 01-01-PLAN.md -- Plugin scaffold, config schema with zod validation, createNodesV2 entry point
- [x] 01-02-PLAN.md -- Git command wrappers and polyrepo-sync executor (clone + pull)
- [x] 01-03-PLAN.md -- polyrepo-status executor and end-to-end integration verification

### Phase 2: Unified Project Graph
**Goal**: External repo projects appear in the unified Nx project graph with proper namespacing and fast cached extraction
**Depends on**: Phase 1
**Requirements**: GRPH-01, GRPH-02, GRPH-03, GRPH-04
**Success Criteria** (what must be TRUE):
  1. Running `nx graph` displays projects from all synced repos alongside host workspace projects
  2. Running `nx show projects` lists external repo projects in its output
  3. External repo projects are prefixed with their repo name (e.g., `repo-b/my-lib`) to prevent name collisions
  4. Graph data is extracted from cached JSON files produced during assembly, not recomputed on every Nx command
**Plans**: 4 plans

Plans:
- [x] 02-01-PLAN.md -- Graph types, git utilities, config duplicate URL detection, sync dep install
- [x] 02-02-PLAN.md -- Graph extraction pipeline (nx graph --print), two-layer cache, transformation (namespacing, tags, target rewriting)
- [x] 02-03-PLAN.md -- Run executor, createNodesV2 extension for external projects, createDependencies for intra-repo edges
- [x] 02-04-PLAN.md -- Gap closure: fix stdout contamination in extractGraphFromRepo (NX_VERBOSE_LOGGING env leak)

### Phase 3: Multi-Repo Git DX
**Goal**: Users can monitor and manage git state across all synced repos from a single command surface
**Depends on**: Phase 1
**Requirements**: GITX-01, GITX-02, GITX-03
**Success Criteria** (what must be TRUE):
  1. User can run a single command to see combined git status of all synced repos
  2. User can pull or fetch all synced repos with one command
  3. Git operations display clear per-repo output showing which repo succeeded and which failed
**Plans**: 9 plans

Plans:
- [x] 03-01-PLAN.md -- Git state detection (getWorkingTreeState, getAheadBehind) and column alignment utility
- [x] 03-02-PLAN.md -- Status executor rewrite with aligned output, auto-fetch, warnings, project counts
- [x] 03-03-PLAN.md -- Sync executor enhancements: --dry-run option and aligned results summary table
- [x] 03-04-PLAN.md -- Gap closure: status summary behind/ahead counts, 'ok' label, tag-pinned warning
- [x] 03-05-PLAN.md -- Gap closure: sync dry-run detached HEAD detection and multi-warning support
- [x] 03-06-PLAN.md -- Gap closure: remove redundant count from status dirty summary behind/ahead labels
- [x] 03-07-PLAN.md -- Gap closure: disable external repo git hooks during sync operations
- [x] 03-08-PLAN.md -- Gap closure: replace regex isTagRef with git-based tag detection
- [x] 03-09-PLAN.md -- Gap closure: conditional dep install only when HEAD changes

### Phase 4: Code Cleanup
**Goal**: Extract shared constants and deduplicate config-reading boilerplate identified in v1.0 milestone audit
**Depends on**: Phase 3
**Requirements**: None (tech debt, no new requirements)
**Success Criteria** (what must be TRUE):
  1. Cache filename constant is exported from cache.ts and imported by status/executor.ts (no duplicated magic string)
  2. Config reading logic (nx.json parsing + plugin options extraction) is shared between syncExecutor and statusExecutor
**Plans**: 1 plan

Plans:
- [x] 04-01-PLAN.md -- Export CACHE_FILENAME, create shared resolvePluginConfig utility, refactor both executors

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Plugin Foundation + Repo Assembly | 3/3 | Complete | 2026-03-10 |
| 2. Unified Project Graph | 4/4 | Complete | 2026-03-12 |
| 3. Multi-Repo Git DX | 9/9 | Complete | 2026-03-11 |
| 4. Code Cleanup | 1/1 | Complete | 2026-03-12 |
| 5. Maximum Type Safety | 6/6 | Complete | 2026-03-13 |
| 6. Add e2e container | 2/2 | Complete   | 2026-03-16 |
| 7. v1.0 Tech Debt Cleanup | 0/2 | Pending | -- |

### Phase 5: Maximum Type Safety

**Goal:** Harden the entire TypeScript codebase for maximum type safety -- eliminate all `as` assertions and `any`, adopt strictest ESLint presets and tsconfig flags, establish `satisfies`/Zod/value type patterns, refactor tests to SIFERs, create enforcement skills
**Requirements**: SAFE-ESLINT, SAFE-TSCONFIG, SAFE-ZOD, SAFE-ANY, SAFE-TYPES, SAFE-CASTS, SAFE-SIFER, SAFE-ENFORCE, SAFE-SKILLS
**Depends on:** Phase 4
**Success Criteria** (what must be TRUE):
  1. ESLint uses strict-type-checked preset with all warn rules promoted to error
  2. TSConfig has noUncheckedIndexedAccess and noPropertyAccessFromIndexSignature enabled
  3. All JSON.parse sites use Zod safeParse for runtime validation
  4. Zero `as` type assertions, zero `any`, zero eslint-disable comments
  5. All test files use SIFER pattern (zero beforeEach/afterEach hooks)
  6. Project-local skills teach AI agents the approved patterns
**Plans:** 6/6 plans executed

Plans:
- [x] 05-01-PLAN.md -- ESLint strict-type-checked preset + TSConfig hardening + @vitest/eslint-plugin install
- [x] 05-02-PLAN.md -- Zod schemas at all 3 JSON.parse system boundaries
- [x] 05-03-PLAN.md -- Fix all production code lint and typecheck violations from strict rules
- [x] 05-04-PLAN.md -- Test refactoring: git/, graph/, config/, format/, index -- cast elimination + SIFERs
- [x] 05-05-PLAN.md -- Test refactoring: executor tests -- ChildProcess mock factory, ExecutorContext factory, SIFERs
- [x] 05-06-PLAN.md -- Final enforcement verification + project-local type safety skills + vitest rule enforcement

### Phase 6: Add e2e container

**Goal:** Run e2e tests in a Docker container with prebaked Nx workspace and git repo to eliminate scaffold and clone overhead, reducing e2e runtime from ~3 min to ~8s
**Requirements**: None (DX improvement, no new features)
**Depends on:** Phase 5
**Key decisions:**
  - Host runs build + Verdaccio publish; container runs consume + test (only the tarball crosses the boundary via HTTP)
  - Prebake `create-nx-workspace` output in Docker image layer (rebuilds only on Nx version bump)
  - Prebake `git clone --depth 1` of nrwl/nx to `/repos/nx` in image layer; e2e config references it as a local path repo instead of GitHub URL
  - arm64-native `node:22-slim` image runs natively on Snapdragon X Elite via Docker Desktop (no QEMU)
  - No bind mounts -- all filesystem I/O stays on container's overlay2/ext4
**Success Criteria** (what must be TRUE):
  1. `npm run e2e` completes in under 30 seconds (down from ~3 minutes)
  2. e2e tests pass with identical assertions as the current host-based tests
  3. No network dependency during test execution (Verdaccio is localhost, repo is local path)
  4. Docker image rebuilds only when Nx version or repo ref changes (layer cache)
**Plans:** 2/2 plans complete

Plans:
- [x] 06-01-PLAN.md -- Dockerfile, testcontainers dependency, ProvidedContext types, global setup with testcontainers lifecycle
- [x] 06-02-PLAN.md -- Rewrite e2e spec to use container.exec(), update Vitest config, end-to-end verification

### Phase 7: v1.0 Tech Debt Cleanup
**Goal:** Close all accumulated tech debt from v1.0 milestone audit -- remove dead exports, add sync->status e2e test, fix planning documentation gaps
**Requirements**: None (tech debt, no new requirements)
**Depends on:** Phase 6
**Gap Closure:** Closes all tech_debt items from v1.0-MILESTONE-AUDIT.md
**Success Criteria** (what must be TRUE):
  1. Zero dead exports in production code (isGitUrl, getCurrentGraphReport removed)
  2. Unused networkName ProvidedContext key removed from e2e setup
  3. E2e test exercises full sync -> cache -> status-with-project-counts flow
  4. REQUIREMENTS.md traceability table includes all 9 SAFE-* requirement IDs
  5. SUMMARY frontmatter requirements_completed updated for SAFE-CASTS and SAFE-SIFER
**Plans:** 2 plans

Plans:
- [ ] 07-01-PLAN.md -- Remove dead exports (isGitUrl, getCurrentGraphReport), remove unused networkName, add sync->status e2e test
- [ ] 07-02-PLAN.md -- Verify REQUIREMENTS.md traceability and SUMMARY frontmatter documentation gaps
