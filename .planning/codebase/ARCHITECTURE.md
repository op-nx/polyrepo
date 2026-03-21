# Architecture

**Analysis Date:** 2026-03-22

## Pattern Overview

**Overall:** Nx Plugin — event-driven graph extension with proxy executor delegation

**Key Characteristics:**
- Plugin registers with Nx via `createNodesV2` and `createDependencies` hooks in `packages/op-nx-polyrepo/src/index.ts`
- External repos are cloned/referenced at `.repos/<alias>/` and projected as namespaced virtual projects into the host Nx graph
- All external project targets are replaced with `@op-nx/polyrepo:run` proxy targets that delegate execution back into the child repo
- Three-layer cache (module-level in-memory → per-repo disk JSON → live `nx graph --print` extraction) isolates per-repo invalidation
- Zod is used for all schema validation at config ingestion and graph JSON parsing boundaries

## Layers

**Plugin Entry Point:**
- Purpose: Implements the two Nx graph extension contracts
- Location: `packages/op-nx-polyrepo/src/index.ts`
- Contains: `createNodesV2` (project node registration), `createDependencies` (dependency edge emission), `ensureTargetDefaultsShield` (one-time nx.json mutation)
- Depends on: config layer, graph layer
- Used by: Nx daemon / graph computation pipeline

**Config Layer:**
- Purpose: Schema definition, validation, normalization of plugin options from `nx.json`
- Location: `packages/op-nx-polyrepo/src/lib/config/`
- Contains: `schema.ts` (Zod schemas, `PolyrepoConfig`, `NormalizedRepoEntry`, `normalizeRepos`), `validate.ts` (runtime validation, gitignore/unsynced warnings), `resolve.ts` (reads plugin options directly from `nx.json` for use inside executors)
- Depends on: git patterns
- Used by: plugin entry point, all three executors

**Graph Layer:**
- Purpose: Extract, transform, cache, and detect cross-repo dependency data
- Location: `packages/op-nx-polyrepo/src/lib/graph/`
- Contains: `extract.ts` (spawns `nx graph --print` in child repo), `transform.ts` (namespaces project names/roots, rewrites targets as proxies, injects auto-tags), `cache.ts` (three-layer cache, hash computation, exponential backoff on failure), `detect.ts` (cross-repo dependency detection via package.json + tsconfig paths), `types.ts` (Zod schema for external graph JSON, `TransformedNode`, `PolyrepoGraphReport`)
- Depends on: config layer, git layer
- Used by: plugin entry point, sync executor

**Git Layer:**
- Purpose: All git operations and repo state detection
- Location: `packages/op-nx-polyrepo/src/lib/git/`
- Contains: `commands.ts` (clone, pull, fetch, rebase, ff-only, checkout, fetch-tag via `execFile('git', ...)`), `detect.ts` (repo state, HEAD SHA, dirty files, ahead/behind, working tree state), `normalize-url.ts` (git URL canonicalization), `patterns.ts` (git URL regex)
- Depends on: nothing internal
- Used by: config layer (URL validation), graph cache layer (hash inputs), all three executors

**Executors:**
- Purpose: Three user-facing Nx targets
- Location: `packages/op-nx-polyrepo/src/lib/executors/`
- Contains:
  - `sync/executor.ts` — clones or pulls each configured repo, installs deps (auto-detects npm/pnpm/yarn/corepack), pre-caches graph, writes lockfile hash sentinel
  - `status/executor.ts` — fetches all repos in parallel, reports branch/tag/dirty/ahead-behind/project-count per repo as an aligned table
  - `run/executor.ts` — proxy that delegates `nx run <project>:<target>` into the child repo via `runCommandsImpl`
- Depends on: config layer, git layer, graph layer, format layer
- Used by: Nx task runner (invoked by user or host project task graphs)

**Format Layer:**
- Purpose: Aligned table output for CLI display
- Location: `packages/op-nx-polyrepo/src/lib/format/table.ts`
- Contains: `formatAlignedTable(rows: ColumnDef[][])` — pads columns to uniform widths, joins with two-space separator
- Depends on: nothing
- Used by: sync executor, status executor

