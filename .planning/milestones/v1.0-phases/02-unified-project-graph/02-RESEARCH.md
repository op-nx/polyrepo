# Phase 2: Unified Project Graph - Research

**Researched:** 2026-03-11
**Domain:** Nx Plugin Development -- createNodesV2/createDependencies, child process orchestration, graph extraction, caching
**Confidence:** HIGH

## Summary

Phase 2 extends the existing `@op-nx/polyrepo` Nx plugin to make external repo projects visible in the unified Nx project graph. The plugin must extract graph data from each synced repo by shelling out to `nx graph --print` inside the repo's `.repos/<alias>/` directory, transform and namespace the results, then register projects via `createNodesV2` and dependencies via `createDependencies`. A new `@op-nx/polyrepo:run` executor proxies target execution into child repos using `runCommandsImpl` from `nx/src/executors/run-commands/run-commands.impl`.

The established pattern from `@nx/gradle`, `@nx/maven`, and `@nx/dotnet` in the nrwl/nx repository has been thoroughly studied. The core technique is: (1) populate a module-level cache in `createNodesV2` by invoking the external tool, (2) share that cache with `createDependencies` via a module-level variable, (3) use `PluginCache` from `nx/src/utils/plugin-cache-utils` for disk persistence, and (4) use `runCommandsImpl` in the executor for transparent output streaming.

**Primary recommendation:** Follow the @nx/gradle pattern precisely -- module-level graph report cache populated in `createNodesV2` via `nx graph --print` child process, shared with `createDependencies` via module-level variable, projects registered with `repo-alias/project-name` naming, targets using `executor: "@op-nx/polyrepo:run"`, and `ImplicitDependency` type for intra-repo edges.

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions

- **Proxy targets** that shell out to Nx inside each repo -- not view-only stubs, not fully re-implemented targets
- Inspired by @nx/gradle, @nx/maven, @nx/dotnet pattern: external tool is Nx itself
- **All discovered targets proxied** -- every target from external repo's graph gets a proxy
- **Inferred targets via createNodesV2** -- external projects registered with `executor: "@op-nx/polyrepo:run"`, same pattern as @nx/gradle registering `executor: "@nx/gradle:gradle"`
- **Host Nx owns task caching** -- targets registered with inputs/outputs from external graph, Nx caches natively
- **Transparent passthrough** output -- small `[polyrepo]` header, then stream child Nx output
- **Passthrough exit code** -- child failure = proxy failure, no wrapping
- **Included in run-many/affected by default** -- external projects are first-class citizens, exclude with `--exclude=repo-b/*`
- **Inputs/outputs copied from external graph** -- extracted target configs include inputs/outputs, carried over to proxy registration
- **Lazy extraction in createNodesV2** -- follow @nx/gradle pattern, NOT during sync. Uses PluginCache + hash-based invalidation. Sync stays git-only
- **Two-layer cache invalidation**: Outer gate: git HEAD SHA + `git diff --name-only HEAD` + pluginOptions hash (~15ms per repo). Inner gate: child Nx's own PluginCache
- **`nx graph --print` for extraction** -- captures stdout as JSON, stores in PluginCache
- **Parallel extraction** across repos using Promise.all
- **Warn and skip unsynced repos** -- grouped warning listing all unsynced repos, shown once per Nx command
- **Repo's own nx binary** -- use each repo's `node_modules/.bin/nx` (or `npm exec nx`)
- **polyrepo-sync extended** to include `npm install` / `pnpm install` / `yarn` after clone/pull for ALL repos
- **runCommandsImpl** from `nx/src/executors/run-commands/run-commands.impl` -- same as @nx/gradle
- **Forward **unparsed** args** to child Nx process
- **Full intra-repo dependency edges** -- if repo-b has `my-app -> my-lib -> utils`, those appear in host graph as `repo-b/my-app -> repo-b/my-lib -> repo-b/utils`. Uses createDependencies hook
- **Preserve all tags, metadata, projectType, sourceRoot** -- carried over from external graph
- **Auto-add tags** -- `polyrepo:external` and `polyrepo:<repo-alias>` tags on all external projects
- **`/` namespace separator** -- matching GRPH-03. Works with `nx run repo-b/my-lib:build`
- **Module-level variable** for sharing data between createNodesV2 and createDependencies
- **Host-vs-external collision**: Nx core handles it via `MultipleProjectsWithSameNameError`. Zero collision code in plugin
- **Duplicate repo URL in config**: Hard error at config validation time. Full git URL normalization. zod `.refine()`
- **Git URL normalization**: Strip .git suffix, normalize SSH/HTTPS/git:// protocols, lowercase host. For path-based repos, shell out to `git remote get-url origin`, fallback to resolved absolute path comparison
- **PluginCache** from `nx/src/devkit-internals`, **hashObject** / **hashArray** from same, **workspaceDataDirectory** from `nx/src/utils/cache-directory`, **readJsonFile** / **writeJsonFile** from `@nx/devkit`
- **NOT usable**: `calculateHashForCreateNodes` and `hashWithWorkspaceContext` (tied to host workspace context, .repos/ is gitignored = invisible)

