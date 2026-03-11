# Phase 2: Unified Project Graph - Context

**Gathered:** 2026-03-11
**Status:** Ready for planning

<domain>
## Phase Boundary

External repo projects appear in the unified Nx project graph with proper namespacing and fast cached extraction. Users can run `nx graph`, `nx show projects`, `nx run-many`, and `nx affected` and see projects from all synced repos alongside host workspace projects. Cross-repo dependency wiring and sync generators are out of scope (v2).

</domain>

<decisions>
## Implementation Decisions

### Target executability
- **Proxy targets** that shell out to Nx inside each repo — not view-only stubs, not fully re-implemented targets
- Inspired by @nx/gradle, @nx/maven, @nx/dotnet pattern: external tool is Nx itself
- **All discovered targets proxied** — every target from external repo's graph gets a proxy
- **Inferred targets via createNodesV2** — external projects registered with `executor: "@op-nx/polyrepo:run"`, same pattern as @nx/gradle registering `executor: "@nx/gradle:gradle"`
- **Host Nx owns task caching** — targets registered with inputs/outputs from external graph, Nx caches natively
- **Transparent passthrough** output — small `[polyrepo]` header, then stream child Nx output
- **Passthrough exit code** — child failure = proxy failure, no wrapping
- **Included in run-many/affected by default** — external projects are first-class citizens, exclude with `--exclude=repo-b/*`
- **Inputs/outputs copied from external graph** — extracted target configs include inputs/outputs, carried over to proxy registration
- **Lazy extraction in createNodesV2** — follow @nx/gradle pattern, NOT during sync. Uses PluginCache + hash-based invalidation. Sync stays git-only
- **Two-layer cache invalidation**:
  - Outer gate: git HEAD SHA + `git diff --name-only HEAD` + pluginOptions hash (~15ms per repo)
  - Inner gate: child Nx's own PluginCache (if outer gate fires false positive, child Nx returns from its cache in ~1-2s instead of full ~4s extraction)
- **`nx graph --print` for extraction** — captures stdout as JSON, stores in PluginCache at `.nx/workspace-data/`. Verified on nrwl/nx: 149 projects, ~7.9s, 1.4MB output. Typical 20-30 project repo: ~2-4s
- **Parallel extraction** across repos using Promise.all
- **Warn and skip unsynced repos** — carry from Phase 1. Grouped warning listing all unsynced repos, shown once per Nx command
- **Repo's own nx binary** — use each repo's `node_modules/.bin/nx` (or `npm exec nx`). Researcher to verify best invocation method
- **polyrepo-sync extended** to include `npm install` / `pnpm install` / `yarn` after clone/pull for ALL repos (remote and local path)
- **runCommandsImpl** from `nx/src/executors/run-commands/run-commands.impl` — same as @nx/gradle
- **Forward __unparsed__ args** to child Nx process — users can pass `-- --watch --coverage` etc.

### Graph completeness
- **Full intra-repo dependency edges** — if repo-b has `my-app -> my-lib -> utils`, those appear in host graph as `repo-b/my-app -> repo-b/my-lib -> repo-b/utils`. Uses createDependencies hook
- **Preserve all tags, metadata, projectType, sourceRoot** — carried over from external graph. Enables `nx show projects --type=lib`, tag filtering, etc.
- **Auto-add tags** — `polyrepo:external` and `polyrepo:<repo-alias>` tags on all external projects. Enables programmatic filtering
- **`/` namespace separator** — confirmed, matching GRPH-03. Works with `nx run repo-b/my-lib:build` (Nx splits on last `:`)
- **Module-level variable** for sharing data between createNodesV2 and createDependencies — same as @nx/gradle and @nx/maven. Gradle's defensive pattern (re-check cache in createDependencies)

### Cache freshness
- Lazy extraction in createNodesV2 (not during sync)
- Git HEAD + dirty state as outer cache gate
- Child Nx PluginCache as inner gate
- PluginCache, hashObject, hashArray from Nx utilities
- Graph extraction via `nx graph --print`

