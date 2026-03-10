# Pitfalls Research

**Domain:** Nx plugin for synthetic monorepo / polyrepo graph merging
**Researched:** 2026-03-10
**Confidence:** MEDIUM-HIGH (verified against Nx docs + GitHub issues, some areas extrapolated from related projects)

## Critical Pitfalls

### Pitfall 1: Project Name Collisions Across Repos Silently Merge Instead of Erroring

**What goes wrong:**
Nx identifies project nodes as "the same project" when they share the same root path. But in a synthetic monorepo, projects from different repos will have different roots. The real collision risk is project **names** -- if two repos both have a project called `shared-utils`, Nx will treat them as separate projects (different roots) but commands referencing `shared-utils` by name become ambiguous. Nx uses the first match, silently ignoring the second. Users run `nx build shared-utils` and get the wrong project built with no warning.

**Why it happens:**
Nx's project graph is keyed by root path internally, but CLI resolution uses project names. The plugin author assumes root-path uniqueness prevents conflicts, forgetting that name-based resolution is what users interact with.

**How to avoid:**
Namespace all external repo projects with a repo-name prefix (e.g., `repo-a/shared-utils`, `repo-b/shared-utils`). The PROJECT.md already specifies this, but implementation must be watertight: apply prefixing at `createNodesV2` time before projects enter the graph, not as a post-processing step. Validate uniqueness and emit a clear error with both project locations when collisions occur.

**Warning signs:**
- `nx show projects` shows fewer projects than expected
- Running a target on a project builds files from an unexpected repo
- Users report "my changes aren't being picked up" when the wrong project is resolved

**Phase to address:**
Phase 1 (core graph plugin) -- namespacing must be built into the graph merging from day one, not bolted on later.

---

### Pitfall 2: Plugin Execution Performance Kills Developer Experience

