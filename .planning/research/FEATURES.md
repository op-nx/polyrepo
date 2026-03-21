# Feature Landscape

**Domain:** Cross-repo dependency detection and manual dependency overrides for Nx polyrepo plugin
**Researched:** 2026-03-17
**Milestone:** v1.1 Cross-repo Dependencies

## Context

The v1.0 plugin already merges project graphs from multiple repos into a unified Nx workspace. The `createDependencies` hook currently exports **intra-repo** edges only (dependencies that existed within each child repo's own graph). There are zero **inter-repo** edges today -- if repo A's `@acme/api` depends on repo B's `@acme/shared-utils` via package.json, that edge is invisible. This means `nx affected` cannot trace changes across repo boundaries, which undermines the core value proposition of a synthetic monorepo.

v1.1 closes this gap with two complementary features: automatic detection from package.json and manual override wiring.

## Table Stakes

Features users expect when cross-repo dependencies are advertised. Missing = product feels incomplete.

| Feature | Why Expected | Complexity | Dependencies on Existing |
|---------|--------------|------------|--------------------------|
| **Auto-detect cross-repo deps from package.json** | This is how JS/TS projects declare dependencies. Every monorepo tool (Lerna, Turborepo, Nx itself) resolves package.json `dependencies`/`devDependencies` to project graph edges. Users will assume this works. | Medium | Requires reading each external repo's per-project package.json files, building a package-name-to-namespaced-project lookup, and matching against host + all external projects. Extends `createDependencies` in `index.ts`. |
| **Support dependencies AND devDependencies** | Both are meaningful dependency edges. `devDependencies` like `@acme/test-utils` still mean "changes in that package affect this project." Ignoring devDependencies would miss real dependency chains. | Low | Straightforward -- iterate both fields in the same scanning pass. |
| **Namespaced resolution** | External projects are namespaced as `repoAlias/projectName`. The dependency resolver must map npm package names (e.g., `@acme/shared-utils`) to their namespaced graph names (e.g., `nx/shared-utils`). | Medium | Depends on existing `transformGraphForRepo` output and the `PolyrepoGraphReport` structure. Needs a reverse lookup: package.json `name` field -> namespaced project name. Must also handle host workspace projects (no namespace prefix). |
| **Cross-repo edges visible in `nx graph`** | The whole point. Dependencies returned from `createDependencies` appear as edges in `nx graph` visualization. | Low | Already works -- `createDependencies` return value is rendered by Nx. Just need to return inter-repo edges alongside existing intra-repo edges. |
| **`nx affected` respects cross-repo deps** | When repo B changes, projects in repo A that depend on repo B projects must be marked affected. This is the primary practical value of cross-repo edges. | Low | Automatic once edges are in the graph. Nx's affected algorithm traverses the full project graph. No additional work beyond returning correct edges. |
| **Explicit dependency overrides in config** | Not all dependencies are in package.json. Infrastructure repos, shared CI configs, data contracts (protobuf, OpenAPI) have implicit relationships. Users need a way to manually wire these. Nx itself supports `implicitDependencies` in project.json for this reason. | Low-Medium | Extends the Zod config schema in `schema.ts`. Processed alongside auto-detected deps in `createDependencies`. |

## Differentiators

Features that set the product apart. Not expected by default, but valued.

| Feature | Value Proposition | Complexity | Dependencies on Existing |
|---------|-------------------|------------|--------------------------|
| **Dependency negation (override to remove)** | Nx's own `implicitDependencies` supports `!projectName` to explicitly remove a detected dependency. Package.json may list a dependency that is not actually consumed at runtime (e.g., version-only peer dep alignment). Letting users negate false positives prevents noisy `nx affected` results. | Low | Config schema addition: `{ "source": "repoA/app", "target": "!repoB/lib" }` or `negate: true` flag. Filter logic in createDependencies. |
| **peerDependencies detection** | Some cross-repo relationships are expressed as peer deps (e.g., plugin-host patterns). Detecting these catches edges that dependencies/devDependencies miss. | Low | Same package.json scanning pass, just add `peerDependencies` field. |
| **Wildcard/glob overrides** | Instead of wiring individual project pairs, allow patterns like `{ "source": "repoA/*", "target": "repoB/shared-core" }` meaning "all projects in repoA depend on shared-core." Useful for foundation libraries. | Medium | Requires glob matching (minimatch) against project names. Nx uses minimatch for its own implicitDependencies, so there is precedent. |
| **Dependency edge type control** | Let users specify whether an override creates an `implicit`, `static`, or `dynamic` edge. Different edge types affect Nx's task scheduling differently. Default to `implicit` (safest). | Low | Enum field in override config, passed through to `RawProjectGraphDependency.type`. |
| **Diagnostic: unresolved dependency warnings** | When a package.json lists `@acme/shared-utils` and no project in any synced repo publishes that package name, emit a warning. Helps users understand why expected edges are missing. | Low | Compare resolved set against all package.json dependency keys. Log unresolved ones via `logger.warn`. |

## Anti-Features

Features to explicitly NOT build in this milestone.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| **TypeScript import analysis across repos** | Each external repo's source files are in `.repos/` and are not part of the host workspace's TypeScript program. Analyzing imports would require parsing every source file from every repo, understanding their path aliases, and resolving cross-repo references. Enormous complexity for marginal gain over package.json detection. | Rely on package.json as the dependency contract. If projects publish packages, their consumers declare deps in package.json. |
| **Lock file analysis** | Parsing pnpm-lock.yaml, package-lock.json, or yarn.lock to resolve exact versions and transitive deps across repos. Lockfile formats differ between package managers and change between versions. | Use package.json `dependencies`/`devDependencies` keys only. Exact version resolution is not needed for graph edges -- only the package name matters. |
| **Automatic version conflict detection** | Detecting when repo A depends on `lodash@4.x` and repo B depends on `lodash@3.x`. This is a valuable feature but belongs to a conformance/consistency milestone, not dependency detection. | Defer to v2+ conformance rules (listed in PROJECT.md as out-of-scope). |
| **Cross-repo `dependsOn` task chaining** | The v1.0 design intentionally strips `dependsOn` from proxy targets to avoid cascading task graphs. Enabling cross-repo task ordering (e.g., "build repoB/lib before building repoA/app") is a separate, high-complexity feature that triggers the native task hasher on external projects. | Keep existing behavior: proxy targets have empty `dependsOn`. Cross-repo edges inform `affected` and `graph` but do not create task-level ordering. Document this as a known limitation. |
| **Runtime dependency inference** | Detecting dependencies via dynamic `require()`, environment variable references, or config file analysis. Too heuristic-heavy and error-prone. | Manual overrides cover non-package.json relationships. |
| **GUI for dependency management** | A web UI to visualize and edit cross-repo dependencies. | `nx graph` already visualizes. Config editing is in nx.json. |

## Feature Dependencies

```
Namespaced resolution (package name -> project name lookup)
  -> Auto-detect cross-repo deps from package.json (uses the lookup)
  -> peerDependencies detection (same lookup, different field)

Zod config schema extension
  -> Explicit dependency overrides (config parsing)
  -> Dependency negation (override with negation flag)
  -> Wildcard/glob overrides (pattern matching in overrides)

Auto-detect + Explicit overrides
  -> Diagnostic: unresolved dependency warnings (needs full resolved set)
```

Critical dependency: the **package-name-to-project lookup** is the foundation for auto-detection. It must map npm package names (from package.json `name` field) to namespaced Nx project names for both host workspace projects and external repo projects. This lookup is read from the graph report nodes (which already contain root paths from which package.json can be located) and from `context.projects` in the `CreateDependenciesContext`.

## MVP Recommendation

**Phase 1 -- Auto-detection (Table Stakes):**

1. **Build package-name-to-project lookup** -- For each project in the graph (host and external), read its package.json `name` field. Map that to the Nx project name. Host projects use their own name; external projects use their namespaced name (`repoAlias/originalName`). Store in `Map<packageName, projectName>`.
2. **Scan package.json for cross-repo edges** -- For each project, read its package.json `dependencies` and `devDependencies`. For each dep key that maps to a project in a *different* repo (or host-to-external / external-to-host), emit a cross-repo edge with `DependencyType.implicit`.
3. **Return inter-repo edges from createDependencies** -- Alongside existing intra-repo edges from the graph report, return the newly detected cross-repo edges.

**Phase 2 -- Manual Overrides:**

4. **Extend Zod config schema** -- Add optional `dependencies` array to plugin options. Each entry: `{ source: string, target: string }`. Source/target are namespaced project names.
5. **Process overrides in createDependencies** -- After auto-detection, add explicit override edges. Validate that source and target exist in `context.projects`.
6. **Dependency negation** -- Support `negate: true` on overrides to suppress auto-detected edges.
7. **Diagnostic warnings** -- Warn on unresolved package names and on override targets that don't match any project.

**Defer:**
- Wildcard/glob overrides: useful but adds complexity; start with exact project names
- Dependency edge type control: default to `implicit`, revisit if users request granularity
- peerDependencies: add in a fast follow-up once the core detection works

## Complexity Assessment

| Feature | Estimated Effort | Risk |
|---------|-----------------|------|
| Package name lookup table | Small (1-2 hours) | Low -- straightforward Map construction from project roots |
| package.json scanning for cross-repo edges | Medium (2-4 hours) | Medium -- must handle missing package.json, monorepo project names vs package names, scoped packages, and projects without package.json (e.g., app projects) |
| Inter-repo edge emission in createDependencies | Small (1 hour) | Low -- createDependencies already works, just more edges |
| Config schema extension for overrides | Small (1-2 hours) | Low -- Zod schema, well-established pattern in codebase |
| Override processing logic | Medium (2-3 hours) | Low -- filter/add logic on dependency array |
| Negation support | Small (1 hour) | Low -- filter step after all edges collected |
| Diagnostic warnings | Small (1 hour) | Low -- logger.warn on unmatched names |
| Unit tests (SIFERS) for all above | Medium (3-5 hours) | Low -- SIFERS pattern is well-established, 282 existing tests as reference |
| e2e test additions | Medium (2-3 hours) | Medium -- testcontainers setup already exists, but need fixture repos with cross-deps |

**Total estimated effort:** 2-3 days for full feature set including tests.

## How It Works in Practice

### Auto-detection flow

```
Host workspace                 External repo "nx"
+-------------------+          +-------------------+
| my-app            |          | nx/core           |
|  package.json:    |          |  package.json:    |
|    dependencies:  |          |    name: "@nx/devkit" |
|      "@nx/devkit" |------->  |                   |
+-------------------+          +-------------------+

1. Build lookup: "@nx/devkit" -> "nx/core" (namespaced)
2. Scan my-app's package.json: "@nx/devkit" found in lookup
3. Different repos? my-app is host, nx/core is external -> YES
4. Emit edge: { source: "my-app", target: "nx/core", type: "implicit" }
```

### Manual override flow

```json
// nx.json plugin options
{
  "repos": { "nx": { "url": "..." } },
  "dependencies": [
    { "source": "my-app", "target": "nx/nx-dev" },
    { "source": "my-app", "target": "nx/unused-lib", "negate": true }
  ]
}
```

## Sources

- [Nx: Extending the Project Graph](https://nx.dev/docs/extending-nx/project-graph-plugins) -- createDependencies API, CandidateDependency shape, filesToProcess
- [Nx: DependencyType enum](https://nx.dev/nx-api/devkit/documents/DependencyType) -- static, dynamic, implicit values
- [Nx: Project Configuration](https://nx.dev/docs/reference/project-configuration) -- implicitDependencies with negation support
- [Nx: Dependency Management Strategies](https://nx.dev/docs/concepts/decisions/dependency-management) -- single-version vs independent policies
- [Implicit Dependencies Management with Nx](https://dev.to/this-is-learning/implicit-dependencies-management-with-nx-a-practical-guide-through-real-world-case-studies-59kd) -- practical patterns for implicit deps, negation syntax
- [Poly Monorepos with Nx](https://gelinjo.hashnode.dev/poly-monorepos-with-nx) -- poly-monorepo architecture patterns
- Existing codebase: `index.ts` (createDependencies), `schema.ts` (Zod config), `transform.ts` (namespacing), `types.ts` (graph report structure)

---
*Feature research for v1.1: Cross-repo dependency detection and manual overrides*
*Researched: 2026-03-17*
