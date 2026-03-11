# Roadmap: nx-openpolyrepo

## Overview

This roadmap delivers a working Nx plugin for synthetic monorepos in three phases. Phase 1 establishes the plugin skeleton and repo assembly pipeline -- cloning and updating external repos from nx.json configuration. Phase 2 delivers the core value: external repo projects visible in `nx graph` and `nx show projects` with proper namespacing and cached graph extraction. Phase 3 adds multi-repo git DX so users can manage all synced repos from a single command surface.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Plugin Foundation + Repo Assembly** - Plugin skeleton, git clone/pull, nx.json config with validation
- [ ] **Phase 2: Unified Project Graph** - External projects in nx graph with namespacing and cached extraction
- [ ] **Phase 3: Multi-Repo Git DX** - Combined status, bulk operations, per-repo output

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
**Plans**: 3 plans

Plans:
- [x] 02-01-PLAN.md -- Graph types, git utilities, config duplicate URL detection, sync dep install
- [ ] 02-02-PLAN.md -- Graph extraction pipeline (nx graph --print), two-layer cache, transformation (namespacing, tags, target rewriting)
- [ ] 02-03-PLAN.md -- Run executor, createNodesV2 extension for external projects, createDependencies for intra-repo edges

### Phase 3: Multi-Repo Git DX
**Goal**: Users can monitor and manage git state across all synced repos from a single command surface
**Depends on**: Phase 1
**Requirements**: GITX-01, GITX-02, GITX-03
**Success Criteria** (what must be TRUE):
  1. User can run a single command to see combined git status of all synced repos
  2. User can pull or fetch all synced repos with one command
  3. Git operations display clear per-repo output showing which repo succeeded and which failed
**Plans**: TBD

Plans:
- [ ] 03-01: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 -> 2 -> 3

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Plugin Foundation + Repo Assembly | 3/3 | Complete | 2026-03-10 |
| 2. Unified Project Graph | 1/3 | In Progress | - |
| 3. Multi-Repo Git DX | 0/0 | Not started | - |
