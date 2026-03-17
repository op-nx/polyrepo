# Project Research Summary

**Project:** @op-nx/polyrepo v1.1 — Cross-repo Dependency Detection and Manual Overrides
**Domain:** Nx plugin — synthetic monorepo project graph extension
**Researched:** 2026-03-17
**Confidence:** HIGH

## Executive Summary

The v1.1 milestone adds cross-repo dependency edges to the `@op-nx/polyrepo` Nx plugin. The v1.0 plugin already merges project graphs from multiple external repos into a unified host workspace, but the `createDependencies` hook currently emits only intra-repo edges. If repo A's project depends on a package published by repo B, that edge is invisible — meaning `nx affected` cannot trace changes across repo boundaries, which undermines the core value proposition of the synthetic monorepo. v1.1 closes this gap with two complementary features: automatic detection from package.json declarations, and explicit dependency overrides in nx.json config.

The recommended approach extends the existing architecture minimally. All IO (reading project package.json files for both package names and dependency lists) is folded into the existing `populateGraphReport` extraction pipeline, so the already-battle-tested two-layer cache in `cache.ts` handles invalidation automatically. A new pure function, `detectCrossRepoDependencies`, receives the enriched graph report and config, builds a package-name-to-project lookup map, and emits `RawProjectGraphDependency` edges. This pure-function design is trivially testable with the project's established SIFERS pattern. No new npm dependencies are required — `@nx/devkit`, `zod`, and Node.js built-ins cover all requirements.

The critical risk is using the wrong `DependencyType`. Cross-repo edges derived from package.json files can and should be emitted as `DependencyType.static` with a `sourceFile` pointing to the declaring package.json — not `DependencyType.implicit`. Using `implicit` defeats Nx's file-level caching and causes every cross-repo dependent to appear as affected on every invocation. A secondary risk is the namespace mismatch between npm package names, Nx project names, and the plugin's namespaced project names (`alias/projectName`). The detection logic must build an explicit reverse-lookup map (npm name → namespaced project) and never assume these three name spaces align.

## Key Findings

### Recommended Stack

No new dependencies are required for v1.1. The entire feature set is implementable with the existing stack: `@nx/devkit` already exports `DependencyType` and `RawProjectGraphDependency`; `zod` schema extension is additive with `.optional()`; and Node.js built-ins `node:fs` and `node:path` handle package.json reads. The temptation to add `read-pkg`, `semver`, `glob`, or `dependency-graph` npm packages should be resisted — each is unnecessary given the established codebase patterns.

**Core technologies:**
- `@nx/devkit ^22.5.4`: Plugin API (`CreateDependencies`, `DependencyType`, `RawProjectGraphDependency`) — all required types stable since Nx 20, no version bump needed
- `zod ^4.0.0`: Config schema validation — additive `.optional()` extension covers new override config field without breaking existing consumers
- `node:fs` / `node:path` (built-in): package.json reading — follows existing project pattern of `JSON.parse(readFileSync(...))` + Zod parse

### Expected Features

**Must have (table stakes):**
- Auto-detect cross-repo deps from `package.json` `dependencies` and `devDependencies` — users assume this works by analogy with every other monorepo tool (Lerna, Turborepo, Nx itself)
- Namespaced resolution: map npm package names to `alias/projectName` host graph names — prerequisite for correct edge emission
- Explicit `dependencyOverrides` in nx.json config — covers non-npm relationships (protobuf, OpenAPI, shared infra) that package.json cannot express
- Cross-repo edges visible in `nx graph` and respected by `nx affected` — the observable outcomes that define the feature's success

**Should have (competitive):**
- Dependency negation (`negate: true` on overrides) — allows users to suppress false-positive auto-detected edges
- `peerDependencies` detection — catches plugin-host patterns missed by `dependencies`/`devDependencies`
- Diagnostic warnings for unresolved package names and override typos — dramatically reduces debugging friction

**Defer (v2+):**
- Wildcard/glob overrides (`repoA/*` → `repoB/shared-core`) — useful but adds `minimatch` complexity; exact names sufficient for launch
- Dependency edge type control (let users specify `static`/`dynamic`/`implicit` per override) — default `static` covers all real cases
- TypeScript import analysis across repos — enormous complexity for marginal gain over package.json detection
- Lock file analysis — package manager-specific, fragile, unnecessary for graph edges
- Version conflict detection across repos — belongs to a future conformance milestone

