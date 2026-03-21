# Roadmap: nx-openpolyrepo

## Milestones

- [x] **v1.0 MVP** -- Phases 1-7 (shipped 2026-03-16)
- [ ] **v1.1 Cross-repo Dependencies** -- Phases 8-13 (audit: gaps_found)

## Phases

<details>
<summary>[x] v1.0 MVP (Phases 1-7) -- SHIPPED 2026-03-16</summary>

- [x] Phase 1: Plugin Foundation + Repo Assembly (3/3 plans) -- completed 2026-03-10
- [x] Phase 2: Unified Project Graph (4/4 plans) -- completed 2026-03-12
- [x] Phase 3: Multi-Repo Git DX (9/9 plans) -- completed 2026-03-11
- [x] Phase 4: Code Cleanup (1/1 plan) -- completed 2026-03-12
- [x] Phase 5: Maximum Type Safety (6/6 plans) -- completed 2026-03-13
- [x] Phase 6: Add e2e Container (3/3 plans) -- completed 2026-03-16
- [x] Phase 7: v1.0 Tech Debt Cleanup (2/2 plans) -- completed 2026-03-16

</details>

### v1.1 Cross-repo Dependencies

- [x] **Phase 8: Schema Extension and Data Extraction** - Config schema for overrides + package name/dependency extraction pipeline (completed 2026-03-17)
- [x] **Phase 9: Cross-repo Dependency Detection** - Pure detection function with auto-detection, overrides, negation, and cycle safety (completed 2026-03-17)
- [x] **Phase 10: Integration and End-to-End Validation** - Wire detection into createDependencies, verify nx graph and nx affected work cross-repo (completed 2026-03-18)

## Phase Details

### Phase 8: Schema Extension and Data Extraction
**Goal**: Plugin config accepts dependency overrides and the extraction pipeline produces the enriched data (package names, dependency lists) that detection consumes
**Depends on**: Phase 7 (v1.0 complete)
**Requirements**: DETECT-05
**Success Criteria** (what must be TRUE):
  1. A v1.0 config (repos-only, no overrides) parses successfully through the v1.1 schema with no validation errors
  2. User can add an optional `implicitDependencies` record to plugin config (keyed by source project name or minimatch glob, values are arrays of target project names/globs), validated by Zod at load time
  3. After graph extraction, every external project in the graph report has its npm package name resolved from `metadata.js.packageName` and stored on its `TransformedNode`
  4. After graph extraction, every external project's package.json dependency fields (dependencies, devDependencies, peerDependencies) are read from disk and stored on its `TransformedNode`, cached by the existing two-layer cache
**Plans**: 1 plan
Plans:
- [x] 08-01-PLAN.md -- Extend config schema, graph types, and transform with package name extraction and dependency list reading

### Phase 9: Cross-repo Dependency Detection
**Goal**: A pure function correctly identifies cross-repo dependency edges from package.json declarations, applies user overrides and negations, and handles edge cases (cycles, scoped packages, namespace mismatches)
**Depends on**: Phase 8
**Requirements**: DETECT-01, DETECT-02, DETECT-03, DETECT-04, OVRD-01, OVRD-02, OVRD-03
**Success Criteria** (what must be TRUE):
  1. Given a project declaring a `dependencies`/`devDependencies`/`peerDependencies` entry matching an npm package name published by a project in another synced repo, the detection function emits a `DependencyType.static` edge with a `sourceFile` pointing to the declaring package.json
  2. Given a project whose tsconfig `paths` mapping references a path alias published by a project in another synced repo, the detection function emits a cross-repo edge
  3. Given explicit dependency overrides in plugin config, the detection function emits those edges even when no package.json or tsconfig relationship exists
  4. Given a negation override for an auto-detected edge, the detection function suppresses that edge from the output
  5. Plugin fails at load time with a clear error when an override references a project name not present in the merged graph
**Plans**: 2 plans
Plans:
- [x] 09-01-PLAN.md -- Build lookup map and package.json dep-list detection (DETECT-01, DETECT-02, DETECT-03)
- [x] 09-02-PLAN.md -- Tsconfig path alias expansion, override emission, negation, and validation (DETECT-04, OVRD-01, OVRD-02, OVRD-03)

### Phase 10: Integration and End-to-End Validation
**Goal**: Cross-repo dependency edges flow through the full plugin pipeline and are observable in standard Nx CLI commands
**Depends on**: Phase 9
**Requirements**: DETECT-06, DETECT-07
**Success Criteria** (what must be TRUE):
  1. Running `nx graph` on a host workspace with synced repos shows cross-repo dependency edges between projects from different repos
  2. After modifying a file in repo A, `nx affected` lists dependent projects in repo B that declare a package.json dependency on repo A's package
  3. E2E tests (testcontainers) validate auto-detected edges, explicit override edges, and negation suppression against real Nx CLI output
**Plans**: 3 plans
Plans:
- [x] 10-01-PLAN.md -- Wire detectCrossRepoDependencies into createDependencies, add integration tests, document DETECT-07 deferral
- [x] 10-02-PLAN.md -- E2e tests for cross-repo auto-detection, overrides, and negation suppression
- [x] 10-03-PLAN.md -- Gap closure: fix fileMap guard dropping cross-repo edges, restore auto-detect and negation e2e tests

