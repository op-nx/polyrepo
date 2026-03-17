# Pitfalls Research

**Domain:** Cross-repo dependency detection and manual overrides for Nx polyrepo plugin (v1.1)
**Researched:** 2026-03-17
**Confidence:** HIGH (verified against Nx 22.x type definitions in node_modules and existing plugin source)

## Critical Pitfalls

### Pitfall 1: Using DependencyType.implicit for package.json-derived dependencies

**What goes wrong:**
The existing `createDependencies` emits all intra-repo edges as `DependencyType.implicit`. If cross-repo package.json dependencies are also emitted as implicit, Nx recomputes every dependency on every graph construction because implicit dependencies have no file association. This makes `nx affected` slow and defeats incremental analysis. The Nx type `ImplicitDependency` has no `sourceFile` field at all -- it only has `source`, `target`, and `type`.

**Why it happens:**
The v1.0 code uses `DependencyType.implicit` for intra-repo edges (line 127 of `index.ts`). The natural tendency is to follow the same pattern for cross-repo edges. But package.json-derived edges CAN be associated with a file, and should be.

**How to avoid:**
Use `DependencyType.static` with a `sourceFile` pointing to the package.json that declares the dependency. The `StaticDependency` type requires `source`, `target`, `type: DependencyType.static`, and a `sourceFile` (MUST be present unless source is a `ProjectGraphExternalNode`). Since our namespaced projects are regular project nodes, always provide `sourceFile`. Example: `sourceFile: '.repos/frontend/libs/shared/package.json'`. Verified in `node_modules/nx/src/project-graph/project-graph-builder.d.ts`.

**Warning signs:**
- `nx affected` always reports all cross-repo dependents as affected even when nothing changed
- `createDependencies` takes noticeably longer than expected on repeat invocations
- No file-level caching benefit visible in profiling

**Phase to address:**
Phase 1 (auto-detection) -- foundational design decision that affects all subsequent work.

---

### Pitfall 2: Namespace mismatch between npm package names and Nx project names

**What goes wrong:**
A project in repo `backend` might have npm package name `@myorg/shared-utils` in its package.json but be registered in the host Nx graph as `backend/shared-utils` (namespaced by repo alias). The Nx project name in the child repo might be yet another value, like `shared-utils`. If the detection logic matches package.json dependency names against namespaced Nx project names, it will never find a match. If it matches against un-namespaced names, it may produce ambiguous matches when two repos have identically-named packages.

**Why it happens:**
Three name spaces are in play: (1) npm package names from package.json `name` field, (2) Nx project names from the child repo's project.json/project graph, and (3) namespaced project names in the host graph (`alias/projectName`). The current `transformGraphForRepo` in `transform.ts` does not store the npm package name anywhere in the `TransformedNode`.

**How to avoid:**
Build an explicit lookup table during graph transformation. For each external project, read its package.json `name` field and store it. During dependency detection, match package.json dependency names against this lookup table, then emit edges using the namespaced Nx project names. The lookup must handle: (a) projects without a package.json, (b) projects whose npm name differs from the Nx project name, (c) scoped packages (`@scope/name`), (d) multiple projects publishing the same npm package name across repos (emit warning, pick none).

**Warning signs:**
- Zero cross-repo dependencies detected despite obvious package.json references
- Dependencies detected in one direction but not the other
- Duplicate match warnings in logs

**Phase to address:**
Phase 1 (auto-detection) -- the lookup table design must be settled before any matching logic is written.

---

### Pitfall 3: Reading package.json from wrong scope (host root, child repo root, or project root)

**What goes wrong:**
Package.json files exist at multiple levels: the host workspace root, the child repo root (`.repos/alias/package.json`), and individual project roots within child repos (`.repos/alias/libs/foo/package.json`). Reading the wrong one produces incorrect dependency edges. The host root package.json lists the host's own toolchain deps (Nx, TypeScript). The child repo root package.json lists the repo's toolchain deps. Only project-level package.json files declare project-to-project dependencies.