### Architecture Approach

v1.1 extends the existing five-component pipeline (Config/Validate → Extract → Transform → Cache → `createDependencies`) with targeted additions to four existing components and one new file. Package name and dependency list extraction is added to `extract.ts` as a post-extraction filesystem read. The `TransformedNode` type gains a `packageName` field and `PolyrepoGraphReport` gains `packageNames` and `packageDependencies` maps per repo. These enriched data are cached with the rest of the graph report. A new pure function in `detect-cross-deps.ts` handles the matching and override merging. The `createDependencies` function in `index.ts` calls this function alongside the existing intra-repo edge loop. `cache.ts` requires no changes.

**Major components:**
1. `schema.ts` (modify) — adds optional `dependencyOverrides: [{ source, target }]` field to `polyrepoConfigSchema`
2. `extract.ts` (modify) — adds `readPackageNames()` and `readPackageDependencies()` post-extraction reads per project
3. `types.ts` (modify) — adds `packageName` to `TransformedNode`, `packageNames` and `packageDependencies` to `PolyrepoGraphReport`
4. `detect-cross-deps.ts` (new) — pure function: builds lookup map, matches cross-repo deps, merges overrides, returns `RawProjectGraphDependency[]`
5. `index.ts` (modify) — wires `detectCrossRepoDependencies` into `createDependencies` after existing intra-repo loop

### Critical Pitfalls

1. **Using `DependencyType.implicit` for package.json edges** — use `DependencyType.static` with a `sourceFile` pointing to the declaring package.json instead; `implicit` has no file association, defeats Nx's incremental caching, and causes all cross-repo dependents to always be marked affected. `StaticDependency.sourceFile` is required for non-external project nodes (verified in `node_modules/nx/src/project-graph/project-graph-builder.d.ts`).

2. **Namespace mismatch between npm names and Nx project names** — build an explicit reverse lookup during extraction: read each project's package.json `name` field, store as `packageNames` map, match dependency declarations against this map only. Three distinct name spaces must never be conflated: npm package name, Nx project name, and `alias/projectName` host graph name.

3. **Reading package.json from wrong scope** — only read project-level package.json files (at `join(workspaceRoot, project.root, 'package.json')`); never use the child repo root or host workspace root package.json as dependency sources; never use `context.fileMap` for files under `.repos/` (gitignored, excluded from file map).