### Claude's Discretion

- Exact structure of the `@op-nx/polyrepo:run` executor implementation
- PluginCache key format and serialization details
- Git dirty-state check implementation specifics
- Graph JSON parsing and transformation internals
- Error message formatting details

### Deferred Ideas (OUT OF SCOPE)

- **Configurable namespace separator** -- the repo-alias/project-name separator is currently `/`
- **Add-repo generator** that auto-runs polyrepo-sync
- **Cross-repo dependency auto-detection** from package.json -- Phase 2 scope covers intra-repo edges only
- **Nx sync generators** for keeping synced workspace in sync
  </user_constraints>

<phase_requirements>

## Phase Requirements

| ID      | Description                                                                                          | Research Support                                                                                                                                                                                                                                               |
| ------- | ---------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GRPH-01 | Projects from synced repos appear in `nx graph` visualization                                        | createNodesV2 registers external projects with root at `.repos/<alias>/<project-root>`, targets, tags, metadata. Nx graph visualization reads from the project graph which includes all createNodesV2 results                                                  |
| GRPH-02 | Projects from synced repos appear in `nx show projects` output                                       | Same as GRPH-01 -- `nx show projects` queries the same project graph that createNodesV2 populates. Namespaced names appear automatically                                                                                                                       |
| GRPH-03 | External repo projects are namespaced with repo prefix (e.g., `repo-b/my-lib`) to prevent collisions | Projects registered with `name: "<repo-alias>/<original-name>"` in createNodesV2 result. `/` separator confirmed working with Nx command syntax (`nx run repo-b/my-lib:build` -- Nx splits on last `:`)                                                        |
| GRPH-04 | Graph extraction uses cached JSON files (pre-computed during assembly, not on every nx command)      | Two-layer caching: outer gate (git HEAD SHA + dirty state + options hash) skips extraction entirely (~15ms check); inner gate (child Nx PluginCache) returns cached data in ~1-2s if outer fires false positive. PluginCache persists to `.nx/workspace-data/` |

</phase_requirements>

## Standard Stack

### Core

| Library              | Version                         | Purpose                                                                       | Why Standard                                                                               |
| -------------------- | ------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `@nx/devkit`         | >=20.0.0 (^22.5.4 in workspace) | CreateNodesV2, CreateDependencies, DependencyType, logger, validateDependency | Official Nx plugin API. All plugin hooks come from here                                    |
| `nx` (internals)     | ^22.5.4                         | PluginCache, hashObject, workspaceDataDirectory, runCommandsImpl              | Internal Nx utilities used by @nx/gradle -- the reference implementation                   |
| `zod`                | ^4.0.0 (^4.3.6 in workspace)    | Config validation, duplicate URL detection via `.refine()`                    | Already used in Phase 1. Extends existing configSchema                                     |
| `node:child_process` | Node.js built-in                | Spawn child Nx processes for graph extraction                                 | Standard for process orchestration. execFile for extraction, runCommandsImpl for execution |

### Supporting

| Library     | Version  | Purpose                                                | When to Use                                      |
| ----------- | -------- | ------------------------------------------------------ | ------------------------------------------------ |
| `node:path` | Built-in | Path manipulation for `.repos/` paths                  | Always -- joining workspace root with repo paths |
| `node:fs`   | Built-in | existsSync for sync checks, readFileSync/writeFileSync | Cache file operations, repo existence checks     |

### Alternatives Considered

| Instead of                      | Could Use              | Tradeoff                                                                                                                                                                     |
| ------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `execFile` for extraction       | `spawn` with streaming | execFile is simpler for capturing full stdout; spawn needed only for streaming (executor handles streaming via runCommandsImpl)                                              |
| `ImplicitDependency`            | `StaticDependency`     | StaticDependency requires sourceFile which must exist in Nx's fileMap; .repos/ is gitignored so files are invisible to workspace context. ImplicitDependency is correct here |
| Custom child process management | `runCommandsImpl`      | runCommandsImpl handles PTY allocation, output streaming, signal forwarding, cross-platform concerns. @nx/gradle uses it                                                     |

**Installation:**
No new packages needed. All dependencies already in workspace.

## Architecture Patterns

### Recommended Project Structure