**Why it happens:**
The `CreateDependenciesContext` provides `context.projects` with project roots relative to the host workspace. It is tempting to glob for all package.json files, which captures the wrong ones. Additionally, `context.fileMap` and `context.filesToProcess` may not include files under `.repos/` since that directory is gitignored -- the host workspace file tracking does not cover gitignored paths.

**How to avoid:**
For each external project (identifiable by `polyrepo:external` tag or `.repos/` root prefix), resolve package.json as `join(workspaceRoot, project.root, 'package.json')`. Read from disk directly, not from `context.fileMap`. Skip projects without a package.json. Never read the child repo root package.json as a project dependency source. Never read the host root package.json.

**Warning signs:**
- Spurious dependency edges to npm toolchain packages like `typescript`, `nx`, or `eslint`
- Every external project appears to depend on every other
- Dependencies appear from host workspace projects to external projects

**Phase to address:**
Phase 1 (auto-detection) -- file resolution logic is core to the detection algorithm.

---

### Pitfall 4: Circular cross-repo dependencies crashing task orchestration

**What goes wrong:**
If repo A's project depends on repo B's project via package.json, and repo B's project depends back on repo A's project, Nx may enter an infinite loop during task graph construction or fail with an opaque error. Nx GitHub issue [#7546](https://github.com/nrwl/nx/issues/7546) confirms that **circular dependencies are not always caught for nodes added to the graph via plugins**. The built-in cycle detection runs on edges from Nx's own analysis, not from plugin-contributed edges.

**Why it happens:**
Intra-repo circular deps are caught by Nx's built-in JS/TS analysis. Plugin-added nodes use a different code path for cycle detection. If the polyrepo plugin introduces a cycle, Nx may not flag it, and `nx run-many` or task pipelines will hang or error out with "maximum call stack" or similar.

**How to avoid:**
Validate the dependency graph for cycles before returning edges from `createDependencies`. Build a topological sort or DFS cycle detector over the cross-repo edges. If a cycle is detected, log a clear warning naming the projects involved and omit the cycle-creating edge(s). Do not silently swallow cycles -- the warning must be actionable.

**Warning signs:**
- `nx build` hangs indefinitely when cross-repo deps exist
- `nx graph` shows bidirectional arrows between repos
- Task orchestration errors mentioning "maximum call stack" or "cycle"

**Phase to address:**
Phase 1 (auto-detection) -- cycle detection must be in place before any edges are emitted, because the first auto-detected cycle could break the entire workspace.

---

### Pitfall 5: Manual overrides conflicting with or duplicating auto-detected edges

**What goes wrong:**
When a user configures an explicit dependency override (e.g., `frontend/app -> backend/api`) and auto-detection also discovers the same edge from package.json, the system has duplicate edges. While Nx deduplicates internally, the real problem is when an override is meant to SUPPRESS a false-positive auto-detected edge. Without clear precedence rules and negative override support, the system is unpredictable.

**Why it happens:**
Auto-detection and manual overrides are independent code paths. Without explicit precedence logic, they both emit edges into the same `RawProjectGraphDependency[]` array. Users expect overrides to have final say, but without negative overrides (`dependsOn: false`), there is no way to remove an incorrect auto-detected edge.

**How to avoid:**
Define clear precedence: manual overrides always win. Collect auto-detected edges first, then apply overrides as a patch layer. Overrides can: (a) add edges that auto-detection missed, (b) suppress edges that auto-detection found incorrectly (negative overrides). Deduplicate by `source+target` key before returning. Support `false` as an override value to mean "remove this edge."

**Warning signs:**
- Users report that removing a package.json dependency does not remove the graph edge
- Users cannot suppress a false-positive auto-detected dependency
- Confusion about which edges are auto-detected vs manually configured

**Phase to address:**
Phase 2 (manual overrides) -- but auto-detection must be designed with override integration points from the start.

---

### Pitfall 6: Cache invalidation not accounting for package.json changes

**What goes wrong:**
The existing two-layer cache in `cache.ts` computes a hash from `pluginOptionsHash + HEAD SHA + dirty files` per repo. If cross-repo dependency detection is folded INTO the cached graph report, and a package.json change is committed (HEAD SHA changes), the cache invalidates correctly. But if package.json is modified but not committed (dirty), the `getDirtyFiles()` output changes and the cache also invalidates. The REAL risk is if cross-repo detection is added as a separate cached layer with its own hash that does NOT include package.json content.

**Why it happens:**
The existing cache works well for graph extraction (nodes + intra-repo edges). Adding a new data source (package.json content for cross-repo edges) requires either folding it into the existing hash or managing a separate cache.

**How to avoid:**
Run cross-repo dependency detection inside `createDependencies`, NOT as part of the cached extraction pipeline. The detection reads package.json files at graph construction time, using the already-cached project graph report for the node/lookup data. This way: (a) the existing cache handles node extraction (invalidated by HEAD SHA + dirty files, which covers package.json changes), (b) dependency detection runs fresh against current package.json files each time `createDependencies` is called, (c) no additional cache layer needed for the MVP.

**Warning signs:**
- After adding a cross-repo dependency to package.json, `nx graph` does not show the edge until `nx reset`
- Removing a dependency still shows the edge
- `nx affected` includes/excludes wrong projects after package.json changes

**Phase to address:**
Phase 1 (auto-detection) -- cache integration must be decided at the architecture level.

---

### Pitfall 7: Zod schema breaks backward compatibility when adding override config fields

**What goes wrong:**
Adding a new `dependencies` or `overrides` field to `polyrepoConfigSchema` with required validation breaks existing users who upgrade to v1.1 without updating their nx.json config. Their repos-only config fails Zod validation at plugin load time (`validateConfig`), and ALL Nx commands break immediately with a Zod error.

**Why it happens:**
The existing schema uses `.strict()` on repo entry objects. If the top-level config schema gains new required fields, or if `.strict()` prevents unknown keys, any nx.json that doesn't include the new fields fails validation.

**How to avoid:**
Make all new config fields optional with sensible defaults. Use `.optional()` for the overrides field -- absence means no overrides. Write a backward compatibility test: parse a v1.0-era config shape (only `repos`, no other fields) through the v1.1 schema and assert it succeeds. The existing `schema.spec.ts` tests should serve as the baseline.

**Warning signs:**
- Existing e2e tests fail after schema changes (good -- tests catch it)
- Users report "plugin crashed" errors immediately after upgrading
- Zod validation errors mentioning "unrecognized key" or "required"

**Phase to address:**
Phase 2 (manual overrides) -- schema extension is the first thing to implement, with backward compat verified immediately.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Keep all edges as `DependencyType.implicit` | No sourceFile resolution needed | No incremental caching by Nx, recomputed every invocation | Never -- performance compounds with scale |
| Hardcode npm package name = Nx project name | Skip lookup table | Breaks for scoped packages, custom project names -- both very common | Never -- too fragile for real-world repos |
| Skip negative overrides (only additive) | Simpler override schema and logic | Users cannot suppress false-positive auto-detected edges | MVP only -- plan the data model to support it from day one |
| Read package.json synchronously in a loop | Simpler code flow | Blocks event loop during graph construction for workspaces with many projects | Never -- async patterns already established in codebase |
| Store override config in a separate file | Avoids nx.json complexity | Users manage two config files, easy to forget | Never -- nx.json plugin options is the established pattern |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| `context.projects` | Assuming all projects are external | Filter by `polyrepo:external` tag or `.repos/` root prefix before scanning package.json |
| `context.fileMap` | Using fileMap to find package.json files in synced repos | fileMap may exclude gitignored paths (`.repos/`); read from disk using resolved project root paths |
| `validateDependency` | Not using it during development | Call `validateDependency(dep, context)` in debug/development builds to catch malformed edges early |
| Existing intra-repo edge loop | Mixing intra-repo and cross-repo edges in the same code path | Keep the existing intra-repo edge loop (lines 120-131 in `index.ts`) separate from cross-repo detection; they have different data sources |
| Two-layer cache | Adding cross-repo dependency data to the cached `PolyrepoGraphReport` | Compute cross-repo deps in `createDependencies` outside the cache; the report provides node data, detection runs live |
| `context.projects[dep.source]` guard | Assuming cross-repo edge targets always exist in `context.projects` | Target project might be in an unsynced repo; guard both source and target existence (already done for intra-repo edges) |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Reading every package.json on every `createDependencies` call | Graph construction adds 100-300ms per repo | Cache the npm-name-to-project lookup table in module-level state, invalidate with the existing hash | 10+ repos with 50+ projects each |
| N^2 matching: for each project, scan all other projects' deps | Quadratic time complexity visible as graph size grows | Build `Map<npmName, namespacedProjectName>` first, then single-pass each package.json against the map | 500+ projects total |
| Not deduplicating edges before returning | Nx handles it but wastes allocation and merge time | Use `Map<string, RawProjectGraphDependency>` keyed by `${source}\0${target}` | 1000+ dependency edges |
| Parsing package.json with `JSON.parse` without caching | Re-reading and re-parsing the same file across multiple detection passes | Use `readJsonFile` from `@nx/devkit` (has its own caching) or cache parsed results in a `Map` | 200+ package.json files |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Silent skip when package.json has no `name` field | User sees no cross-repo deps, doesn't know why | Log verbose warning: "Project X has no package.json name field, skipping cross-repo dependency detection" |
| No way to see which deps are auto-detected vs manual | Confusing when debugging unexpected `nx affected` results | Log at verbose level distinguishing auto vs override edges; consider metadata on edges |
| Override typo in project name silently ignored | User thinks override is active but it does nothing | Validate override source/target against known project names at config validation time; warn on unknown names |
| Cross-repo dep detection runs on unsynced repos | Error or empty results for repos not yet cloned | Skip unsynced repos gracefully (already done for extraction); log that deps for unsynced repos are unavailable |
| No explanation of WHY a cross-repo edge exists | User sees edge in `nx graph` but doesn't understand the source | In verbose mode, log "Cross-repo dependency: frontend/app -> backend/api (via package.json `@myorg/api` in .repos/frontend/apps/app/package.json)" |

## "Looks Done But Isn't" Checklist

- [ ] **Auto-detection:** Often missing handling for projects without package.json -- verify detection skips gracefully with a unit test
- [ ] **Auto-detection:** Often missing scoped npm package names (`@scope/name`) -- verify lookup handles scopes correctly
- [ ] **Auto-detection:** Often missing devDependencies vs dependencies distinction -- verify only `dependencies` (and optionally `peerDependencies`) are scanned, not `devDependencies`
- [ ] **Auto-detection:** Often missing the case where an npm dependency name matches an external project but is actually a public npm package -- verify disambiguation logic exists
- [ ] **Manual overrides:** Often missing validation of project names in overrides -- verify typos produce warnings at config load time
- [ ] **Manual overrides:** Often missing backward compatibility -- verify a v1.0 config (repos only, no overrides) still parses successfully through v1.1 schema
- [ ] **Cache:** Often missing cache invalidation for new data sources -- verify that adding a dep to package.json and running `nx graph` shows the new edge without `nx reset`
- [ ] **Graph:** Often missing cycle detection for plugin-added nodes -- verify that a circular cross-repo dep logs a warning and does not hang Nx
- [ ] **Edge type:** Often using implicit when static is correct -- verify emitted edges have `type: DependencyType.static` and `sourceFile` set

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Wrong DependencyType (implicit instead of static) | LOW | Change type enum, add sourceFile resolution; no data migration needed |
| Namespace mismatch (no lookup table) | MEDIUM | Retrofit lookup table into transform pipeline; add `npmName` to `TransformedNode` or build separate index; update tests |
| Wrong package.json scope | LOW | Fix file path resolution; no architectural change |
| Circular dependency hangs | LOW | Add cycle detector as a pure function; wrap `createDependencies` output |
| Cache serving stale deps | LOW | Move detection to `createDependencies` outside cache; add integration test |
| Schema breaks backward compat | HIGH if released | Patch release with `.optional()` on new fields; cannot un-break already-published versions |
| Override/auto-detect conflict | MEDIUM | Add dedup logic and precedence rules; requires data flow redesign if not planned upfront |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| DependencyType.implicit overuse | Phase 1 (auto-detection) | Unit test: emitted deps have `type: DependencyType.static` and valid `sourceFile` |
| Namespace mismatch | Phase 1 (auto-detection) | Unit test: scoped npm name `@org/foo` in repo `backend` resolves to `backend/foo-project` |
| Wrong package.json scope | Phase 1 (auto-detection) | Unit test: host root and child repo root package.json deps are NOT included in cross-repo edges |
| Circular dependency crash | Phase 1 (auto-detection) | Unit test: circular dep pair emits warning and omits cycle-creating edge |
| Cache staleness | Phase 1 (auto-detection) | Integration test: add dep to package.json, verify `nx graph` shows edge without `nx reset` |
| Override/auto-detect conflict | Phase 2 (manual overrides) | Unit test: manual override for same source+target replaces auto-detected edge |
| Schema backward compat | Phase 2 (manual overrides) | Unit test: v1.0 config shape (repos only) parses through v1.1 schema successfully |

## Sources

- [Extending the Project Graph | Nx](https://nx.dev/docs/extending-nx/project-graph-plugins) -- authoritative `createDependencies` API reference (HIGH confidence)
- [DependencyType | Nx](https://nx.dev/nx-api/devkit/documents/DependencyType) -- enum values and semantics (HIGH confidence)
- [StaticDependency | Nx](https://nx.dev/docs/reference/devkit/StaticDependency) -- sourceFile requirement (HIGH confidence)
- [Circular dependencies not caught for plugin nodes - nrwl/nx#7546](https://github.com/nrwl/nx/issues/7546) -- confirms cycle detection gap for plugin-contributed edges (HIGH confidence)
- [All projects affected too often - nrwl/nx Discussion #5580](https://github.com/nrwl/nx/discussions/5580) -- implicit dep recomputation cost and `projectsAffectedByDependencyUpdates` (HIGH confidence)
- [Implicit Dependencies Management with Nx](https://dev.to/this-is-learning/implicit-dependencies-management-with-nx-a-practical-guide-through-real-world-case-studies-59kd) -- practical guide on dependency types (MEDIUM confidence)
- `node_modules/nx/src/project-graph/project-graph-builder.d.ts` -- verified `RawProjectGraphDependency = ImplicitDependency | StaticDependency | DynamicDependency`, `StaticDependency.sourceFile` is required for non-external-nodes (HIGH confidence, primary source)
- `packages/op-nx-polyrepo/src/index.ts` -- existing `createDependencies` uses `DependencyType.implicit` at line 127, guards with `context.projects[dep.source]` (HIGH confidence, codebase)
- `packages/op-nx-polyrepo/src/lib/graph/transform.ts` -- `TransformedNode` has no npm package name field currently (HIGH confidence, codebase)
- `packages/op-nx-polyrepo/src/lib/config/schema.ts` -- `polyrepoConfigSchema` uses `.strict()` on repo entries (HIGH confidence, codebase)
- `packages/op-nx-polyrepo/src/lib/graph/cache.ts` -- two-layer cache hashes `optionsHash + HEAD SHA + dirty files` (HIGH confidence, codebase)

---
*Pitfalls research for: cross-repo dependency detection and manual overrides in Nx polyrepo plugin (v1.1)*
*Researched: 2026-03-17*