4. **Circular cross-repo dependency crash** — Nx does not reliably catch cycles in plugin-contributed edges (confirmed via nrwl/nx#7546); add a DFS cycle detector in `detectCrossRepoDependencies`, emit a clear warning naming the involved projects, and omit the cycle-creating edge before returning.

5. **Schema backward compatibility break** — all new config fields must use `.optional()`; a v1.0 config (repos-only, no overrides field) must parse successfully through the v1.1 schema; write this as an explicit unit test before merging any schema changes.

## Implications for Roadmap

Based on research, the natural build order follows data flow dependencies: schema defines the contract, extraction enriches the data, detection consumes the enriched data, integration wires everything together, E2E validates the full stack.

### Phase 1: Schema Extension and Backward Compatibility
**Rationale:** The config schema is the contract every downstream component depends on. Establishing it first (with backward compat verified immediately) prevents breaking existing users and unblocks all subsequent development. This is also the lowest-risk phase — purely additive Zod changes with no runtime behavior change.
**Delivers:** New optional `dependencyOverrides` field in `polyrepoConfigSchema`; v1.0 configs still parse successfully.
**Addresses:** Explicit dependency overrides (table stakes), backward compatibility requirement (critical).
**Avoids:** Pitfall 5 (schema breaking existing users). Test: parse a repos-only v1.0 config through the v1.1 schema and assert no validation error.

### Phase 2: Package Name and Dependency Extraction
**Rationale:** The detection function is a pure function that requires enriched data from the graph report. That data must be populated in the cache pipeline before the detection logic can be written or tested. This phase has no user-visible output on its own but is the foundational data layer for everything that follows.
**Delivers:** `readPackageNames()` and `readPackageDependencies()` in `extract.ts`; `packageName` on `TransformedNode`; `packageNames` and `packageDependencies` per repo in `PolyrepoGraphReport`.
**Addresses:** Namespaced resolution (prerequisite for auto-detection).
**Avoids:** Pitfall 2 (namespace mismatch — lookup table established here), Pitfall 3 (wrong package.json scope — file path resolution locked in here), Pitfall 6 (cache staleness — data lives in cache pipeline, not in `createDependencies`).

### Phase 3: Cross-repo Dependency Detection (Pure Function)
**Rationale:** With enriched data available from Phase 2, the core detection algorithm can be implemented and fully unit-tested in isolation before any integration work. A pure function with no side effects makes SIFERS tests trivial and catches all correctness issues cheaply, before they reach the integration layer.
**Delivers:** `detect-cross-deps.ts` with `detectCrossRepoDependencies(report, config, context)` — builds reverse lookup map, matches cross-repo deps, applies overrides, runs cycle detection, emits `DependencyType.static` edges with `sourceFile`.
**Addresses:** Auto-detect cross-repo deps from package.json (table stakes), explicit overrides (table stakes), diagnostic warnings (should-have), dependency negation (should-have).
**Avoids:** Pitfall 1 (DependencyType.static with sourceFile — established here), Pitfall 4 (cycle detection — implemented here), Pitfall 5 (override/auto-detect conflict and deduplication — handled here).

### Phase 4: Integration into createDependencies
**Rationale:** Once the detection function is proven correct via unit tests, wiring it into `index.ts` is mechanical. Keeping integration as a distinct phase ensures the pure function is solid before exercising the end-to-end path.
**Delivers:** `createDependencies` returns cross-repo edges (auto-detected + overrides) alongside existing intra-repo edges; integration tests verifying full edge emission.
**Addresses:** All table-stakes features now end-to-end functional.
**Avoids:** Pitfall 1 (confirmed correct edge type in full invocation), Pitfall 3 (confirmed correct file resolution in full path).

### Phase 5: E2E Validation
**Rationale:** The existing testcontainers E2E setup validates the full stack against real or fixture repos. New E2E tests are needed to confirm cross-repo edges appear in `nx graph`, `nx affected` respects them, and override configs are honored end-to-end.
**Delivers:** Testcontainers E2E tests: package.json auto-detection, override edges, negative override suppression.
**Addresses:** `nx graph` visibility, `nx affected` correctness (both observable table-stakes outcomes).
**Avoids:** Any remaining integration gaps not caught by unit tests; confirms cache invalidation works correctly after package.json changes.

### Phase Ordering Rationale

- Schema first: defines the config type used by all downstream components; backward compat verified before any other code ships
- Extraction second: the detection function is purely data-in/edges-out; it cannot be written until the data it consumes exists in the report
- Detection third as a pure function: easiest to fully test in isolation; correctness issues caught cheaply before wiring
- Integration fourth: mechanical wiring once detection is proven; keeps blast radius of integration bugs small
- E2E last: validates the entire stack; slower feedback loop, so run after all unit tests pass

All five critical pitfalls must be addressed in Phases 1-3. By Phase 4, the architectural decisions are locked in and integration is purely mechanical.

### Research Flags

Phases with standard patterns (skip additional research-phase):
- **Phase 1 (Schema Extension):** Well-understood Zod additive extension; identical pattern to how the v1.0 schema was built.
- **Phase 2 (Extraction):** `fs.readFileSync` + Zod parse is an established project pattern; no new territory.
- **Phase 4 (Integration):** Mechanical wiring following existing `createDependencies` structure.
- **Phase 5 (E2E):** Testcontainers setup already exists; adding fixture repos with cross-deps is incremental.

Phases that may benefit from deeper research during planning:
- **Phase 3 (Detection Function):** The `DependencyType.static` + `sourceFile` behavior for plugin-contributed edges needs a targeted spike. The exact `sourceFile` path format (relative to what root?) should be confirmed against live Nx 22.x behavior before committing to the implementation. This is low-risk but high-confidence is valuable before writing SIFERS tests that assert on the emitted edge shape.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All findings from direct codebase inspection + runtime verification; no new dependencies needed, confirmed via `node -e` |
| Features | HIGH | Grounded in existing Nx API (`createDependencies`, `DependencyType`), Nx docs, and existing plugin structure; table stakes are unambiguous |
| Architecture | HIGH | Based on existing v1.0 source code and established Nx plugin patterns; build order follows strict data flow dependencies |
| Pitfalls | HIGH | Critical pitfalls verified against `node_modules` type definitions, Nx GitHub issues (confirmed bug reports), and existing source code |

**Overall confidence:** HIGH

### Gaps to Address

- **`DependencyType.static` sourceFile path format:** Research confirms `sourceFile` is required for `StaticDependency` when source is not an external node, but the exact expected path format (relative to workspace root? absolute?) should be confirmed with a one-line spike against Nx 22.x before Phase 3 implementation. Low risk; easy to resolve.

- **`devDependencies` inclusion policy:** FEATURES.md recommends scanning `devDependencies` (changes in `@acme/test-utils` still affect consumers); PITFALLS.md checklist notes to verify only `dependencies` are scanned. These conflict. Explicit decision needed before Phase 3. Recommendation: scan both `dependencies` and `devDependencies` for MVP to match how Nx's own monorepo analysis works; provide a future opt-out config if users find the noise excessive.

- **Scoped package name handling:** The lookup map implementation must handle colons, slashes, and at-signs in npm package names (`@scope/name`) correctly as map keys. This is a correctness detail for Phase 2/3, not an architectural gap — worth an explicit unit test asserting scoped names are looked up correctly.

- **Public npm package disambiguation:** If a project declares `"lodash": "^4.x"` and no synced repo publishes `lodash`, the lookup miss is a safe no-op. The edge case where an internal package shares a name with a public npm package is unlikely but should produce a verbose diagnostic warning rather than a silent false edge.

## Sources

### Primary (HIGH confidence)

- `packages/op-nx-polyrepo/src/index.ts` — existing `createDependencies` using `DependencyType.implicit`, guard pattern with `context.projects[dep.source]`
- `packages/op-nx-polyrepo/src/lib/config/schema.ts` — existing Zod schema with `.strict()` and `.refine()`
- `packages/op-nx-polyrepo/src/lib/graph/types.ts` — `PolyrepoGraphReport`, `TransformedNode` shapes (confirmed: no `packageName` field today)
- `packages/op-nx-polyrepo/src/lib/graph/cache.ts` — two-layer cache hashing `optionsHash + HEAD SHA + dirty files`
- `packages/op-nx-polyrepo/src/lib/graph/transform.ts` — `TransformedNode` confirmed to have no npm package name field
- `node_modules/nx/src/project-graph/project-graph-builder.d.ts` — `StaticDependency.sourceFile` required for non-external-node sources
- [Nx: Extending the Project Graph](https://nx.dev/docs/extending-nx/project-graph-plugins) — `createDependencies` API, `CandidateDependency` shape
- [Nx: DependencyType enum](https://nx.dev/nx-api/devkit/documents/DependencyType) — `static`, `dynamic`, `implicit` values and semantics
- [Circular dependencies not caught for plugin nodes — nrwl/nx#7546](https://github.com/nrwl/nx/issues/7546) — confirms cycle detection gap for plugin-contributed edges
- Runtime verification: `DependencyType` enum values confirmed via `node -e`; `@nx/devkit` exports no cross-workspace scanning utilities

### Secondary (MEDIUM confidence)

- [Nx: Project Configuration](https://nx.dev/docs/reference/project-configuration) — `implicitDependencies` with negation support as design reference
- [Implicit Dependencies Management with Nx](https://dev.to/this-is-learning/implicit-dependencies-management-with-nx-a-practical-guide-through-real-world-case-studies-59kd) — practical negation patterns
- [All projects affected too often — nrwl/nx Discussion #5580](https://github.com/nrwl/nx/discussions/5580) — implicit dep recomputation cost, `projectsAffectedByDependencyUpdates`
- [Poly Monorepos with Nx](https://gelinjo.hashnode.dev/poly-monorepos-with-nx) — poly-monorepo architecture patterns
- [@nx/dotnet source](https://github.com/nrwl/nx/tree/master/packages/dotnet) — cross-project dependency mapping via `referencesByRoot`
- [@nx/gradle source](https://github.com/nrwl/nx/tree/master/packages/gradle) — module-level cache + shared report pattern

---
*Research completed: 2026-03-17*
*Ready for roadmap: yes*