```
packages/op-nx-polyrepo/src/
  index.ts                          # createNodesV2 + createDependencies exports
  lib/
    config/
      schema.ts                     # Extended with URL normalization + duplicate detection
      validate.ts                   # Extended warnUnsyncedRepos (batched)
    executors/
      sync/executor.ts              # Extended with dep install after clone/pull
      status/executor.ts            # Existing (unchanged)
      run/executor.ts               # NEW: proxy executor
      run/schema.json               # NEW: run executor schema
    graph/
      extract.ts                    # NEW: nx graph --print invocation + JSON parsing
      transform.ts                  # NEW: namespace prefixing, tag injection, target rewriting
      cache.ts                      # NEW: two-layer cache (git hash outer, PluginCache inner)
      types.ts                      # NEW: graph report interfaces
    git/
      commands.ts                   # Extended with git rev-parse, git diff
      detect.ts                     # Extended with git remote get-url origin
      normalize-url.ts              # NEW: git URL normalization for duplicate detection
```

### Pattern 1: Module-Level Graph Report Cache

**What:** A module-level variable holds the extracted graph report, populated in `createNodesV2` and read in `createDependencies`. This is the exact pattern from @nx/gradle.
**When to use:** Always -- this is how Nx plugins share data between hooks within a single process.
**Example:**

```typescript
// Source: nrwl/nx packages/gradle/src/plugin/utils/get-project-graph-from-gradle-plugin.ts
// Adapted for polyrepo

interface PolyrepoGraphReport {
  // Keyed by repo alias
  repos: Record<
    string,
    {
      nodes: Record<string, ProjectNodeData>;
      dependencies: Array<{ source: string; target: string; type: string }>;
    }
  >;
}

// Module-level variable -- shared between createNodesV2 and createDependencies
let graphReport: PolyrepoGraphReport | undefined;
let currentHash: string | undefined;

export async function populateGraphReport(
  config: PolyrepoConfig,
  workspaceRoot: string,
  pluginOptionsHash: string,
): Promise<PolyrepoGraphReport> {
  const newHash = await computeOuterHash(
    config,
    workspaceRoot,
    pluginOptionsHash,
  );
  if (graphReport && newHash === currentHash) {
    return graphReport;
  }
  // ... extraction logic
  currentHash = newHash;
  graphReport = extractedReport;
  return graphReport;
}

export function getCurrentGraphReport(): PolyrepoGraphReport {
  if (!graphReport) {
    throw new Error('Expected cached polyrepo graph report');
  }
  return graphReport;
}
```

### Pattern 2: Two-Layer Cache Invalidation

**What:** Outer gate uses git HEAD SHA + dirty state + plugin options hash (~15ms). Inner gate is PluginCache disk persistence.
**When to use:** In `populateGraphReport` to decide whether to re-extract.
**Example:**

```typescript
// Outer gate: fast git-based check
async function computeOuterHash(
  config: PolyrepoConfig,
  workspaceRoot: string,
  optionsHash: string,
): Promise<string> {
  const entries = normalizeRepos(config);
  const parts: string[] = [optionsHash];

  for (const entry of entries) {
    const repoPath = getRepoPath(entry, workspaceRoot);
    if (!existsSync(join(repoPath, '.git'))) {
      continue; // skip unsynced
    }
    const headSha = await execGitOutput(['rev-parse', 'HEAD'], repoPath);
    const dirtyFiles = await execGitOutput(
      ['diff', '--name-only', 'HEAD'],
      repoPath,
    );
    parts.push(entry.alias, headSha, dirtyFiles);
  }

  return hashArray(parts);
}
```

### Pattern 3: Proxy Executor with runCommandsImpl

**What:** The `@op-nx/polyrepo:run` executor delegates to `runCommandsImpl` which handles PTY, streaming, and signal forwarding.
**When to use:** For every proxied target execution.
**Example:**

```typescript
// Source: nrwl/nx packages/gradle/src/executors/gradle/gradle.impl.ts (adapted)
import runCommandsImpl from 'nx/src/executors/run-commands/run-commands.impl';

export default async function runExecutor(
  options: RunExecutorOptions,
  context: ExecutorContext,
): Promise<{ success: boolean }> {
  const repoPath = join(context.root, '.repos', options.repoAlias);
  const nxBin = join(repoPath, 'node_modules', '.bin', 'nx');
  const command = `"${nxBin}" run ${options.originalProject}:${options.targetName}`;

  try {
    const { success } = await runCommandsImpl(
      {
        command,
        cwd: repoPath,
        __unparsed__: options.__unparsed__ || [],
      },
      context,
    );
    return { success };
  } catch {
    return { success: false };
  }
}
```

### Pattern 4: Graph JSON Transformation

**What:** Parse `nx graph --print` output, prefix project names with repo alias, rewrite targets to use proxy executor, inject auto-tags.
**When to use:** After extracting graph JSON from each child repo.
**Example:**

