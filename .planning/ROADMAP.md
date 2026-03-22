# Roadmap: nx-openpolyrepo

## Milestones

- [x] **v1.0 MVP** -- Phases 1-7 (shipped 2026-03-16)
- [x] **v1.1 Cross-repo Dependencies** -- Phases 8-13 (shipped 2026-03-21)
- [ ] **v1.2 Static Edges and Proxy Caching** -- Phases 14-16

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

<details>
<summary>[x] v1.1 Cross-repo Dependencies (Phases 8-13) -- SHIPPED 2026-03-21</summary>

- [x] Phase 8: Schema Extension and Data Extraction (1/1 plan) -- completed 2026-03-17
- [x] Phase 9: Cross-repo Dependency Detection (2/2 plans) -- completed 2026-03-17
- [x] Phase 10: Integration and End-to-End Validation (3/3 plans) -- completed 2026-03-18
- [x] Phase 11: Full Nx Daemon Support (3/3 plans) -- completed 2026-03-21
- [x] Phase 12: Resolve cross-repo build cascade (2/2 plans) -- completed 2026-03-21
- [x] Phase 13: Verification and Tech Debt Cleanup (2/2 plans) -- completed 2026-03-21

</details>

### v1.2 Static Edges and Proxy Caching

- [x] **Phase 14: Temp Directory Rename** - Replace `.tmp` with `tmp` in child repo temp directories to align with Nx default `.gitignore` convention (completed 2026-03-22)
- [x] **Phase 15: Proxy Target Caching** - Enable host-level Nx caching for proxy targets using git-based runtime inputs, with daemon workaround and fallback guards (gap closure in progress) (completed 2026-03-22)
- [ ] **Phase 16: Static Dependency Edges** - Upgrade host-sourced auto-detected edges from implicit to static with sourceFile provenance; external-sourced and override edges stay implicit

## Phase Details

### Phase 14: Temp Directory Rename

**Goal**: Child repo temp directories follow Nx convention so synced repos need no manual `.gitignore` entries for plugin-created temp files
**Depends on**: Phase 13 (v1.1 complete)
**Requirements**: EXEC-01, EXEC-02
**Success Criteria** (what must be TRUE):

1. Running a proxy target creates a `tmp/` directory (not `.tmp/`) inside `.repos/<alias>/` for executor temp isolation
2. Graph extraction creates a `tmp/` directory (not `.tmp/`) inside `.repos/<alias>/` for extraction temp isolation
3. A synced Nx workspace using the default `create-nx-workspace` `.gitignore` (which includes `tmp`) does not need any additional gitignore entries for plugin temp directories
4. All existing unit tests pass with updated path assertions
   **Plans:** 1/1 plans complete

Plans:

- [ ] 14-01-PLAN.md -- Rename .tmp to tmp in production code and tests

### Phase 15: Proxy Target Caching

**Goal**: Proxy targets skip child Nx bootstrap when the child repo's git state is unchanged, eliminating 2-5s overhead per cached target invocation
**Depends on**: Phase 14
**Requirements**: PROXY-01, PROXY-02, PROXY-03, PROXY-04, PROXY-05
**Success Criteria** (what must be TRUE):

1. Proxy targets have `cache: true` and include a runtime input tied to the child repo's git state
2. Running the same proxy target twice without changing the child repo produces a cache hit on the second run (skips child Nx invocation)
3. After `polyrepo-sync` pulls new changes, the proxy target produces a cache miss (child Nx re-invoked)
4. A failed git command (repo not synced, corrupt `.git`) does not produce a constant hash that permanently serves stale cached results
5. Caching works correctly under `NX_DAEMON=true`, `NX_DAEMON=false`, and `NX_DAEMON` unset
   **Plans:** 4/4 plans complete

Plans:

- [x] 15-01-PLAN.md -- Proxy hash utility, git status helper, and createProxyTarget cache enablement
- [x] 15-02-PLAN.md -- preTasksExecution hook and conditional nx reset fallback
- [ ] 15-03-PLAN.md -- Fix preTasksExecution hook not firing (gap closure)
- [ ] 15-04-PLAN.md -- Include plugin version in graph disk cache key (gap closure)

### Phase 16: Static Dependency Edges

**Goal**: Host-sourced auto-detected edges carry sourceFile provenance so `nx affected` can trace which specific file change triggered a cross-repo dependency recomputation
**Depends on**: Phase 15
**Requirements**: DETECT-01, DETECT-02, DETECT-03, DETECT-04, DETECT-05
**Success Criteria** (what must be TRUE):

1. A host project declaring a dependency on an external repo's package produces a `DependencyType.static` edge with `sourceFile` pointing to the host project's package.json (e.g., `packages/my-app/package.json`)
2. An external project declaring a dependency on another project produces a `DependencyType.implicit` edge with no sourceFile (Nx fileMap constraint: `.repos/` files are gitignored)
3. Override edges remain `DependencyType.implicit` with no sourceFile
4. `nx graph` and `nx affected` both succeed without validation errors after the edge type migration
5. Existing unit, integration, and e2e test assertions are updated to verify edge types and sourceFile values per source location
   **Plans**: TBD

## Progress

| Phase                                     | Milestone | Plans Complete | Status      | Completed  |
| ----------------------------------------- | --------- | -------------- | ----------- | ---------- |
| 1. Plugin Foundation + Repo Assembly      | v1.0      | 3/3            | Complete    | 2026-03-10 |
| 2. Unified Project Graph                  | v1.0      | 4/4            | Complete    | 2026-03-12 |
| 3. Multi-Repo Git DX                      | v1.0      | 9/9            | Complete    | 2026-03-11 |
| 4. Code Cleanup                           | v1.0      | 1/1            | Complete    | 2026-03-12 |
| 5. Maximum Type Safety                    | v1.0      | 6/6            | Complete    | 2026-03-13 |
| 6. Add e2e Container                      | v1.0      | 3/3            | Complete    | 2026-03-16 |
| 7. v1.0 Tech Debt Cleanup                 | v1.0      | 2/2            | Complete    | 2026-03-16 |
| 8. Schema Extension and Data Extraction   | v1.1      | 1/1            | Complete    | 2026-03-17 |
| 9. Cross-repo Dependency Detection        | v1.1      | 2/2            | Complete    | 2026-03-17 |
| 10. Integration and End-to-End Validation | v1.1      | 3/3            | Complete    | 2026-03-18 |
| 11. Full Nx Daemon Support                | v1.1      | 3/3            | Complete    | 2026-03-21 |
| 12. Resolve cross-repo build cascade      | v1.1      | 2/2            | Complete    | 2026-03-21 |
| 13. Verification and Tech Debt Cleanup    | v1.1      | 2/2            | Complete    | 2026-03-21 |
| 14. Temp Directory Rename                 | v1.2      | 1/1            | Complete    | 2026-03-22 |
| 15. Proxy Target Caching                  | 4/4       | Complete       | 2026-03-22  | -          |
| 16. Static Dependency Edges               | v1.2      | 0/TBD          | Not started | -          |

---

_Full v1.0 details: [milestones/v1.0-ROADMAP.md](milestones/v1.0-ROADMAP.md)_
_Full v1.1 details: [milestones/v1.1-ROADMAP.md](milestones/v1.1-ROADMAP.md)_
_Full v1.2 details: [milestones/v1.2-ROADMAP.md](milestones/v1.2-ROADMAP.md)_
