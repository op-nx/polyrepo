# Roadmap: nx-openpolyrepo

## Milestones

- [x] **v1.0 MVP** -- Phases 1-7 (shipped 2026-03-16)
- [ ] **v1.1 Cross-repo Dependencies** -- Phases 8-10 (in progress)

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
- [ ] **Phase 9: Cross-repo Dependency Detection** - Pure detection function with auto-detection, overrides, negation, and cycle safety
- [ ] **Phase 10: Integration and End-to-End Validation** - Wire detection into createDependencies, verify nx graph and nx affected work cross-repo

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
- [ ] 08-01-PLAN.md -- Extend config schema, graph types, and transform with package name extraction and dependency list reading

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
- [ ] 09-01-PLAN.md -- Build lookup map and package.json dep-list detection (DETECT-01, DETECT-02, DETECT-03)
- [ ] 09-02-PLAN.md -- Tsconfig path alias expansion, override emission, negation, and validation (DETECT-04, OVRD-01, OVRD-02, OVRD-03)

### Phase 10: Integration and End-to-End Validation
**Goal**: Cross-repo dependency edges flow through the full plugin pipeline and are observable in standard Nx CLI commands
**Depends on**: Phase 9
**Requirements**: DETECT-06, DETECT-07
**Success Criteria** (what must be TRUE):
  1. Running `nx graph` on a host workspace with synced repos shows cross-repo dependency edges between projects from different repos
  2. After modifying a file in repo A, `nx affected` lists dependent projects in repo B that declare a package.json dependency on repo A's package
  3. E2E tests (testcontainers) validate auto-detected edges, explicit override edges, and negation suppression against real Nx CLI output
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 8 -> 9 -> 10

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
| 9. Cross-repo Dependency Detection | v1.1 | 0/2 | Not started | - |
| 10. Integration and End-to-End Validation | v1.1 | 0/0 | Not started | - |

---
*Full v1.0 details: [milestones/v1.0-ROADMAP.md](milestones/v1.0-ROADMAP.md)*