**Testing Utilities:**
- Purpose: Shared test helpers
- Location: `packages/op-nx-polyrepo/src/lib/testing/`
- Contains: `mock-child-process.ts` (typed `ChildProcess` mock factory built from `EventEmitter`), `asserts.ts` (`assertDefined<T>` type-narrowing assertion)
- Used by: unit tests only

## Data Flow

**Graph Registration (Nx daemon startup or `nx graph`):**

1. Nx calls `createNodesV2` with `nx.json` path and plugin options
2. `validateConfig` parses options via Zod → `PolyrepoConfig`
3. `ensureTargetDefaultsShield` adds `@op-nx/polyrepo:run: {}` to `nx.json` if absent (one-time write)
4. `populateGraphReport` checks three-layer cache; on miss, calls `extractGraphFromRepo` per repo
5. `extractGraphFromRepo` reads `.nx-graph-output.json` fast path or spawns `nx graph --print` in child repo
6. `transformGraphForRepo` namespaces project names (`<alias>/<name>`), rewrites roots (`.repos/<alias>/...`), replaces all targets with proxy configs, injects tags `polyrepo:external` and `polyrepo:<alias>`
7. `createNodesV2` emits `projects` map: root workspace gets `polyrepo-sync` + `polyrepo-status` targets; each transformed node becomes a host project
8. Nx calls `createDependencies`; intra-repo edges added as implicit dependencies; `detectCrossRepoDependencies` scans package.json deps + tsconfig path aliases to emit cross-repo edges

**Sync Executor (`nx polyrepo-sync`):**

1. `resolvePluginConfig` reads `nx.json` directly to get `PolyrepoConfig` + `NormalizedRepoEntry[]`
2. For each entry: detect state (`not-synced` / `cloned` / `referenced`) → clone or pull/fetch/rebase/ff-only
3. After git op: check lockfile hash sentinel → run `npm/pnpm/yarn install` if changed
4. After install: `extractGraphFromRepo` + `transformGraphForRepo` + `writePerRepoCache` to warm cache immediately

**Proxy Executor (`nx run <alias>/<project>:<target>`):**

1. Nx resolves the proxy target config (executor = `@op-nx/polyrepo:run`, options include `repoAlias`, `originalProject`, `targetName`)
2. `runExecutor` constructs `<repoPath>/node_modules/.bin/nx run <originalProject>:<targetName>` command
3. Delegates to `runCommandsImpl` from `nx/src/executors/run-commands/run-commands.impl` with child repo as cwd, isolated `TEMP`/`TMP`/`TMPDIR`, `NX_DAEMON=false`

**Cross-Repo Dependency Detection:**

1. Build `packageName → projectName` lookup from: external node `packageName` fields → host project `metadata.js.packageName` → tsconfig path aliases (external repos then host)
2. Build `projectName → repoAlias` reverse map; host projects use sentinel `__host__`
3. Scan every project's `dependencies`/`devDependencies`/`peerDependencies`; emit implicit edge when source and target are in different repos
4. Apply `implicitDependencies` config: negation patterns (`!pattern`) suppress auto-detected edges; positive patterns add override edges

## Key Abstractions

**PolyrepoGraphReport:**
- Purpose: Aggregate of all per-repo extracted and transformed graph data; the central in-memory + disk-cached structure
- Examples: `packages/op-nx-polyrepo/src/lib/graph/types.ts`
- Pattern: `{ repos: Record<alias, { nodes: Record<name, TransformedNode>; dependencies: Array<{source, target, type}> }> }`

**TransformedNode:**
- Purpose: A single external project as seen by the host workspace — namespaced name, rewritten root, proxy targets, injected tags, and extracted dep lists for cross-repo detection
- Examples: `packages/op-nx-polyrepo/src/lib/graph/types.ts`
- Pattern: Extends Nx `ProjectConfiguration` shape with additional `packageName`, `dependencies`, `devDependencies`, `peerDependencies` fields

**NormalizedRepoEntry:**
- Purpose: Unified discriminated union for remote vs. local repo config, with defaults applied
- Examples: `packages/op-nx-polyrepo/src/lib/config/schema.ts`
- Pattern: `{ type: 'remote'; alias; url; ref?; depth; disableHooks } | { type: 'local'; alias; path }`