### Phase 11: Full Nx Daemon Support
**Goal:** Plugin works seamlessly with NX_DAEMON=true (default), NX_DAEMON=false, and unset via per-repo cache architecture, sync pre-caching, error recovery with exponential backoff, and e2e verification under both daemon modes
**Depends on:** Phase 10
**Requirements**: DAEMON-01, DAEMON-02, DAEMON-03, DAEMON-04, DAEMON-05, DAEMON-06, DAEMON-07, DAEMON-08, DAEMON-09, DAEMON-10, DAEMON-11
**Success Criteria** (what must be TRUE):
  1. Global in-memory hash gate returns instantly when no repo has changed
  2. Per-repo disk cache at `.repos/<alias>/.polyrepo-graph-cache.json` restores individual repo data on cold start
  3. Changed repo re-extracts while unchanged repos remain cached (selective invalidation)
  4. After polyrepo-sync, per-repo disk cache is warm (first daemon invocation reads from disk, not extraction)
  5. Extraction failure for one repo does not block others; exponential backoff prevents repeated extraction penalties
  6. E2e tests pass under both NX_DAEMON=true and NX_DAEMON=false
**Plans**: 3 plans
Plans:
- [x] 11-01-PLAN.md -- Per-repo cache refactor with three-layer invalidation, exponential backoff, and actionable warnings
- [x] 11-02-PLAN.md -- Pre-caching graph data during polyrepo-sync after install
- [x] 11-03-PLAN.md -- E2e daemon mode verification (Dockerfile, container env forwarding, --skip-nx-cache test)

### Phase 13: Verification and Tech Debt Cleanup
**Goal:** Close all audit gaps: generate missing VERIFICATION.md for Phases 10 and 11, fix stale traceability, and resolve minor code/test debt
**Depends on:** Phase 12
**Requirements**: DETECT-06, DETECT-07, DAEMON-01, DAEMON-02, DAEMON-03, DAEMON-04, DAEMON-05, DAEMON-06, DAEMON-07, DAEMON-08, DAEMON-09, DAEMON-10, DAEMON-11
**Gap Closure:** Closes gaps from v1.1 audit
**Success Criteria** (what must be TRUE):
  1. Phase 10 has a VERIFICATION.md with passed or gaps_found status
  2. Phase 11 has a VERIFICATION.md with passed or gaps_found status
  3. REQUIREMENTS.md traceability table shows Phase 12 requirements as "Complete" (not "Planned")
  4. detect.ts:416 uses `String()` instead of `as string` cast
  5. sync executor spec asserts rmSync calls for stale cache clearing
**Plans**: 2 plans
Plans:
- [ ] 13-01-PLAN.md -- Generate missing VERIFICATION.md for Phases 10 and 11
- [ ] 13-02-PLAN.md -- Fix detect.ts `as string` cast and add rmSync test assertions

## Progress

**Execution Order:**
Phases execute in numeric order: 8 -> 9 -> 10 -> 11 -> 12 -> 13

| Phase | Milestone | Plans Complete | Status | Completed |
|-------|-----------|----------------|--------|-----------|
| 1. Plugin Foundation + Repo Assembly | v1.0 | 3/3 | Complete | 2026-03-10 |
| 2. Unified Project Graph | v1.0 | 4/4 | Complete | 2026-03-12 |
| 3. Multi-Repo Git DX | v1.0 | 9/9 | Complete | 2026-03-11 |
| 4. Code Cleanup | v1.0 | 1/1 | Complete | 2026-03-12 |
| 5. Maximum Type Safety | v1.0 | 6/6 | Complete | 2026-03-13 |
| 6. Add e2e Container | v1.0 | 3/3 | Complete | 2026-03-16 |
| 7. v1.0 Tech Debt Cleanup | v1.0 | 2/2 | Complete | 2026-03-16 |
| 8. Schema Extension and Data Extraction | v1.1 | 1/1 | Complete | 2026-03-17 |
| 9. Cross-repo Dependency Detection | v1.1 | 2/2 | Complete | 2026-03-17 |
| 10. Integration and End-to-End Validation | v1.1 | 3/3 | Complete | 2026-03-18 |
| 11. Full Nx Daemon Support | v1.1 | 3/3 | Complete | 2026-03-21 |
| 12. Resolve cross-repo build cascade | v1.1 | 2/2 | Complete | 2026-03-21 |
| 13. Verification and Tech Debt Cleanup | 1/2 | In Progress|  | - |

### Phase 12: Resolve the cross-repo build cascade issue when syncing external nrwl/nx repo on Windows
**Goal:** Host targetDefaults no longer leak into external project proxy targets, and nx/devkit:build succeeds via proxy executor on Windows, so nx test @op-nx/polyrepo works without --exclude-task-dependencies
**Requirements**: TDEF-01, TDEF-02, TDEF-03, BUILD-01, BUILD-02
**Depends on:** Phase 11
**Success Criteria** (what must be TRUE):
  1. Proxy targets with dependsOn in the external repo's graph output preserve that dependsOn (with namespaced project references)
  2. Proxy targets without dependsOn get explicit empty array (blocks host targetDefaults merge)
  3. Proxy executor passes NX_DAEMON=false and NX_WORKSPACE_DATA_DIRECTORY to child processes
  4. `nx test @op-nx/polyrepo` succeeds without `--exclude-task-dependencies`
**Plans**: 2 plans
Plans:
- [x] 12-01-PLAN.md -- Preserve dependsOn in proxy targets and add env isolation to proxy executor
- [x] 12-02-PLAN.md -- Verify end-to-end fix and clean up --exclude-task-dependencies workaround

---
*Full v1.0 details: [milestones/v1.0-ROADMAP.md](milestones/v1.0-ROADMAP.md)*