```typescript
// The graph --print output structure:
// { graph: { nodes: { [name]: { name, type, data: { root, targets, tags, ... } } },
//            dependencies: { [name]: [{ source, target, type }] } } }

function transformGraphForRepo(
  repoAlias: string,
  rawGraph: ExternalGraphJson,
  workspaceRoot: string,
): TransformedGraphReport {
  const nodes: Record<string, TransformedNode> = {};
  const dependencies: ImplicitDependency[] = [];

  for (const [originalName, node] of Object.entries(rawGraph.graph.nodes)) {
    const namespacedName = `${repoAlias}/${originalName}`;
    const repoRelativeRoot = node.data.root;
    const hostRoot = `.repos/${repoAlias}/${repoRelativeRoot}`;

    // Rewrite each target to use the proxy executor
    const proxyTargets: Record<string, TargetConfiguration> = {};
    for (const [targetName, targetConfig] of Object.entries(
      node.data.targets ?? {},
    )) {
      proxyTargets[targetName] = {
        executor: '@op-nx/polyrepo:run',
        options: {
          repoAlias,
          originalProject: originalName,
          targetName,
        },
        inputs: targetConfig.inputs,
        outputs: rewriteOutputPaths(
          targetConfig.outputs,
          repoRelativeRoot,
          hostRoot,
        ),
        cache: targetConfig.cache,
        dependsOn: rewriteDependsOn(targetConfig.dependsOn, repoAlias),
        configurations: targetConfig.configurations,
        parallelism: targetConfig.parallelism,
        metadata: targetConfig.metadata,
      };
    }

    nodes[namespacedName] = {
      name: namespacedName,
      root: hostRoot,
      projectType: node.data.projectType ?? node.type,
      sourceRoot: node.data.sourceRoot
        ? `.repos/${repoAlias}/${node.data.sourceRoot}`
        : undefined,
      targets: proxyTargets,
      tags: [
        ...(node.data.tags ?? []),
        'polyrepo:external',
        `polyrepo:${repoAlias}`,
      ],
      metadata: node.data.metadata,
    };
  }

  // Transform dependencies -- prefix names, use implicit type
  for (const [sourceName, deps] of Object.entries(
    rawGraph.graph.dependencies,
  )) {
    for (const dep of deps) {
      dependencies.push({
        source: `${repoAlias}/${dep.source}`,
        target: `${repoAlias}/${dep.target}`,
        type: DependencyType.implicit,
      });
    }
  }

  return { nodes, dependencies };
}
```

### Anti-Patterns to Avoid

- **Using StaticDependency for .repos/ projects:** `.repos/` is gitignored, so files are invisible to Nx's workspace context. `validateDependency` will throw when `sourceFile` is checked against the fileMap. Use `ImplicitDependency` instead.
- **Using `calculateHashForCreateNodes`:** This function uses `hashWithWorkspaceContext` which is tied to the host workspace's Rust native `WorkspaceContext`. Files under `.repos/` (gitignored) are invisible. Use `hashObject`/`hashArray` with manual git SHA extraction instead.
- **Extracting during sync:** Graph extraction should happen lazily in `createNodesV2`, not during the sync executor. This follows the @nx/gradle pattern and means users get graph data even without running sync first (if repos are already cloned).
- **Using `readNxJson()` from devkit:** In executor context, this requires a `Tree` that isn't available. Use `readFileSync` to read nx.json directly (established pattern from Phase 1).
- **Running `nx show project <name> --json` per project:** O(N) cost per project, ~2.8s each. `nx graph --print` gets ALL projects in a single ~2-4s invocation.

## Don't Hand-Roll

| Problem                             | Don't Build                    | Use Instead                                                                               | Why                                                                            |
| ----------------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Child process output streaming      | Custom spawn + pipe management | `runCommandsImpl` from `nx/src/executors/run-commands/run-commands.impl`                  | Handles PTY, color, signal forwarding, Windows compat, large buffers           |
| Cache persistence with LRU eviction | Custom JSON file cache         | `PluginCache` from `nx/src/utils/plugin-cache-utils`                                      | Handles disk I/O errors, eviction, serialization limits, corrupt file recovery |
| Hashing for cache keys              | crypto.createHash              | `hashObject`/`hashArray` from `nx/src/hasher/file-hasher` (via `nx/src/devkit-internals`) | Native Rust implementation, consistent with Nx's own hashing                   |
| Name collision detection            | Pre-check name collisions      | Let Nx core throw `MultipleProjectsWithSameNameError`                                     | Already batches all collisions, shows both roots, 100% correct, ~15ms          |
| Dependency validation               | Custom edge validation         | `validateDependency` from `@nx/devkit`                                                    | Validates source/target exist, file references are valid, type constraints     |

