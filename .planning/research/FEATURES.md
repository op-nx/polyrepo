# Feature Research

**Domain:** Synthetic monorepo / polyrepo management tooling (Nx plugin)
**Researched:** 2026-03-10
**Confidence:** MEDIUM-HIGH

## Feature Landscape

### Table Stakes (Users Expect These)

Features users assume exist. Missing these = product feels incomplete. These are what every polyrepo management tool (meta, mu-repo, git-multi, myrepos) provides at minimum.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| **Repo assembly (clone/pull)** | Every multi-repo tool does this (meta, mu-repo, myrepos). Without it, there's nothing to work with. Users configure repos and the tool materializes them locally. | MEDIUM | Config in `nx.json` plugin options. Must handle branch/tag/commit pinning, shallow clones for speed, and graceful failure when a repo is unavailable. Git clone is cross-platform and avoids Windows symlink issues. |
| **Unified project graph** | This IS the core value prop. Nx users expect `nx graph` to show everything. If cross-repo projects don't appear in the graph, the plugin is useless. | HIGH | Requires implementing `createNodesV2` to inject projects from external repos into the host workspace graph. Must read each repo's project graph (via `nx show projects --json` or direct graph construction) and merge it. |
| **Cross-repo dependency detection (package.json)** | Users expect the graph to show actual dependency edges, not just isolated project nodes. Auto-detection from package.json `dependencies`/`devDependencies` matching project names across repos is the zero-config path. | MEDIUM | Parse package.json across all synced repos, match npm package names to project names in other repos, create dependency edges via `createDependencies`. |
| **Affected analysis across repos** | `nx affected` is the killer feature of Nx. If it doesn't work across repo boundaries, users will question why they're using the plugin at all. | HIGH | Depends on unified graph + cross-repo dependency edges. Nx's built-in affected analysis should work automatically once the graph is correct -- but git diff detection needs to span multiple repo working directories. |
| **Project namespacing** | Without namespacing, two repos with a project named `shared-utils` will collide. Every multi-workspace tool handles this (Polygraph uses workspace-level separation). | MEDIUM | Prefix external project names with repo name (e.g., `repo-a/shared-utils`). Must be consistent in graph, CLI output, and target references. Only applied when viewing from a specific repo's perspective. |
| **Multi-repo git status** | meta (`meta git status`), mu-repo (`mu st`), git-multi all provide combined status across repos. Users need to see what's changed across all repos at a glance. | LOW | Run `git status` in each synced repo directory, aggregate output. Straightforward to implement. |
| **Bulk git operations (pull, fetch)** | meta, mu-repo, myrepos all support running git commands across all repos. `pull --all` is the most common operation -- keeping synced repos up to date. | LOW | Iterate repos, run git command in each. Support parallel execution for speed. Error handling per-repo (one failure shouldn't abort all). |

### Differentiators (Competitive Advantage)

Features that set the product apart from manual scripts, meta, mu-repo, and even Nx Polygraph.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| **Nx-native integration (zero custom CLI)** | Unlike meta/mu-repo which are separate CLI tools, this works inside Nx. No context switching. `nx graph`, `nx affected`, `nx run-many` just work. This is the single biggest differentiator vs standalone multi-repo tools. | HIGH | The entire plugin architecture must conform to Nx plugin API (createNodesV2, createDependencies). This is not a wrapper around Nx -- it extends Nx. |
| **Explicit cross-repo dependency overrides** | Auto-detection covers 80% of cases. Manual wiring covers the rest: internal APIs that aren't published to npm, services that communicate via HTTP/gRPC, implicit contracts. No other open-source tool does this for Nx. | LOW | Config in `nx.json` plugin options. Simple mapping: `{ "source": "repo-a/app", "target": "repo-b/api", "type": "implicit" }`. |
| **Sync generator for cross-repo tsconfig paths** | After repo assembly, TypeScript projects need path mappings to import from other repos. A sync generator can auto-generate tsconfig path entries, making cross-repo imports work without manual config. | MEDIUM | Uses Nx sync generator API (19.8+). Reads synced repo locations, generates `paths` entries in root tsconfig. Runs before build/typecheck targets. |
| **Selective repo assembly** | Not every developer needs every repo. Let users configure which repos to assemble (profiles/groups), so a frontend dev doesn't clone backend repos. Reduces clone time and disk usage. | LOW | Config-driven: named groups of repos in `nx.json`. `nx run open-polyrepo:assemble --group=frontend`. meta supports this loosely via `.meta` file editing. |
| **Stale repo detection** | Warn when an synced repo is behind its remote, on a different branch than expected, or has uncommitted changes that might affect the graph. Prevents "works on my machine" issues. | LOW | Check git status + `git rev-list HEAD..origin/main --count` for each repo. Surface warnings in `nx sync:check` or as part of graph construction. |
| **Free/open-source alternative to Polygraph** | Polygraph requires Nx Enterprise license. This plugin is MIT-licensed and works with any self-hosted remote cache. For teams that want cross-repo visibility without enterprise contracts, this is the only option. | N/A | Not a feature per se, but the core market positioning. |
| **Cross-repo task orchestration awareness** | When running `nx run-many --target=build`, the task graph should respect cross-repo dependency order. Repo B's app that depends on Repo A's lib should build Repo A's lib first. | MEDIUM | Should work automatically if the dependency graph is correct. The key challenge is ensuring task inputs/outputs across repos are correctly wired for caching. |
| **Workspace-level caching with self-hosted remote cache** | Cross-repo builds can be cached. If Repo A's lib hasn't changed, Repo B's app build can reuse the cached artifact. Works with any Nx-compatible remote cache (custom, S3, etc.). | LOW | Nx handles this natively once the graph is correct. The plugin just needs to ensure cache keys incorporate the correct file inputs from external repo directories. |

### Anti-Features (Commonly Requested, Often Problematic)

Features that seem good but create problems. Deliberately NOT building these for v1.

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| **Cross-repo code editing/committing** | "I want to edit code in Repo B while working in the host workspace and commit it back." | Synced repos are clones with their own git state. Editing creates invisible coupling, merge conflicts, and unclear ownership. meta tried this and it's the most confusing part of the tool. | Users should `cd` into the synced repo and use normal git workflow there. The plugin provides visibility, not a unified VCS. |
| **Automatic cross-repo PR creation** | "When I change a shared lib, auto-create PRs in dependent repos." | Requires deep CI/CD integration, GitHub/GitLab API auth, and making assumptions about branching strategy. Massive scope creep. Polygraph does this but it's an enterprise feature for a reason. | Provide affected analysis output that CI can consume. Let teams wire their own PR automation using `nx affected --base=... --head=...` output. |
| **Custom task runner / build system** | "I need a special build pipeline for cross-repo builds." | Nx already has a task runner, task graph, and caching. Reimplementing this is a multi-year effort and will always be worse than Nx native. | Leverage Nx's built-in task orchestration. The plugin only contributes to the project/dependency graph. |
| **GUI / web dashboard** | "I want a visual dashboard to manage all my repos." | Massive scope, orthogonal to the core problem, and `nx graph` already provides visualization. A dashboard is a separate product. | `nx graph` for visualization. CLI/TUI for management commands. |
| **Nx Cloud integration** | "Can this work with Nx Cloud?" | Explicitly out of scope. Nx Cloud already has Polygraph for this. Building Nx Cloud integration defeats the purpose of being a free alternative. | Self-hosted remote cache (S3, custom HTTP, etc.). |
| **Git submodule/subtree approach** | "Use git submodules instead of cloning." | Submodules are notoriously painful: recursive clones, detached HEAD state, version pinning friction, poor Windows support. Subtrees pollute git history. Every experienced developer has submodule horror stories. | Plain git clone/pull into a configurable directory. Simple, predictable, debuggable. |
| **Non-Nx repo support** | "I want to include repos that don't use Nx in the graph." | Polygraph supports this via "metadata-only workspaces" but it requires inferring a project graph from non-Nx repos (package.json workspaces, file structure). Huge complexity for v1. | v1 requires all synced repos to be Nx workspaces. Non-Nx support can be a v2 feature if there's demand. |
| **Monorepo consolidation / migration tool** | "Help me merge polyrepos into a real monorepo." | Completely different problem space. Migration tools need git history preservation, CI rewriting, dependency deduplication. | Point users to `lerna import` or custom scripts. The plugin assumes you WANT to stay polyrepo. |

## Feature Dependencies

```
[Repo Assembly (clone/pull)]
    |
    +--requires--> [Config in nx.json]
    |
    +--enables--> [Unified Project Graph]
    |                 |
    |                 +--requires--> [Project Namespacing]
    |                 |
    |                 +--enables--> [Cross-repo Dependency Detection]
    |                 |                 |
    |                 |                 +--enables--> [Affected Analysis]
    |                 |                 |
    |                 |                 +--enables--> [Cross-repo Task Orchestration]
    |                 |
    |                 +--enables--> [Explicit Dependency Overrides]
    |
    +--enables--> [Multi-repo Git Status]
    |
    +--enables--> [Bulk Git Operations]
    |
    +--enables--> [Stale Repo Detection]
    |
    +--enables--> [Sync Generator (tsconfig paths)]
                      |
                      +--requires--> [Unified Project Graph]
```

### Dependency Notes

- **Unified Project Graph requires Repo Assembly:** The graph plugin reads project configurations from synced repo directories. Without repos on disk, there's nothing to graph.
- **Unified Project Graph requires Project Namespacing:** Must be built into graph construction from day one. Retrofitting namespacing after projects are in the graph causes breaking changes.
- **Cross-repo Dependency Detection requires Unified Project Graph:** Dependencies are edges between nodes. Nodes must exist first.
- **Affected Analysis requires Cross-repo Dependency Detection:** `nx affected` traverses dependency edges to find impacted projects. Without edges, affected analysis only finds projects with direct file changes.
- **Sync Generator requires both Repo Assembly and Unified Project Graph:** It reads repo locations (assembly) and project structure (graph) to generate tsconfig paths.
- **Multi-repo Git Status and Bulk Git Operations are independent:** They only need repo assembly. They don't depend on the Nx graph at all.

## MVP Definition

### Launch With (v1.0)

Minimum viable product -- what's needed to validate the core concept of "polyrepo feels like monorepo."

- [ ] **Repo assembly via git clone/pull** -- configured in `nx.json` plugin options (repo URL, branch, target directory). Without this, nothing else works.
- [ ] **Unified project graph via createNodesV2** -- external repo projects appear in `nx graph`. This is the proof of concept.
- [ ] **Project namespacing** -- prefix external projects with repo name to avoid collisions. Must be built in from the start.
- [ ] **Cross-repo dependency detection from package.json** -- auto-detect edges so `nx graph` shows real relationships.
- [ ] **Affected analysis across repos** -- `nx affected` works across repo boundaries. This is what makes the tool useful beyond visualization.
- [ ] **Multi-repo git status** -- combined status view across synced repos. Quick win, high DX value.

### Add After Validation (v1.x)

Features to add once core is working and users provide feedback.

- [ ] **Bulk git operations (pull, fetch, checkout)** -- triggered by user demand for multi-repo coordination
- [ ] **Explicit cross-repo dependency overrides** -- triggered by users with non-npm dependencies (APIs, services)
- [ ] **Stale repo detection** -- triggered by "works on my machine" reports from teams
- [ ] **Selective repo assembly (profiles/groups)** -- triggered by teams with many repos where not everyone needs everything
- [ ] **Sync generator for tsconfig paths** -- triggered by TypeScript users wanting cross-repo imports without manual config

### Future Consideration (v2+)

Features to defer until product-market fit is established.

- [ ] **Non-Nx repo support** -- requires inferring project graphs from arbitrary repo structures. Wait for demand.
- [ ] **Cross-repo conformance rules** -- Polygraph territory. Only if users need organizational-level standards.
- [ ] **Watch mode across repos** -- file watching across multiple repo directories. Complex and potentially resource-heavy.
- [ ] **Custom workspace visualization** -- enhanced graph views showing repo boundaries, ownership. Wait for `nx graph` limitations to surface.

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Repo assembly (clone/pull) | HIGH | MEDIUM | P1 |
| Unified project graph (createNodesV2) | HIGH | HIGH | P1 |
| Project namespacing | HIGH | MEDIUM | P1 |
| Cross-repo dep detection (package.json) | HIGH | MEDIUM | P1 |
| Affected analysis across repos | HIGH | HIGH | P1 |
| Multi-repo git status | MEDIUM | LOW | P1 |
| Bulk git operations | MEDIUM | LOW | P2 |
| Explicit dependency overrides | MEDIUM | LOW | P2 |
| Stale repo detection | MEDIUM | LOW | P2 |
| Selective repo assembly | MEDIUM | LOW | P2 |
| Sync generator (tsconfig paths) | MEDIUM | MEDIUM | P2 |
| Cross-repo task orchestration awareness | HIGH | MEDIUM | P1 |
| Non-Nx repo support | LOW | HIGH | P3 |

**Priority key:**
- P1: Must have for launch -- without these the plugin doesn't deliver its core value
- P2: Should have, add when possible -- these improve DX significantly
- P3: Nice to have, future consideration

## Competitor Feature Analysis

| Feature | meta | mu-repo | Nx Polygraph | git-multi / myrepos | Our Approach (nx-openpolyrepo) |
|---------|------|---------|--------------|---------------------|-------------------------------|
| Repo assembly | `.meta` JSON file, `meta git clone` | `.mu_repo` file, `mu register` | N/A (Nx Cloud manages) | Manual config files | `nx.json` plugin options, git clone/pull on demand |
| Unified dependency graph | None | None | Workspace Graph (Nx Cloud UI) | None | Nx project graph plugin (createNodesV2 + createDependencies) |
| Cross-repo dep detection | None (just runs commands) | None | Auto via Nx Cloud metadata | None | package.json analysis + explicit overrides |
| Affected analysis | None | None | Yes (via Nx Cloud) | None | Nx-native `nx affected` (works automatically with correct graph) |
| Multi-repo git commands | `meta git <cmd>` (full git wrapper) | `mu <cmd>` (parallel by default) | None | `git multi <cmd>`, `mr <cmd>` | Nx executor or standalone commands |
| Plugin/extension system | Node module plugins (`meta-*`) | None | Nx Cloud features | None | Nx plugin architecture (composable with other Nx plugins) |
| Parallel execution | Yes | Yes (configurable serial/parallel) | Yes (Nx DTE) | myrepos: `mr -j5` | Yes (Nx parallel task execution) |
| Project namespacing | None (repos are independent) | None | Workspace-level separation | None | Repo name prefix on project names |
| CI/CD integration | None built-in | None built-in | Deep (Nx Cloud CI) | None | `nx sync:check` in CI, `nx affected` for selective builds |
| Cost | Free (MIT) | Free (MIT) | Nx Enterprise license | Free | Free (MIT) |
| Nx integration | None | None | Native (IS Nx Cloud) | None | Native Nx plugin |

## Sources

- [meta - GitHub](https://github.com/mateodelnorte/meta) -- multi-repo management tool with plugin system
- [mu-repo](https://fabioz.github.io/mu-repo/) -- parallel git command execution across repos
- [Nx Polygraph introduction](https://nx.dev/blog/nx-cloud-introducing-polygraph) -- enterprise synthetic monorepo features
- [Nx Polygraph docs](https://nx.dev/docs/enterprise/polygraph) -- Workspace Graph, Conformance Rules, Custom Workflows
- [Nx Project Graph Plugins](https://nx.dev/docs/extending-nx/project-graph-plugins) -- createNodesV2 and createDependencies API
- [Nx Sync Generators](https://nx.dev/docs/concepts/sync-generators) -- sync generator API for file system updates from graph
- [git-multi - GitHub](https://github.com/pvdb/git-multi) -- execute git commands across repos
- [myrepos](https://myrepos.branchable.com/) -- multi-VCS repo management
- [monorepo.tools](https://monorepo.tools/) -- monorepo tool comparison
- [Rush](https://rushjs.io/) -- Microsoft's monorepo tool with affected analysis and dependency graph

---
*Feature research for: Synthetic monorepo Nx plugin (polyrepo management)*
*Researched: 2026-03-10*
