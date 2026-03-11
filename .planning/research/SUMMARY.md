# Project Research Summary

**Project:** nx-openpolyrepo
**Domain:** Nx plugin for synthetic monorepo / polyrepo graph merging
**Researched:** 2026-03-10
**Confidence:** MEDIUM-HIGH

## Executive Summary

nx-openpolyrepo is an Nx plugin that creates a "synthetic monorepo" experience by cloning external repos into a host workspace and merging their project graphs into a unified Nx project graph. This is a free, open-source alternative to Nx Enterprise's Polygraph feature. The core value proposition is that standard Nx commands (`nx graph`, `nx affected`, `nx run-many`) work transparently across repo boundaries without requiring teams to consolidate into an actual monorepo. The closest existing tools (meta, mu-repo, myrepos) provide multi-repo git coordination but none integrate with Nx's project graph, task orchestration, or affected analysis -- that integration is the key differentiator.

The recommended approach is to build a standard Nx project graph plugin using `createNodesV2` and `createDependencies` from `@nx/devkit`, with `simple-git` for git operations and `zod` for configuration validation. This architecture is validated by three official Nx plugins (`@nx/gradle`, `@nx/maven`, `@nx/dotnet`) that follow the same pattern: trigger on config files, shell out to an external tool for project discovery, cache the JSON result, and serve it via `createNodesV2`. The architecture has five components: Repo Assembler (git clone/pull), Graph Extractor (read each repo's project structure), Graph Merger (namespace and merge into host graph), Plugin API surface (createNodes + createDependencies), and optional Sync Generator (auto-generate tsconfig paths). The critical architectural constraint is that graph extraction from synced repos must NOT call `createProjectGraphAsync` (causes infinite recursion) -- instead, graphs must be pre-computed and cached as JSON during the assembly step.

The top risks are: (1) performance -- naive implementations that shell out to `nx graph` per repo on every graph computation will destroy DX, so caching must be baked in from day one; (2) project name collisions -- namespacing must be applied during graph construction, not as an afterthought; (3) external npm node version conflicts across repos silently overwrite each other; (4) Windows path length limits with deep clone directories. All four are Phase 1 concerns that cannot be deferred.

## Key Findings

### Recommended Stack

The stack is almost entirely Nx-native. The plugin is built with `@nx/devkit` (v22.5.4) for all plugin APIs, TypeScript 5.9 for the language, and `@nx/plugin` for scaffolding and e2e testing. The only external runtime dependency is `simple-git` for git operations (wraps system git, no native compilation, full TypeScript types) and `zod` for config validation. Testing uses Vitest (already in workspace) plus `@nx/devkit/testing` for generator unit tests.

**Core technologies:**
- **Nx 22.x / @nx/devkit**: Plugin host and development API -- `createNodesV2`, `createDependencies`, `Tree`, sync generators
- **simple-git**: All git operations (clone, pull, fetch, status) -- wraps system git binary, cross-platform including ARM64 Windows
- **zod**: Runtime validation of plugin options from nx.json -- TypeScript type inference, clear error messages
- **Vitest**: Unit and integration testing -- already in workspace, native TypeScript support
- **@nx/js**: TypeScript compilation for the plugin package

### Expected Features

**Must have (table stakes):**
- Repo assembly via git clone/pull configured in nx.json plugin options
- Unified project graph via createNodesV2 -- external projects appear in `nx graph`
- Project namespacing to prevent name collisions across repos
- Cross-repo dependency detection from package.json
- Affected analysis across repo boundaries (`nx affected` works cross-repo)
- Multi-repo git status (combined view across synced repos)
- Cross-repo task orchestration awareness (build order respects cross-repo deps)

**Should have (competitive, v1.x):**
- Bulk git operations (pull, fetch, checkout across all repos)
- Explicit cross-repo dependency overrides (for non-npm deps like APIs/services)
- Stale repo detection (warn when synced repo diverges from remote)
- Selective repo assembly (profiles/groups for large teams)
- Sync generator for tsconfig paths (auto-generate cross-repo TypeScript imports)

**Defer (v2+):**
- Non-Nx repo support (requires inferring project graphs from arbitrary structures)
- Cross-repo conformance rules
- Watch mode across repos
- Custom workspace visualization beyond `nx graph`

### Architecture Approach

The plugin follows a pipeline architecture: config reading -> repo assembly -> graph extraction -> graph merging -> Nx plugin API integration. Each stage is a distinct component with clear boundaries. The critical design decision is that graph extraction happens as a pre-step (during assembly), not during `createNodes` execution, to avoid the `createProjectGraphAsync` recursion trap and keep graph computation fast. Cached graph JSON files in each synced repo directory serve as the bridge between assembly and graph construction.

**Major components:**
1. **Repo Assembler** -- clones/pulls repos to `.repos/` directory, manages branch/tag checkout, detects staleness
2. **Graph Extractor** -- reads each synced repo's project structure, produces cached graph JSON per repo
3. **Graph Merger** -- namespaces external projects with repo prefix, resolves cross-repo deps, deduplicates external npm nodes
4. **Project Graph Plugin** -- `createNodes` + `createDependencies` that surface merged graph to host Nx workspace
5. **Generators** -- `init` for first-time setup, `add-repo` for adding repos to config
6. **Sync Generator** -- keeps tsconfig paths and .gitignore in sync with synced repos

### Critical Pitfalls

1. **Project name collisions** -- Two repos with identically-named projects cause silent ambiguity. Prevent by namespacing all external projects at `createNodesV2` time (e.g., `repo-a/shared-utils`). Must be built in from Phase 1.
2. **Plugin performance** -- Shelling out to `nx graph` per repo on every graph computation takes 5-30s per repo. Prevent by caching repo graphs as JSON, invalidating only on file changes. Target: <2s for 5 repos.
3. **External node version conflicts** -- Repos with different versions of the same npm package overwrite each other silently. Prevent by scoping external nodes per repo (e.g., `npm:repo-a/react@18.2.0`).
4. **createProjectGraphAsync recursion** -- Calling this inside `createNodes` causes infinite recursion (guarded by `global.NX_GRAPH_CREATION`). Prevent by pre-computing graphs during assembly and reading cached JSON.
5. **Windows path length limits** -- Cloning into deep paths exceeds 260-char MAX_PATH. Prevent by using short assembly paths (`.repos/`), enabling `core.longpaths=true`, and testing on Windows CI from day one.

## Implications for Roadmap

Based on research, the feature dependency graph and architecture layers suggest a 5-phase structure.

### Phase 1: Plugin Foundation + Repo Assembly
**Rationale:** Nothing else works without repos on disk and the plugin skeleton registered in Nx. The Repo Assembler is Layer 1 in the architecture and the root of the feature dependency tree.
**Delivers:** Plugin package scaffolded with `@nx/plugin`, repo assembly via `simple-git` (clone/pull to `.repos/`), configuration schema with zod validation, `init` generator for first-time setup.
**Addresses:** Repo assembly (clone/pull), config in nx.json, project namespacing strategy (types/interfaces).
**Avoids:** Windows path length issues (short `.repos/` path, `core.longpaths=true`), daemon caching during dev (`NX_DAEMON=false` documented).

### Phase 2: Core Graph Plugin
**Rationale:** The unified project graph IS the product. This phase delivers the proof of concept: external projects visible in `nx graph`. Depends on Phase 1 (repos must be on disk).
**Delivers:** Graph Extractor, Graph Merger, `createNodesV2` implementation, project namespacing. After this phase, `nx graph` shows projects from all synced repos.
**Addresses:** Unified project graph, project namespacing, external node deduplication.
**Avoids:** `createProjectGraphAsync` recursion (cached graph approach), plugin performance (caching from day one), project name collisions (namespace prefixing), external node version conflicts (repo-scoped npm nodes).

### Phase 3: Cross-Repo Dependencies + Affected Analysis
**Rationale:** Dependency edges make the graph useful. Without them, `nx affected` only detects direct file changes, not transitive impacts. Depends on Phase 2 (project nodes must exist before edges can connect them).
**Delivers:** `createDependencies` implementation, package.json-based auto-detection, explicit dependency overrides config, working `nx affected` across repos.
**Addresses:** Cross-repo dependency detection, affected analysis, explicit dependency overrides, cross-repo task orchestration awareness.
**Avoids:** False positive/negative dependency detection (multi-signal approach: auto-detect + manual overrides + ambiguity warnings).

### Phase 4: Multi-Repo Git DX
**Rationale:** Once the graph works, users need day-to-day git operations across repos. These features are independent of the graph (only need repo assembly) and are low complexity.
**Delivers:** Multi-repo git status, bulk git operations (pull, fetch), stale repo detection, selective repo assembly (profiles/groups).
**Addresses:** Multi-repo git status, bulk git operations, stale repo detection, selective repo assembly.
**Avoids:** Silent stale repo state (freshness checks via sync generator).

### Phase 5: Sync Generators + Polish
**Rationale:** Sync generators depend on both the graph (to know project structure) and assembly (to know repo locations). This is DX polish that rounds out the v1 experience.
**Delivers:** Sync generator for tsconfig path mappings, .gitignore auto-management, `add-repo` generator for easy repo addition, documentation.
**Addresses:** Sync generator for tsconfig paths, workspace file management.
**Avoids:** Manual configuration drift between graph state and workspace files.

### Phase Ordering Rationale

- **Dependency-driven:** The feature dependency graph shows Repo Assembly -> Unified Graph -> Dependencies -> Affected as a strict chain. Phases follow this order.
- **Architecture-aligned:** Phases map to the architecture's layer model (Layer 0: config types, Layer 1: assembler + extractor, Layer 2: merger, Layer 3: plugin API + sync).
- **Risk front-loaded:** All 5 critical pitfalls (name collisions, performance, external node conflicts, recursion, Windows paths) are addressed in Phases 1-2. No critical risk is deferred past Phase 2.
- **Git DX is independent:** Multi-repo git operations only depend on Phase 1 (repo assembly), so Phase 4 could theoretically run in parallel with Phases 2-3. But the graph is the core value prop, so it takes priority.

### Research Flags

Phases likely needing deeper research during planning:
- **Phase 2 (Core Graph Plugin):** The `createNodesV2` + cached graph extraction pattern is the most technically novel part. Needs research into exact Nx graph cache file formats, `createNodesFromFiles` behavior, and how the daemon invalidates plugin results.
- **Phase 3 (Cross-Repo Dependencies):** Package name matching heuristics for auto-detection need validation. How does Nx resolve ambiguous project name references? What happens with circular cross-repo dependencies?

Phases with standard patterns (skip research-phase):
- **Phase 1 (Plugin Foundation):** Well-documented Nx plugin scaffolding via `@nx/plugin:plugin`. simple-git has extensive docs. Standard patterns.
- **Phase 4 (Multi-Repo Git DX):** Straightforward git operations with simple-git. meta and mu-repo provide established UX patterns to follow.
- **Phase 5 (Sync Generators):** Nx sync generator API is well-documented with examples.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All technologies are either already in the workspace or are well-established with strong docs. Nx plugin APIs are official and stable in v22. |
| Features | MEDIUM-HIGH | Table stakes are clear from competitor analysis. Differentiator value is assumed based on the gap between meta/mu-repo and Nx Polygraph. |
| Architecture | MEDIUM-HIGH | Pipeline architecture is sound. The cached graph extraction pattern is the main uncertainty -- it avoids known recursion issues but the exact cache format and invalidation strategy need validation. |
| Pitfalls | HIGH | Pitfalls are sourced from Nx GitHub issues with confirmed reports and official docs. The `createProjectGraphAsync` recursion issue is well-documented. |

**Overall confidence:** MEDIUM-HIGH

### Gaps to Address

- **Cached graph extraction format:** The exact format of `nx graph --file=output.json` output and whether it contains all needed fields (project configs, external nodes, dependency edges) needs validation during Phase 2 implementation.
- **Nx 22/23 forward compatibility:** The `createNodesV2` to `createNodes` naming migration in Nx 23 needs testing. The dual-export strategy is theoretically sound but untested.
- **Cross-repo affected analysis with git:** How `nx affected` detects file changes across multiple git working directories (synced repos have separate `.git` dirs) needs investigation. May require custom `--base`/`--head` handling.
- **Nx version compatibility across repos:** The adapter layer for different Nx versions in synced repos is scoped to "Nx 22.x only" for MVP. Exact breaking differences between Nx 20/21/22 graph formats are not fully cataloged.
- **simple-git error handling on Windows:** Edge cases with Git for Windows (credential prompts, SSH agent, proxy settings) may surface during implementation. Not fully documented in simple-git.

## Sources

### Primary (HIGH confidence)
- [Extending the Project Graph | Nx](https://nx.dev/docs/extending-nx/project-graph-plugins) -- createNodesV2, createDependencies API
- [CreateNodes Compatibility | Nx](https://nx.dev/docs/extending-nx/createnodes-compatibility) -- v1/v2 migration, Nx 22/23 naming
- [Sync Generators | Nx](https://nx.dev/docs/concepts/sync-generators) -- sync generator concepts and API
- [ProjectGraph API Reference | Nx](https://nx.dev/docs/reference/devkit/ProjectGraph) -- graph types and structures
- [simple-git | GitHub](https://github.com/steveukx/git-js) -- git operations library (12M+ weekly downloads)
- [GitHub #26297](https://github.com/nrwl/nx/issues/26297), [#29503](https://github.com/nrwl/nx/issues/29503), [#32788](https://github.com/nrwl/nx/issues/32788) -- Nx plugin performance and caching issues

### Secondary (MEDIUM confidence)
- [@nx/gradle source](https://github.com/nrwl/nx/tree/master/packages/gradle) -- createNodesV2 + cached project graph report pattern
- [@nx/maven source](https://github.com/nrwl/nx/tree/master/packages/maven) -- Kotlin analyzer subprocess + PluginCache pattern
- [@nx/dotnet source](https://github.com/nrwl/nx/tree/master/packages/dotnet) -- C# MSBuild analyzer + cross-project dependency mapping
- [Nx Polygraph introduction](https://nx.dev/blog/nx-cloud-introducing-polygraph) -- enterprise feature comparison
- [meta | GitHub](https://github.com/mateodelnorte/meta) -- multi-repo DX patterns
- [mu-repo](https://fabioz.github.io/mu-repo/) -- parallel git command patterns
- [10 Tips for Successful Nx Plugin Architecture](https://smartsdlc.dev/blog/10-tips-for-successful-nx-plugin-architecture/) -- plugin development guidance

### Tertiary (LOW confidence)
- [monorepo.tools](https://monorepo.tools/) -- general monorepo landscape (useful for positioning, not implementation)

---
*Research completed: 2026-03-10*
*Ready for roadmap: yes*