**Key insight:** The @nx/gradle plugin reuses extensive Nx internals rather than reimplementing. This is the correct approach -- Nx's own utilities handle edge cases (Windows paths, PTY allocation, signal handling, cache corruption recovery) that would take hundreds of lines to hand-roll.

## Common Pitfalls

### Pitfall 1: StaticDependency vs ImplicitDependency for .repos/ Files

**What goes wrong:** Using `StaticDependency` with `sourceFile` for intra-repo edges causes `validateDependency` to throw because `.repos/` files are not in the workspace `fileMap` (gitignored directory).
**Why it happens:** Nx's native workspace context (Rust-based) only indexes files tracked by git. `.repos/` is in `.gitignore`, so all files under it are invisible.
**How to avoid:** Use `DependencyType.implicit` for all intra-repo dependency edges. Implicit dependencies don't require `sourceFile`.
**Warning signs:** `validateDependency` throws "Source file not found" errors during graph construction.

### Pitfall 2: Path Separator Confusion on Windows

**What goes wrong:** Using backslashes in project roots, source roots, or output paths causes inconsistent behavior between Windows and Unix.
**Why it happens:** `path.join` on Windows produces backslashes. Nx expects forward slashes consistently.
**How to avoid:** Use `normalizePath` from `@nx/devkit` for all paths returned in createNodesV2 results. The existing `gitPath` helper in `commands.ts` already does `p.replace(/\\/g, '/')` -- extend this pattern.
**Warning signs:** Projects appear in graph on one OS but not another; cache misses due to path format differences.

### Pitfall 3: Stale Module-Level Cache Across Nx Daemon Restarts

**What goes wrong:** The module-level `graphReport` variable persists across multiple Nx commands when the Nx daemon is running. If the daemon doesn't restart, stale data persists.
**Why it happens:** Nx daemon keeps the plugin process alive between commands. Module-level variables survive.
**How to avoid:** The two-layer cache invalidation handles this: the outer hash check (git HEAD + dirty state) detects changes even when the process is long-lived. Always re-check hash on every invocation.
**Warning signs:** Changes in external repos don't appear until Nx daemon is restarted.

### Pitfall 4: Child Nx Process Using Wrong Node Modules

**What goes wrong:** The child Nx invocation (`nx graph --print`) in the child repo fails because dependencies aren't installed.
**Why it happens:** Clone/pull in Phase 1 doesn't install dependencies. The child repo's `node_modules/.bin/nx` may not exist.
**How to avoid:** Extend `polyrepo-sync` to run dependency installation after clone/pull for all repos. Also, during extraction, check that `node_modules/.bin/nx` exists and provide a clear error if missing.
**Warning signs:** "nx: command not found" or "Cannot find module" errors during graph extraction.

### Pitfall 5: `npm exec nx` vs `node_modules/.bin/nx` on Windows

**What goes wrong:** `npm exec nx graph --print` may parse `--print` as an npm flag rather than passing it to nx.
**Why it happens:** `npm exec` has its own argument parsing that can interfere with double-dash separation.
**How to avoid:** Use the full path to the local nx binary: `node_modules/.bin/nx` (which is a .cmd file on Windows). For `execFile`, pass the binary path directly with args array to avoid shell parsing issues.
**Warning signs:** Unexpected npm errors or nx not receiving the expected flags.

### Pitfall 6: Output Path Rewriting

**What goes wrong:** Nx caching for proxy targets uses the wrong paths for outputs, leading to cache misses or incorrect restoration.
**Why it happens:** Target outputs in the external graph are relative to the external repo root (e.g., `{projectRoot}/dist`). In the host workspace, the project root is `.repos/<alias>/<repo-relative-root>`, so outputs need to be relative to that.
**How to avoid:** Output paths from the external graph that use `{projectRoot}` tokens work correctly because Nx resolves them relative to the project's root in the host workspace. But outputs using absolute or workspace-relative paths need rewriting.
**Warning signs:** Nx caching never hits for proxy targets; `nx reset` doesn't help.

### Pitfall 7: Large Graph JSON stdout

**What goes wrong:** `execFile` with default maxBuffer (200KB on some Node versions) truncates the graph JSON for large repos.
**Why it happens:** A 149-project repo produces ~1.4MB of JSON output.
**How to avoid:** Set `maxBuffer: LARGE_BUFFER` (1GB) from `nx/src/executors/run-commands/run-commands.impl`, same as @nx/gradle.
**Warning signs:** JSON.parse errors on truncated output; "maxBuffer length exceeded" errors.

### Pitfall 8: Concurrent createNodesV2 and createDependencies Invocations