**What goes wrong:**
`createNodesV2` is called during every graph computation. If the plugin shells out to child Nx workspaces (running `nx graph --json` in each repo) synchronously, graph computation can take 30-120+ seconds. The Nx daemon has a 10-minute timeout for plugin execution ([GitHub #32788](https://github.com/nrwl/nx/issues/32788)), but even 10 seconds destroys DX since `nx affected`, `nx graph`, and every task run depend on the graph.

**Why it happens:**
The naive implementation is: for each assembled repo, spawn `nx graph` or `nx show projects --json`, parse the result, merge. Each spawn bootstraps Node.js, loads Nx, reads that repo's `nx.json`, runs its plugins, and computes its graph. This is inherently expensive, multiplied by repo count.

**How to avoid:**
- Cache assembled repo graphs aggressively. Use file hashes (lockfile + nx.json + project.json files) as cache keys. Only recompute a repo's graph when its files change.
- Consider reading the Nx project graph cache file (`.nx/cache/d/file-map.json` or similar) from each repo rather than spawning a full `nx graph` process.
- Process repos in parallel, not sequentially.
- Set `NX_PERF_LOGGING=true` during development to measure plugin time contribution.

**Warning signs:**
- `NX_PERF_LOGGING=true` shows your plugin taking >2 seconds
- Users disable the plugin during normal development
- CI times spike after adding the plugin

**Phase to address:**
Phase 1 (core graph plugin) -- performance architecture must be baked in from the start. Retrofitting caching into a naive implementation is a rewrite.

---

### Pitfall 3: External Node (npm dependency) Conflicts Across Repos with Different Versions

**What goes wrong:**
Each Nx workspace has its own `externalNodes` representing npm packages. When merging graphs, repo-a may have `npm:react@18.2.0` and repo-b may have `npm:react@19.0.0`. External nodes with the same name are **overwritten, not merged** -- the last plugin to register the node wins. This silently breaks dependency edges for the repo whose version was overwritten, and can cause `nx affected` to miss projects or produce incorrect dependency chains.

**Why it happens:**
Nx's documented behavior: "External nodes are identified by a unique name, and if plugins identify an external node with the same name, the external node will be overwritten." Most plugin authors don't think about this because within a single workspace, npm packages have one resolved version.

**How to avoid:**
- Scope external nodes per repo: instead of `npm:react`, register `npm:repo-a/react@18.2.0` and `npm:repo-b/react@19.0.0`.
- Alternatively, if the goal is to show cross-repo dependency edges via shared npm packages, detect version mismatches and emit a warning but pick the union (keep both as separate external nodes with version-qualified names).
- Document the version-mismatch behavior clearly so users understand what the graph shows.

**Warning signs:**
- `nx graph` shows fewer external dependency nodes than expected
- Dependency edges disappear when a second repo is added
- `nx affected` misses projects that should be affected by a package update

**Phase to address:**
Phase 1 (core graph plugin) -- external node handling is part of graph merging fundamentals.

---

### Pitfall 4: Nx Version Incompatibility Between Repos

**What goes wrong:**
The plugin runs inside the host workspace's Nx runtime (v22.x). Assembled repos may run Nx 20, 21, or a future 23. The project graph JSON format, plugin API, and even the project configuration schema can differ across major versions. Attempting to load or parse a repo's graph that was computed with a different Nx version produces cryptic errors or silently wrong data.

**Why it happens:**
The `createNodesV2` API itself changed between Nx 19 and 22. Project configuration fields, target defaults behavior, and graph cache formats evolve with each major version. The plugin author tests against their own Nx version and doesn't encounter the mismatch.

**How to avoid:**
- Don't import or require Nx internals from assembled repos. Instead, invoke the repo's own `nx` binary (from its `node_modules/.bin/nx`) to produce a graph JSON, which is a more stable public API surface.
- Detect each repo's Nx version early (read `nx` version from `node_modules/nx/package.json`). Define a supported version range (e.g., Nx >=20 <24). Emit a clear error for unsupported versions.
- For graph JSON format differences, maintain lightweight adapters per major version that normalize the output into a common internal format.

**Warning signs:**
- Tests pass with all repos on the same Nx version but fail when mixing versions
- Users report "plugin stopped working after upgrading one repo"
- JSON parsing errors referencing unexpected fields

**Phase to address:**
Phase 1 (core graph plugin) -- version detection and validation should be the first thing the plugin does when processing a repo. Adapter layer can be minimal initially (support only Nx 22.x) but the abstraction must exist.

---

### Pitfall 5: Git Operations Fail Silently on Windows Due to Path Length and Permission Issues

**What goes wrong:**
Windows has a 260-character MAX_PATH limit. Cloning repos into a subdirectory of the workspace (e.g., `.nx-openpolyrepo/repos/my-long-org-name/my-long-repo-name/packages/deeply-nested-lib/src/components/`) easily exceeds this. Git operations fail with cryptic "filename too long" errors. Additionally, some Windows environments require administrator privileges for symlinks, which some Nx operations use.

**Why it happens:**
The developer builds and tests on macOS/Linux where path lengths are effectively unlimited. Windows is an afterthought, tested only in CI if at all.

**How to avoid:**
- Clone repos into a short base path (e.g., `.repos/` at workspace root, with short directory names derived from repo config key, not full URL).
- Automatically set `core.longpaths=true` on cloned repos.
- Detect platform at startup and warn if the workspace root path is already deep (>100 chars).
- Never use symlinks for repo assembly -- use direct paths. The PROJECT.md already decided on git clone/pull, which is correct.
- Test on Windows in CI from day one.

**Warning signs:**
- "filename too long" errors only on Windows
- CI passes on Linux but fails on Windows
- Users report issues only when workspace is in a deep directory

**Phase to address:**
Phase 1 (repo assembly) -- path strategy is a foundational design decision. Changing clone locations later breaks all existing user setups.

---

### Pitfall 6: Stale Repo State Produces Incorrect Graphs

**What goes wrong:**
Assembled repos are cloned/pulled at some point in time. If the user doesn't re-pull, the local clone diverges from the remote. The project graph shows stale projects, missing new projects, or incorrect dependency edges. Worse, `nx affected` may miss affected projects because it compares against a stale baseline.

**Why it happens:**
The plugin clones repos during initial setup but has no mechanism to keep them fresh. Users forget to run the sync command, or don't realize their graph is stale.

**How to avoid:**
- Implement an Nx sync generator that checks repo freshness (compare local HEAD with remote HEAD via `git fetch --dry-run` or `git remote show origin`).
- Display repo staleness in `nx graph` visualization or CLI output.
- Support a `--fetch` flag on graph computation that does a quick `git fetch` for all repos before graph merging.
- Never auto-pull without user consent -- force-pulling can discard local changes in assembled repos.

**Warning signs:**
- Users say "I added a new project in repo-b but it doesn't show up"
- `nx affected` misses projects that changed in remote repos
- Graph visualization looks different on different developers' machines

**Phase to address:**
Phase 2 (repo assembly DX) -- initial clone happens in Phase 1, but freshness checking is a DX concern for Phase 2.

---

### Pitfall 7: createNodesV2 Daemon Caching Masks Plugin Bugs During Development

**What goes wrong:**
The Nx daemon caches plugin code and the project graph. During development, changes to plugin source code are not reflected until the daemon restarts. The developer thinks their code change had no effect, adds more changes, then when the daemon finally restarts everything breaks in confusing ways.

**Why it happens:**
Nx caches aggressively for performance. The daemon watches workspace files but may not watch plugin source files from `node_modules` or linked packages.

**How to avoid:**
- Document `NX_DAEMON=false` as **required** during plugin development in CONTRIBUTING.md.
- Add a development script: `NX_DAEMON=false NX_CACHE_PROJECT_GRAPH=false nx graph`.
- Consider adding `NX_DAEMON=false` to the workspace `.env` during development and removing it for release testing.
- Add integration tests that run with daemon disabled to catch issues early.

**Warning signs:**
- "It works sometimes" / inconsistent behavior
- Plugin changes seem to have no effect
- Running `nx reset` fixes the problem temporarily

**Phase to address:**
Phase 1 (initial plugin development) -- this is a development workflow concern, not a runtime concern. Establish the pattern immediately.

---

### Pitfall 8: Cross-Repo Dependency Detection Produces False Positives and Negatives

**What goes wrong:**
Auto-detecting cross-repo dependencies via `package.json` imports sounds simple but has edge cases: (1) A package name in repo-a's `package.json` matches a project in repo-b, but it's actually an npm package with the same name, not the repo-b project. (2) Repo-a imports repo-b code via TypeScript path aliases or custom resolution, but there's no `package.json` dependency, so the edge is missed. (3) A repo depends on a published version of another repo's package, not the source -- should this be a graph edge or not?

**Why it happens:**
Package names are not globally unique in the context of private packages. The plugin uses string matching without understanding the full dependency resolution chain.

**How to avoid:**
- Use a multi-signal approach: `package.json` dependencies + optional explicit overrides in plugin config.
- For auto-detection, require that cross-repo dependencies match both the package name AND that the package is not found in the npm registry (or is found but matches the repo's package). This is complex -- start with explicit config and add auto-detection as an enhancement.
- Always allow manual override: `crossRepoDependencies: { "project-a": ["repo-b/project-c"] }` in plugin options.
- Emit warnings for ambiguous matches rather than silently creating edges.

**Warning signs:**
- `nx graph` shows dependency edges that don't exist in reality
- `nx affected` rebuilds too many or too few projects
- Users are confused about why projects are linked

**Phase to address:**
Phase 2 (dependency detection) -- basic explicit wiring in Phase 1, auto-detection with disambiguation in Phase 2.

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Shell out to `nx graph` per repo instead of reading graph cache | Simple implementation, uses stable CLI API | 5-30 seconds per repo per graph computation, unusable at scale | MVP only, must be replaced before release |
| Skip external node deduplication | Fewer edge cases to handle | Incorrect dependency edges, broken `affected` command | Never -- at minimum, log warnings on conflicts |
| Hardcode Nx 22.x graph format | Faster initial development | Plugin breaks when any assembled repo upgrades to Nx 23 | MVP only, with version detection that errors on unsupported versions |
| Clone full repos instead of shallow/sparse | Simpler git operations | Disk space explosion with large repos, slow initial setup | Acceptable for v1 with an option to enable shallow clone later |
| Synchronous repo processing | Simpler control flow | Graph computation time scales linearly with repo count | Never -- parallel processing is straightforward with `Promise.all` |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Nx daemon | Testing with daemon enabled, masking stale cache | Always develop with `NX_DAEMON=false` |
| Nx built-in plugins | Custom plugin settings overwritten by built-in plugins (they run last) | Understand plugin ordering: user plugins run first, built-in plugins can overwrite |
| Nx sync generators | Blocking task execution with expensive sync checks | Make sync generator check lightweight (compare hashes, not full graph recomputation) |
| Git operations | Using `child_process.execSync` for git commands | Use `child_process.execFile` or `execa` with proper error handling, timeout, and signal handling |
| npm/yarn/pnpm lockfiles | Assuming one lockfile format across all repos | Detect package manager per repo (`packageManager` field in `package.json` or lockfile presence) |
| Nx project graph cache | Reading internal `.nx/` cache files whose format is undocumented | Prefer `nx graph --file=output.json` CLI output which is a more stable API surface |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Spawning `nx graph` per repo on every graph computation | 5-30s per repo, every Nx command slow | Cache repo graphs, invalidate on file changes only | >2 repos |
| Scanning all files in assembled repos for dependency detection | Plugin takes minutes in large repos | Use `package.json` only, not source file scanning | >1000 files per repo |
| Cloning full git history | Initial setup takes minutes per repo | Default to `--depth=1` shallow clone, with option for full history | Repos with >10k commits |
| Re-fetching repos on every graph computation | Network I/O on every Nx command | Fetch only on explicit sync command or when cache is stale | Always, even with fast network |
| Not parallelizing repo processing | Linear scaling: 5 repos = 5x time | `Promise.all` for independent repo operations | >1 repo |
| Reading all project files into memory | Memory pressure with large repos | Stream/iterate, only load project.json and package.json | >50 projects per repo |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Storing git credentials in plugin config | Credential exposure in committed nx.json | Use git credential helpers, SSH keys, or environment variables. Plugin config should only reference repo URLs, not credentials |
| Cloning arbitrary repos specified in config | Supply chain attack -- malicious repo could contain Nx plugins that execute code during graph computation | Validate repo URLs against an allowlist, warn on first clone of new repos, never auto-install dependencies in assembled repos |
| Running assembled repo's Nx plugins in the host process | Malicious plugin code execution in the host workspace | Run graph computation for assembled repos in isolated processes (consider `NX_ISOLATE_PLUGINS=true` behavior) |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| No progress feedback during repo clone/fetch | User thinks tool is frozen during multi-minute clone | Show per-repo progress with streaming git output |
| Cryptic Nx error when assembled repo has broken graph | User sees internal Nx error, doesn't know which repo caused it | Catch errors per-repo, report "Repo X failed graph computation: [reason]" |
| Requiring manual `nx reset` after config changes | Breaks developer flow, erodes trust in the tool | Detect config changes and auto-invalidate graph cache |
| Silent fallback when a repo URL is unreachable | User doesn't notice a repo is missing from the graph | Error by default, with `--skip-unavailable` flag for CI resilience |
| Namespace prefixes make project names long and awkward | `my-org-repo-a/shared-utils` is verbose for daily use | Allow short aliases in config: `{ "repo": "...", "prefix": "a" }` |

## "Looks Done But Isn't" Checklist

- [ ] **Graph merging:** Often missing external node conflict resolution -- verify that two repos with different React versions produce a correct graph
- [ ] **Repo assembly:** Often missing cleanup of repos removed from config -- verify that removing a repo from config also removes its projects from the graph
- [ ] **Cross-repo dependencies:** Often missing bidirectional edge support -- verify that circular cross-repo dependencies don't crash the graph
- [ ] **Windows support:** Often missing long path handling -- verify cloning into a deep workspace directory on Windows works
- [ ] **Error messages:** Often missing repo context in errors -- verify that every error message identifies which assembled repo caused it
- [ ] **Nx affected:** Often missing cross-repo change detection -- verify that a change in repo-b triggers affected projects in repo-a that depend on it
- [ ] **Plugin options schema:** Often missing JSON schema validation -- verify that invalid config in nx.json produces a helpful error, not a runtime crash

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Project name collision | LOW | Add namespacing, re-run graph computation. No data loss. |
| Performance regression | MEDIUM | Requires architectural change to add caching layer. May need to change how repo graphs are obtained. |
| External node version conflict | LOW | Add version-scoped external node names. Requires graph recomputation. |
| Nx version incompatibility | MEDIUM | Add version adapter layer. Requires understanding both graph formats. |
| Windows path length failure | LOW | Shorten clone paths, enable `core.longpaths`. May require users to re-clone. |
| Stale repo graph | LOW | Run sync/fetch. No code changes needed if sync mechanism exists. |
| False dependency edges | MEDIUM | Requires redesigning detection heuristic. May break users' existing explicit overrides. |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Project name collisions | Phase 1: Core graph plugin | `nx show projects` shows all projects with unique names from all repos |
| Plugin performance | Phase 1: Core graph plugin | `NX_PERF_LOGGING=true` shows plugin <2s for 5 repos |
| External node conflicts | Phase 1: Core graph plugin | `nx graph` with two repos using different React versions shows both |
| Nx version incompatibility | Phase 1: Core graph plugin | Plugin emits clear error when assembled repo uses unsupported Nx version |
| Windows path issues | Phase 1: Repo assembly | CI matrix includes Windows, cloning works in a 150+ char workspace path |
| Stale repo state | Phase 2: Repo assembly DX | Sync generator detects and reports stale repos |
| Cross-repo false deps | Phase 2: Dependency detection | Manual override + auto-detection with disambiguation warnings |
| Daemon caching during dev | Phase 1: Developer setup | CONTRIBUTING.md documents required env vars, npm scripts include them |

## Sources

- [Extending the Project Graph | Nx](https://nx.dev/docs/extending-nx/project-graph-plugins) -- official plugin API docs (HIGH confidence)
- [CreateNodes Compatibility | Nx](https://nx.dev/docs/extending-nx/createnodes-compatibility) -- v1 to v2 migration (HIGH confidence)
- [Sync Generators | Nx](https://nx.dev/docs/concepts/sync-generators) -- sync generator concepts (HIGH confidence)
- [GitHub #26297: Slow CLI with local plugins](https://github.com/nrwl/nx/issues/26297) -- performance issues (HIGH confidence)
- [GitHub #29503: createNodesV2 crashes project graph](https://github.com/nrwl/nx/issues/29503) -- daemon caching bug (HIGH confidence)
- [GitHub #32788: CI hanging at creating project graph](https://github.com/nrwl/nx/issues/32788) -- plugin timeout (HIGH confidence)
- [GitHub #19520: External dependencies missing on Windows](https://github.com/nrwl/nx/issues/19520) -- Windows external nodes bug (HIGH confidence)
- [GitHub #33582: prune-lockfile excludes transitive deps](https://github.com/nrwl/nx/issues/33582) -- name vs root keying bug (MEDIUM confidence)
- [5 Hurdles of Multi-Repo Management | GitKraken](https://www.gitkraken.com/blog/multi-repo-management-hurdles-and-solutions) -- polyrepo DX patterns (MEDIUM confidence)
- [mu-repo documentation](https://fabioz.github.io/mu-repo/) -- multi-repo tool patterns (MEDIUM confidence)

---
*Pitfalls research for: Nx plugin for synthetic monorepo / polyrepo graph merging*
*Researched: 2026-03-10*