**Three-Layer Cache:**
- Purpose: Minimize `nx graph --print` child process invocations (expensive due to JVM init in gradle repos)
- Examples: `packages/op-nx-polyrepo/src/lib/graph/cache.ts`
- Pattern: Module-level `Map` (survives daemon session) → per-repo `.repos/<alias>/.polyrepo-graph-cache.json` → live extraction with exponential backoff on failure

**Proxy Target:**
- Purpose: Replace every external project target with a uniform `@op-nx/polyrepo:run` executor entry that preserves `dependsOn`, `configurations`, `parallelism` from the original
- Examples: `packages/op-nx-polyrepo/src/lib/graph/transform.ts` (`createProxyTarget`)
- Pattern: `{ executor: '@op-nx/polyrepo:run', options: { repoAlias, originalProject, targetName }, inputs: [], cache: false, dependsOn: rewrittenDependsOn }`

## Entry Points

**`createNodesV2` (Nx plugin hook):**
- Location: `packages/op-nx-polyrepo/src/index.ts`
- Triggers: Nx project graph computation (daemon startup, `nx graph`, any `nx run`)
- Responsibilities: Validate config, ensure targetDefaults shield, populate graph report via cache, emit project nodes for root workspace and all external projects

**`createDependencies` (Nx plugin hook):**
- Location: `packages/op-nx-polyrepo/src/index.ts`
- Triggers: Nx dependency graph computation (same pipeline as `createNodesV2`)
- Responsibilities: Emit intra-repo implicit dependency edges; emit cross-repo edges via `detectCrossRepoDependencies`

**`syncExecutor` (Nx executor):**
- Location: `packages/op-nx-polyrepo/src/lib/executors/sync/executor.ts`
- Triggers: `nx polyrepo-sync` (or `nx run @op-nx/source:polyrepo-sync`)
- Responsibilities: Clone/update all configured repos, install dependencies, pre-cache graph

**`statusExecutor` (Nx executor):**
- Location: `packages/op-nx-polyrepo/src/lib/executors/status/executor.ts`
- Triggers: `nx polyrepo-status`
- Responsibilities: Fetch all repos, display aligned table of branch/dirty/ahead-behind/project-count per repo

**`runExecutor` (Nx proxy executor):**
- Location: `packages/op-nx-polyrepo/src/lib/executors/run/executor.ts`
- Triggers: Any `nx run <alias>/<project>:<target>` (resolved automatically via proxy target config)
- Responsibilities: Delegate target execution into the child repo's Nx workspace via `runCommandsImpl`

## Error Handling

**Strategy:** Defensive isolation — per-repo failures do not fail other repos; graph extraction failures degrade to missing projects (warning emitted), not hard crashes

**Patterns:**
- Graph extraction failures: caught in `createNodesV2`, logged as warnings; `populateGraphReport` uses exponential backoff (2s→4s→8s→16s→30s cap) per repo
- Config validation errors: thrown immediately via Zod `safeParse` rejection; cross-repo override validation (`OVRD-03`) intentionally propagates to surface user config errors
- Git command failures: `execFile` errors bubble up as `Error` with stderr text; `syncExecutor` catches per-repo and continues; `statusExecutor` continues past failed fetches
- Dependency install failures: logged as warnings, `installFailed` flag set in result; overall sync succeeds with warning
- Cache read/write: all wrapped in `try/catch`, non-fatal; in-memory cache remains valid

## Cross-Cutting Concerns

**Logging:** `@nx/devkit` `logger` (info/warn/error) used throughout; no custom log levels; all user-facing messages go through `logger`

**Validation:** Zod used at two boundaries — plugin config ingestion (`polyrepoConfigSchema`) and external graph JSON parsing (`externalGraphJsonSchema`); `.loose()` used on Zod objects to tolerate unknown fields

**Path normalization:** Every module that handles file paths calls a local `normalizePath(p) => p.replace(/\\/g, '/')` to ensure forward-slash paths on Windows; this pattern is duplicated across modules rather than centralized

**Windows compatibility:** `execFile('git', ...)` used for git ops (avoids `.cmd` shim issue); `exec(commandString)` used for `nx graph --print` (`.cmd` shim requires shell); `windowsHide: true` on all child processes; `TEMP`/`TMP`/`TMPDIR` overridden per-repo to prevent lock contention

---

*Architecture analysis: 2026-03-22*