**What goes wrong:** `createDependencies` runs before `createNodesV2` has finished populating the graph report.
**Why it happens:** Nx may invoke hooks in an order that isn't guaranteed.
**How to avoid:** Follow @nx/gradle's defensive pattern: `createDependencies` calls `populateGraphReport` independently (with its own cache check). If the module-level cache is already populated, it returns immediately.
**Warning signs:** "Expected cached graph report" errors.

## Code Examples

Verified patterns from the nrwl/nx repository:

### Graph Extraction via execFile

```typescript
// Source: nrwl/nx packages/gradle/src/utils/exec-gradle.ts (adapted)
import { execFile, ExecFileOptions } from 'node:child_process';
import { LARGE_BUFFER } from 'nx/src/executors/run-commands/run-commands.impl';
import { join } from 'node:path';

export function extractGraphFromRepo(repoPath: string): Promise<string> {
  const nxBin = join(repoPath, 'node_modules', '.bin', 'nx');
  return new Promise((resolve, reject) => {
    execFile(
      nxBin,
      ['graph', '--print'],
      {
        cwd: repoPath,
        maxBuffer: LARGE_BUFFER,
        env: { ...process.env, NX_DAEMON: 'false' },
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(
            new Error(
              `Failed to extract graph from ${repoPath}: ${stderr || error.message}`,
            ),
          );
          return;
        }
        resolve(stdout);
      },
    );
  });
}
```

### PluginCache Usage

```typescript
// Source: nrwl/nx packages/gradle/src/plugin/nodes.ts lines 114-120, 194-196
import { PluginCache } from 'nx/src/utils/plugin-cache-utils';
import { hashObject } from 'nx/src/hasher/file-hasher';
import { workspaceDataDirectory } from 'nx/src/utils/cache-directory';
import { join } from 'node:path';

const optionsHash = hashObject(options);
const cachePath = join(workspaceDataDirectory, `polyrepo-${optionsHash}.hash`);
const pluginCache = new PluginCache<TransformedGraphReport>(cachePath);

// Check cache
if (pluginCache.has(cacheKey)) {
  return pluginCache.get(cacheKey);
}

// Populate cache
pluginCache.set(cacheKey, transformedReport);

// Persist at end
pluginCache.writeToDisk(cachePath);
```

### Executor with runCommandsImpl

```typescript
// Source: nrwl/nx packages/gradle/src/executors/gradle/gradle.impl.ts lines 79-92
import runCommandsImpl from 'nx/src/executors/run-commands/run-commands.impl';
import { ExecutorContext } from '@nx/devkit';

export default async function runExecutor(
  options: RunExecutorSchema,
  context: ExecutorContext,
): Promise<{ success: boolean }> {
  const repoPath = join(context.root, '.repos', options.repoAlias);
  const nxBin = join(repoPath, 'node_modules', '.bin', 'nx');

  try {
    const { success } = await runCommandsImpl(
      {
        command: `"${nxBin}" run ${options.originalProject}:${options.targetName}`,
        cwd: repoPath,
        __unparsed__: options.__unparsed__ || [],
      },
      context,
    );
    return { success };
  } catch {
    return { success: false };
  }
}
```

### createDependencies with ImplicitDependency

```typescript
// Source: nrwl/nx packages/gradle/src/plugin/dependencies.ts (adapted)
import {
  CreateDependencies,
  DependencyType,
  RawProjectGraphDependency,
} from '@nx/devkit';

export const createDependencies: CreateDependencies<PolyrepoConfig> = async (
  options,
  context,
) => {
  // Defensive: re-populate in case createNodesV2 hasn't run yet
  const report = await populateGraphReport(/* ... */);
  const dependencies: RawProjectGraphDependency[] = [];

  for (const [repoAlias, repoReport] of Object.entries(report.repos)) {
    for (const dep of repoReport.dependencies) {
      const namespacedSource = `${repoAlias}/${dep.source}`;
      const namespacedTarget = `${repoAlias}/${dep.target}`;

      // Only add if both projects exist in the current context
      if (
        context.projects[namespacedSource] &&
        context.projects[namespacedTarget]
      ) {
        dependencies.push({
          source: namespacedSource,
          target: namespacedTarget,
          type: DependencyType.implicit,
        });
      }
    }
  }

  return dependencies;
};
```

### Git URL Normalization