### Collision handling
- **Host-vs-external collision**: Nx core handles it — follows @nx/gradle, @nx/maven, @nx/dotnet pattern. Zero collision code in plugin. `MultipleProjectsWithSameNameError` fires with both roots listed. 100% correct, ~15ms (already paid during Nx merge step). Approximate pre-check via glob was benchmarked at ~150ms per Nx command with only ~95% correctness — rejected on performance and correctness grounds
- **Duplicate repo URL in config**: Hard error at config validation time. Full git URL normalization (strip .git suffix, normalize SSH/HTTPS/git:// protocols, lowercase host). For path-based repos, shell out to `git remote get-url origin` to get remote URL, then normalize. If remote lookup fails, fall back to resolved absolute path comparison. Implemented via zod `.refine()`. Prefer zod when possible
- **Cross-repo same alias**: Prevented by design — alias is the JSON map key, duplicates impossible
- **Error batching**: Nx core already batches all collisions in one `MultipleProjectsWithSameNameError`
- **Configurable namespace separator as escape hatch**: The `@op-nx/polyrepo` plugin joins repo alias + project name with `/` (e.g., `repo-b/my-lib`). If `/` causes collisions with host project names, the separator could be made configurable (e.g., `--`, `::`) in plugin options in a future version

### Nx utilities verified
Available and usable:
- `PluginCache` from `nx/src/devkit-internals` — LRU cache with disk persistence
- `hashObject` / `hashArray` from `nx/src/devkit-internals` / `@nx/devkit`
- `workspaceDataDirectory` from `nx/src/utils/cache-directory`
- `readJsonFile` / `writeJsonFile` from `@nx/devkit`

NOT usable for .repos/ content:
- `calculateHashForCreateNodes` — uses hashWithWorkspaceContext tied to host workspace context (Rust native WorkspaceContext), .repos/ is gitignored = invisible
- `hashWithWorkspaceContext` — same limitation, single global context, reinitializing would disrupt host

### Claude's Discretion
- Exact structure of the `@op-nx/polyrepo:run` executor implementation
- PluginCache key format and serialization details
- Git dirty-state check implementation specifics
- Graph JSON parsing and transformation internals
- Error message formatting details

</decisions>

<specifics>
## Specific Ideas

- User explicitly prioritizes: 1. Correctness, 2. Scalability, 3. Performance
- Follow @nx/gradle, @nx/maven, @nx/dotnet source code patterns wherever applicable — the nrwl/nx repo is available locally at d:/projects/github/nrwl/nx for reference
- Use `npm exec` over `npx` for invoking Nx in child repos
- Install deps for ALL repos during sync (including local path repos)
- Both namespace prefix AND auto-tags for external project identification
- Add-repo generator that auto-runs polyrepo-sync — deferred idea for later

### Benchmarks verified on nrwl/nx (149 projects)
- `nx graph --file=output.json`: 10.7s, 1.4MB (688KB nodes + 32KB deps)
- `nx graph --print`: 7.9s, 1.4MB (stdout, no file I/O)
- `nx show project nx --json`: 2.8s (one project — O(N) for all = terrible)
- `nx show projects --json`: array of names only, no targets
- Graph JSON structure: `{ graph: { nodes: { [name]: { name, type, data: { root, targets, tags, metadata, ... } } }, dependencies: { [name]: [{ source, target, type }] } } }`
- Each target includes: executor, options, inputs, outputs, cache, dependsOn, configurations, parallelism, metadata

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `configSchema` (zod): Existing config validation from Phase 1 — extend with duplicate URL `.refine()` and git URL normalization
- `git.ts` wrappers: Existing git command wrappers from Phase 1 — reuse for `git remote get-url origin` in config validation
- `polyrepo-sync` executor: Existing clone/pull logic — extend to include dependency installation after sync
- `polyrepo-status` executor: Existing status command — potential future home for collision diagnostics

### Established Patterns
- Executor pattern: Phase 1 established `@op-nx/polyrepo:sync` and `@op-nx/polyrepo:status` executors with `Record<string, never>` for empty options
- Config loading: `readFileSync` to read nx.json directly (not `readNxJson` which requires Tree)
- Module resolution: `node16` moduleResolution in plugin tsconfig for Nx executor runtime compatibility
- Testing: Vitest with `@nx/vitest:test` executor, `maxWorkers: 1` for serial execution

### Integration Points
- `createNodesV2` entry point: Already exists from Phase 1 — extend to register external projects
- `createDependencies` hook: New — add for intra-repo dependency edges
- `nx.json` plugin options: Already has repos config — graph extraction reads from same config
- `.repos/` directory: Already created by sync — graph extraction reads from synced repos here

</code_context>

<deferred>
## Deferred Ideas

- **Configurable namespace separator** — the repo-alias/project-name separator is currently `/`. If it causes collisions, make it configurable in plugin options (e.g., `--`, `::`, or custom). Not needed now since host projects rarely use `/` in names
- **Add-repo generator** that auto-runs polyrepo-sync — convenience feature for onboarding repos
- **Cross-repo dependency auto-detection** from package.json — Phase 2 scope covers intra-repo edges only, cross-repo deps are v2
- **Nx sync generators** for keeping synced workspace in sync — evaluate during later phases

</deferred>

---

*Phase: 02-unified-project-graph*
*Context gathered: 2026-03-11*