```typescript
// For duplicate repo URL detection in config validation
function normalizeGitUrl(url: string): string {
  let normalized = url.trim();

  // Strip trailing .git
  normalized = normalized.replace(/\.git$/, '');

  // Normalize SSH URLs: git@host:org/repo -> https://host/org/repo
  const sshMatch = normalized.match(/^git@([^:]+):(.+)$/);
  if (sshMatch) {
    normalized = `https://${sshMatch[1].toLowerCase()}/${sshMatch[2]}`;
  }

  // Normalize ssh:// URLs
  const sshProtoMatch = normalized.match(/^ssh:\/\/git@([^/]+)\/(.+)$/);
  if (sshProtoMatch) {
    normalized = `https://${sshProtoMatch[1].toLowerCase()}/${sshProtoMatch[2]}`;
  }

  // Normalize git:// URLs
  normalized = normalized.replace(/^git:\/\//, 'https://');

  // Lowercase the host portion of https:// URLs
  try {
    const parsed = new URL(normalized);
    parsed.hostname = parsed.hostname.toLowerCase();
    normalized = parsed.toString().replace(/\/$/, '');
  } catch {
    // Not a parseable URL, return as-is
  }

  return normalized;
}
```

## State of the Art

| Old Approach                              | Current Approach                           | When Changed    | Impact                                                                                              |
| ----------------------------------------- | ------------------------------------------ | --------------- | --------------------------------------------------------------------------------------------------- |
| `createNodes` (singular)                  | `createNodesV2` (batched)                  | Nx 20           | V2 receives all config files at once, enables batch processing                                      |
| Custom cache files                        | `PluginCache` class                        | Nx 22+ (recent) | LRU eviction, disk persistence, corruption recovery built-in                                        |
| `calculateHashForCreateNodes`             | Manual hash via `hashObject`/`hashArray`   | N/A (our case)  | `calculateHashForCreateNodes` uses workspace context which ignores .repos/; manual hashing required |
| `createDependencies` with file-based deps | `ImplicitDependency` for non-tracked files | Always          | When source files aren't in workspace context, implicit deps are the correct type                   |

**Deprecated/outdated:**

- `createNodes` (v1): Replaced by `createNodesV2` in Nx 20. V1 will be removed in Nx 22.
- Old PluginCache format (plain Record): Current format uses `{ entries, accessOrder }` with LRU. Old format is silently discarded.

## Open Questions

1. **npm exec on Windows with args containing `--`**
   - What we know: `npm exec nx graph -- --print` may need careful quoting on Windows. The `--` separator tells npm to stop parsing its own flags.
   - What's unclear: Whether `execFile` with the direct `node_modules/.bin/nx` path is reliable cross-platform, especially the `.cmd` wrapper on Windows.
   - Recommendation: Use the full path to `node_modules/.bin/nx` (which resolves to `nx.cmd` on Windows) and pass args as an array to `execFile` (avoids shell parsing). Test on Windows.

2. **Dependency installation in polyrepo-sync**
   - What we know: Need to detect package manager (npm/pnpm/yarn) for each repo and run the appropriate install command.
   - What's unclear: How to reliably detect the package manager for each repo.
   - Recommendation: Check for lock files: `pnpm-lock.yaml` -> pnpm, `yarn.lock` -> yarn, `package-lock.json` or default -> npm. This is the standard detection pattern.

3. **NX_DAEMON=false for child extraction**
   - What we know: Running `nx graph --print` starts an Nx daemon in the child repo, which may conflict with the host daemon.
   - What's unclear: Whether child daemons cause port conflicts or resource issues.
   - Recommendation: Set `NX_DAEMON=false` in the extraction environment to avoid child daemon processes. The extraction is a one-shot operation, so daemon benefits don't apply.

4. **dependsOn rewriting for proxy targets**
   - What we know: External targets may have `dependsOn` like `['^build']` or `['build']`. These reference original project names.
   - What's unclear: Whether Nx resolves `dependsOn` using the namespaced project name automatically.
   - Recommendation: `dependsOn` entries like `'^build'` (caret syntax for dependencies) should work because Nx resolves them against the project graph where dependency edges are already namespaced. Literal project references in `dependsOn` would need rewriting.

## Validation Architecture

### Test Framework

| Property           | Value                                       |
| ------------------ | ------------------------------------------- |
| Framework          | Vitest 4.x                                  |
| Config file        | `packages/op-nx-polyrepo/vitest.config.mts` |
| Quick run command  | `npx nx test op-nx-polyrepo`                |
| Full suite command | `npx nx run-many -t test`                   |

### Phase Requirements -> Test Map

| Req ID  | Behavior                                | Test Type  | Automated Command               | File Exists?                                      |
| ------- | --------------------------------------- | ---------- | ------------------------------- | ------------------------------------------------- |
| GRPH-01 | External projects appear in graph       | unit + e2e | `npx nx test op-nx-polyrepo -x` | Partially (index.spec.ts exists, needs extension) |
| GRPH-02 | External projects in `nx show projects` | e2e        | `npx nx e2e op-nx-polyrepo-e2e` | Partially (e2e exists, needs graph test cases)    |
| GRPH-03 | Namespace prefixing with `/` separator  | unit       | `npx nx test op-nx-polyrepo -x` | No -- Wave 0                                      |
| GRPH-04 | Cached extraction, not recomputed       | unit       | `npx nx test op-nx-polyrepo -x` | No -- Wave 0                                      |

### Additional Test Coverage Needed

| Component                                   | Test Type | File                                      | Exists?                 |
| ------------------------------------------- | --------- | ----------------------------------------- | ----------------------- |
| Graph extraction (nx graph --print parsing) | unit      | `src/lib/graph/extract.spec.ts`           | No -- Wave 0            |
| Graph transformation (namespacing, tags)    | unit      | `src/lib/graph/transform.spec.ts`         | No -- Wave 0            |
| Two-layer cache invalidation                | unit      | `src/lib/graph/cache.spec.ts`             | No -- Wave 0            |
| Run executor                                | unit      | `src/lib/executors/run/executor.spec.ts`  | No -- Wave 0            |
| Git URL normalization                       | unit      | `src/lib/git/normalize-url.spec.ts`       | No -- Wave 0            |
| Duplicate URL detection in config           | unit      | `src/lib/config/schema.spec.ts`           | Exists, needs extension |
| createDependencies hook                     | unit      | `src/index.spec.ts`                       | Exists, needs extension |
| Dep install in sync                         | unit      | `src/lib/executors/sync/executor.spec.ts` | Exists, needs extension |

### Sampling Rate

- **Per task commit:** `npx nx test op-nx-polyrepo`
- **Per wave merge:** `npx nx run-many -t test,lint,typecheck`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `src/lib/graph/extract.spec.ts` -- covers graph JSON extraction and parsing
- [ ] `src/lib/graph/transform.spec.ts` -- covers namespace prefixing, tag injection, target rewriting
- [ ] `src/lib/graph/cache.spec.ts` -- covers two-layer cache invalidation logic
- [ ] `src/lib/graph/types.ts` -- TypeScript interfaces for graph report structures
- [ ] `src/lib/executors/run/executor.spec.ts` -- covers proxy executor
- [ ] `src/lib/executors/run/schema.json` -- executor schema
- [ ] `src/lib/git/normalize-url.spec.ts` -- covers URL normalization for duplicate detection
- [ ] Registration of `run` executor in `executors.json`

## Sources

### Primary (HIGH confidence)

- nrwl/nx local repo at `d:/projects/github/nrwl/nx` -- studied @nx/gradle plugin source (nodes.ts, dependencies.ts, gradle.impl.ts, get-project-graph-from-gradle-plugin.ts, exec-gradle.ts)
- nrwl/nx `PluginCache` implementation at `packages/nx/src/utils/plugin-cache-utils.ts`
- nrwl/nx `hashObject`/`hashArray` at `packages/nx/src/hasher/file-hasher.ts`
- nrwl/nx `workspaceDataDirectory` at `packages/nx/src/utils/cache-directory.ts`
- nrwl/nx `runCommandsImpl` at `packages/nx/src/executors/run-commands/run-commands.impl.ts`
- nrwl/nx `CreateDependencies`, `CreateNodesV2` types at `packages/nx/src/project-graph/plugins/public-api.ts`
- nrwl/nx `RawProjectGraphDependency`, `validateDependency` at `packages/nx/src/project-graph/project-graph-builder.ts`
- nrwl/nx `DependencyType` at `packages/nx/src/config/project-graph.ts`
- nrwl/nx `MultipleProjectsWithSameNameError` at `packages/nx/src/project-graph/error-types.ts`
- nrwl/nx `createJsonOutput` (graph --print handler) at `packages/nx/src/command-line/graph/graph.ts`
- Existing Phase 1 codebase at `packages/op-nx-polyrepo/src/`

### Secondary (MEDIUM confidence)

- CONTEXT.md benchmarks from user (verified on nrwl/nx: 149 projects, ~7.9s for `nx graph --print`, 1.4MB output)

### Tertiary (LOW confidence)

- None. All findings verified against source code.

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH -- all libraries verified in nrwl/nx source, imports confirmed
- Architecture: HIGH -- exact pattern studied from @nx/gradle with line-level reference
- Pitfalls: HIGH -- validated against Nx source code (validateDependency logic, fileMap behavior, PluginCache API)
- Cache strategy: HIGH -- two-layer cache follows @nx/gradle's populateProjectGraph pattern
- Dependency type (implicit): HIGH -- verified by reading validateStaticDependency source, confirmed .repos/ files are invisible to workspace context

**Critical finding:** Must use `DependencyType.implicit` (not `static`) for intra-repo edges because `.repos/` is gitignored and files are invisible to Nx's native workspace context. StaticDependency requires sourceFile which must exist in the fileMap.

**Research date:** 2026-03-11
**Valid until:** 2026-04-11 (stable -- Nx 22.x APIs are settled)
