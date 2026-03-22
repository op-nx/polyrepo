# Phase 11: Full Nx Daemon Support - Research

**Researched:** 2026-03-20
**Domain:** Nx daemon plugin worker lifecycle, per-repo caching architecture, exponential backoff error recovery, Docker e2e with daemon mode toggling
**Confidence:** HIGH

## Summary

Phase 11 transforms the plugin from requiring `NX_DAEMON=false` on cold start to working seamlessly under all daemon/cache combinations. The work breaks into four tightly coupled areas: (1) refactoring the monolithic single-file cache into per-repo cache files at `.repos/<alias>/.polyrepo-graph-cache.json` with a global in-memory hash gate, (2) pre-caching graph data during `polyrepo-sync` after install completes so the first daemon invocation hits warm disk cache, (3) adding exponential backoff with hash-change reset on per-repo extraction failures, and (4) extending the e2e infrastructure to verify all four combinations of daemon on/off and Nx cache on/off.

The existing codebase is well-positioned for this refactor. `computeOuterHash` in `cache.ts` already iterates repos individually with per-repo `headSha`/`dirtyFiles`. `populateGraphReport` already extracts and transforms per-repo. The `PolyrepoGraphReport.repos` map is already keyed by alias. The refactor is at the cache serialization and invalidation layer, not the core graph pipeline. Module-level state (`graphReport`/`currentHash` at `cache.ts:15-16`) is the mechanism that makes the daemon fast path work -- under daemon mode, the plugin worker process persists, so these variables survive across Nx commands.

The e2e infrastructure change is well-scoped. The Dockerfile's `workspace` stage (line 58) sets `ENV NX_DAEMON=false CI=true`. Removing `NX_DAEMON=false` from the runtime ENV and forwarding the host's `NX_DAEMON` value via testcontainers' `withEnvironment()` API enables the CI matrix to control daemon mode. The `startContainer()` helper needs a one-line change to conditionally apply `withEnvironment({ NX_DAEMON: value })`.

**Primary recommendation:** Two plans. Plan 1: Per-repo cache refactor + pre-caching during sync + error recovery with backoff (the core daemon support work). Plan 2: E2e daemon mode verification (Dockerfile change, container env forwarding, CI matrix, four-combo verification).

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions

**Per-repo Cache Architecture**

- Migrate from single cache file to per-repo cache files. Each synced repo gets its own cache at `.repos/<alias>/.polyrepo-graph-cache.json` containing `{ hash, report }` for that repo only.
- Three-layer cache with global gate: (1) Global in-memory hash gate (combines all per-repo hashes -- existing pattern from `cache.ts:84-87`), (2) Per-repo disk cache, (3) Per-repo extraction on miss. Each layer is progressively more expensive, only reached when the cheaper layer misses.
- Keep existing hash inputs. Per-repo hash: `hashArray([reposConfigHash, alias, headSha, dirtyFiles])`. Lockfile hash was considered but `headSha + dirtyFiles` already covers lockfile changes via `git status --porcelain`. Adding it provides marginal benefit with unnecessary coupling to sync executor internals.
- Scalability target: Multiple repos with 500+ Nx projects. In-memory hit: ~0ms. Disk hit: ~50-200ms. Only stale repos re-extract.

**Pre-caching During Sync**

- polyrepo-sync writes per-repo disk cache after install. After clone/pull + dep install, run `extractGraphFromRepo` and write the per-repo cache file. First daemon invocation hits warm disk cache.
- Progress logging at multiple points. Sync must log progress during extraction so output doesn't feel stuck (e.g., "Extracting graph for repo-x...", "Cached graph for repo-x (149 projects)").
- Warn and continue on extraction failure. Matches existing degradation pattern (`createNodesV2` and `createDependencies` both catch extraction errors and warn). The repo is still cloned and installed; plugin falls back to inline extraction on next Nx command.

**Cache Invalidation Under Daemon**

- Hash-based invalidation (existing approach, no event-driven watcher). `computeOuterHash` runs per Nx command: `git rev-parse HEAD` + `git status --porcelain` per repo. 10 repos = ~100-200ms total. <1% overhead on typical Nx commands (2-30s).
- Natural invalidation after sync. Sync with no new commits: hash unchanged, in-memory hit, zero cost. Sync with changes: hash changes, per-repo disk cache hit (pre-cached by sync), ~100-200ms recovery. No daemon restart or refresh signal needed.
- This is a synthetic monorepo. Users actively develop in `.repos/<alias>/` directories. Extraction inside the daemon is the common path, not a rare edge case. Cache must be responsive to frequent local changes.

**E2e Daemon Testing**

- Both daemon modes verified in e2e. E2e tests must pass with `NX_DAEMON=true` and `NX_DAEMON=false`.
- Separate test runs, CI matrix. Same test files, run twice with different env. CI matrix controls `NX_DAEMON`. Local e2e defaults to `NX_DAEMON` unset (daemon enabled, Nx default).
- Remove `ENV NX_DAEMON=false` from Dockerfile `workspace` stage (line 58). Keep `CI=true`. Build-time `RUN` commands already have inline `NX_DAEMON=false` (lines 89, 116). `nx-prep` stage (line 14) keeps its `ENV` -- build-time only, never runtime.
- Forward host env via `startContainer()`. Read `process.env['NX_DAEMON']` in test setup, pass to container via `withEnvironment()`. If unset, container uses Nx default (daemon on).
- Establish Docker build baseline before changes. Record current build times for each Dockerfile stage, then verify no regression after removing `ENV NX_DAEMON=false` from runtime stage. Plan step with manual verification.
- Also verify with `--skip-nx-cache`. Four combinations: daemon on/off x cache on/off. All must produce correct results.

**Error Recovery**

- Per-repo isolation. One repo's extraction failure does not affect other repos. Failed repo's projects drop from graph; other repos served from their own caches.
- No stale cache fallback. In a synthetic monorepo, users actively develop across repos. Stale data means incorrect dependency edges. Show the real state, warn clearly.
- Short exponential retries with hash-change reset. After extraction failure, skip re-extraction with growing cooldown: 2s, 4s, 8s, 16s, 30s cap. Prevents repeated 30-60s extraction penalties on rapid Nx command sequences. Hash change (any file edit, commit, or sync in the failing repo) resets to attempt 1 immediately.
- Actionable warning with troubleshooting steps. On failure, log: (1) `nx polyrepo-sync` (re-sync + reinstall + pre-cache), (2) `NX_DAEMON=false nx graph` (detailed error output), (3) Check `.repos/<alias>/` (nx.json, node_modules), (4) `NX_PLUGIN_NO_TIMEOUTS=true nx graph` (bypass 10-min plugin timeout).

### Claude's Discretion

- Function signatures and file layout for per-repo cache refactor
- Exact progress log message format during sync extraction
- Whether to extract repos in parallel or sequentially during sync
- Test file organization for daemon-on vs daemon-off scenarios
- Exact backoff timing implementation (setTimeout vs timestamp comparison)

### Deferred Ideas (OUT OF SCOPE)

- File watcher for cache invalidation -- Watch `.repos/` for git changes instead of hash-checking per command. Would eliminate the ~100-200ms hash overhead but adds platform-specific watcher complexity. Revisit if hash overhead becomes measurable at scale.
- Stale cache fallback -- Serve outdated cache on extraction failure. Rejected for this phase: in a synthetic monorepo, stale data means incorrect dependency edges. Per-repo isolation with clear warnings is more honest.
- Automated build-time regression assertion -- CI check that fails if Docker build exceeds baseline + margin. Manual verification chosen for this phase; revisit if build times regress.
- `nx affected` cross-repo support (DETECT-07) -- Carried from Phase 10. Requires `polyrepo-affected` executor. Separate milestone.
- Consumer-side tsconfig path resolution -- Carried from Phase 9/10. Deferred to v1.2+.
  </user_constraints>

## Standard Stack

### Core

| Library          | Version     | Purpose                                                | Why Standard                              |
| ---------------- | ----------- | ------------------------------------------------------ | ----------------------------------------- |
| `@nx/devkit`     | >=20.0.0    | `hashArray`, `readJsonFile`, `writeJsonFile`, `logger` | Nx plugin API; already used in `cache.ts` |
| `vitest`         | (workspace) | Unit + e2e test runner                                 | Already in use for all project tests      |
| `testcontainers` | ^11.12.0    | Docker container lifecycle for e2e tests               | Already established e2e infrastructure    |

### Supporting

| Library | Version | Purpose                                  | When to Use                     |
| ------- | ------- | ---------------------------------------- | ------------------------------- |
| `zod`   | ^4.0.0  | Schema validation for cache file parsing | Already a production dependency |

### Alternatives Considered

| Instead of                    | Could Use                          | Tradeoff                                                                                                                                             |
| ----------------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Per-repo disk files           | Single file with per-repo sections | Single file requires atomic read/write of entire cache; per-repo files allow independent invalidation and are naturally scoped to the repo directory |
| `hashArray` from `@nx/devkit` | `node:crypto` SHA256               | `hashArray` is already used throughout the codebase and is deterministic for arrays of strings                                                       |
| Timestamp-based backoff       | `setTimeout` delay                 | Timestamp comparison works in the daemon's persistent process without blocking; `setTimeout` would block the plugin worker thread                    |

**Installation:**
No new dependencies needed. All libraries already in the workspace.

## Architecture Patterns

### Per-repo Cache File Layout

```
.repos/
  <alias>/
    .git/
    .polyrepo-graph-cache.json   # NEW: per-repo cache file
    .nx-graph-output.json        # existing: pre-computed graph for fast path
    node_modules/
    ...
```

Each `.polyrepo-graph-cache.json` contains:

```json
{
  "hash": "<hashArray([reposConfigHash, alias, headSha, dirtyFiles])>",
  "report": { "nodes": {...}, "dependencies": [...] }
}
```

The old monolithic `.repos/.polyrepo-graph-cache.json` is removed.

### Pattern 1: Three-Layer Cache with Global Gate

**What:** Global in-memory hash gate prevents per-repo disk reads when nothing changed.
**When to use:** Every `populateGraphReport` call (both `createNodesV2` and `createDependencies`).

```typescript
// Module-level state (persists under daemon)
const perRepoCache: Map<string, { hash: string; report: RepoGraphData }> =
  new Map();
let globalHash: string | undefined;

async function populateGraphReport(
  config: PolyrepoConfig,
  workspaceRoot: string,
  reposConfigHash: string,
): Promise<PolyrepoGraphReport> {
  // Layer 0: Global gate -- combine all per-repo hashes
  const newGlobalHash = await computeGlobalHash(
    config,
    workspaceRoot,
    reposConfigHash,
  );

  if (newGlobalHash === globalHash) {
    // Nothing changed across all repos -- return assembled report from memory
    return assembleReport(perRepoCache);
  }

  // Something changed -- check per-repo
  const entries = normalizeRepos(config);
  const report: PolyrepoGraphReport = { repos: {} };

  for (const entry of syncedEntries) {
    const repoHash = await computeRepoHash(
      reposConfigHash,
      entry,
      workspaceRoot,
    );
    const cached = perRepoCache.get(entry.alias);

    if (cached && cached.hash === repoHash) {
      // Layer 1: In-memory per-repo hit
      report.repos[entry.alias] = cached.report;
      continue;
    }

    // Layer 2: Per-repo disk cache
    const diskCache = tryReadPerRepoCache(workspaceRoot, entry.alias);

    if (diskCache && diskCache.hash === repoHash) {
      perRepoCache.set(entry.alias, diskCache);
      report.repos[entry.alias] = diskCache.report;
      continue;
    }

    // Layer 3: Extract (expensive)
    const repoReport = await extractAndTransform(entry, workspaceRoot);
    perRepoCache.set(entry.alias, { hash: repoHash, report: repoReport });
    writePerRepoCache(workspaceRoot, entry.alias, repoHash, repoReport);
    report.repos[entry.alias] = repoReport;
  }

  globalHash = newGlobalHash;

  return report;
}
```

### Pattern 2: Pre-caching in Sync Executor

**What:** After successful `installDeps()`, extract and write per-repo cache.
**When to use:** In `syncRepo()` after install completes, for each successfully synced repo.

```typescript
// In sync executor, after installDeps succeeds:
async function preCacheGraph(
  repoPath: string,
  alias: string,
  workspaceRoot: string,
  reposConfigHash: string,
): Promise<void> {
  logger.info(`Extracting graph for ${alias}...`);

  try {
    const rawGraph = await extractGraphFromRepo(repoPath);
    const transformed = transformGraphForRepo(alias, rawGraph, workspaceRoot);
    const hash = await computeRepoHash(reposConfigHash, alias, repoPath);

    writePerRepoCache(workspaceRoot, alias, hash, {
      nodes: transformed.nodes,
      dependencies: transformed.dependencies,
    });

    const projectCount = Object.keys(transformed.nodes).length;
    logger.info(`Cached graph for ${alias} (${String(projectCount)} projects)`);
  } catch (error) {
    logger.warn(
      `Failed to pre-cache graph for ${alias}: ${error instanceof Error ? error.message : String(error)}`,
    );
    logger.warn('Plugin will extract on next Nx command.');
  }
}
```

### Pattern 3: Exponential Backoff with Hash-Change Reset

**What:** Per-repo failure tracking with cooldown to avoid repeated expensive extraction penalties.
**When to use:** Inside the extraction layer (Layer 3) of the cache.

```typescript
// Module-level state (persists under daemon)
interface FailureState {
  lastAttemptTime: number;
  attemptCount: number;
  lastHash: string; // Hash at time of failure
}

const failureStates: Map<string, FailureState> = new Map();

function shouldSkipExtraction(alias: string, currentHash: string): boolean {
  const state = failureStates.get(alias);

  if (!state) {
    return false;
  }

  // Hash changed = user made changes = reset
  if (state.lastHash !== currentHash) {
    failureStates.delete(alias);

    return false;
  }

  // Exponential backoff: 2s, 4s, 8s, 16s, 30s cap
  const backoffMs = Math.min(2000 * Math.pow(2, state.attemptCount - 1), 30000);
  const elapsed = Date.now() - state.lastAttemptTime;

  return elapsed < backoffMs;
}

function recordFailure(alias: string, currentHash: string): void {
  const existing = failureStates.get(alias);
  const attemptCount = (existing?.attemptCount ?? 0) + 1;

  failureStates.set(alias, {
    lastAttemptTime: Date.now(),
    attemptCount,
    lastHash: currentHash,
  });
}
```

### Anti-Patterns to Avoid

- **Global cache file for all repos:** Defeats per-repo invalidation. A single changed repo forces re-reading/re-writing the entire cache.
- **`setTimeout` for backoff in plugin workers:** Plugin workers are invoked synchronously by the daemon for graph computation. Blocking with setTimeout would hold up the entire graph pipeline. Use timestamp comparison instead.
- **Restarting the daemon on sync:** The hash-based invalidation makes daemon restart unnecessary. The next Nx command naturally picks up changes.
- **Reading per-repo cache files in parallel during global gate hit:** Unnecessary. The global gate hit means all per-repo in-memory caches are valid. Only read disk when the global gate misses.

## Don't Hand-Roll

| Problem                  | Don't Build               | Use Instead                                      | Why                                                                            |
| ------------------------ | ------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------ |
| Hash computation         | Custom SHA256             | `hashArray` from `@nx/devkit`                    | Already used throughout `cache.ts`; deterministic for string arrays            |
| JSON disk cache I/O      | Custom JSON reader/writer | `readJsonFile`/`writeJsonFile` from `@nx/devkit` | Already used in `cache.ts`; handles UTF-8 encoding, atomic writes              |
| File existence checks    | `fs.accessSync`           | `existsSync` from `node:fs`                      | Already used throughout codebase; simpler API                                  |
| Container env forwarding | Manual Docker env args    | `testcontainers` `withEnvironment()`             | Already available in testcontainers ^11.12.0; type-safe Record<string, string> |
| Retry timing             | setTimeout-based delay    | Timestamp comparison with `Date.now()`           | Non-blocking in synchronous plugin worker context                              |

**Key insight:** The per-repo cache refactor changes the serialization and invalidation topology, not the core graph extraction/transformation pipeline. `extractGraphFromRepo`, `transformGraphForRepo`, and the hash input functions (`getHeadSha`, `getDirtyFiles`) remain unchanged.

## Common Pitfalls

### Pitfall 1: Module-Level State Reset on `vi.resetModules()`

**What goes wrong:** Unit tests for the per-repo cache must reset module-level state between test cases (the `Map` and `globalHash`). Without `vi.resetModules()`, state leaks between tests.
**Why it happens:** The existing `cache.spec.ts` already uses `vi.resetModules()` at line 99 and dynamically imports the module. The per-repo refactor adds more module-level state (Map instead of single variables).
**How to avoid:** Follow the existing pattern in `cache.spec.ts`. Each test calls `vi.resetModules()` and dynamically re-imports `cache.ts`. The `setup()` function already does this.
**Warning signs:** Tests pass individually but fail when run together.

### Pitfall 2: Race Condition in Parallel Per-Repo Extraction

**What goes wrong:** When multiple repos need extraction simultaneously (Layer 3 miss for multiple repos), parallel `extractGraphFromRepo` calls spawn multiple child Nx processes. Under the daemon, the plugin worker is single-threaded but async operations interleave.
**Why it happens:** `Promise.all` is used for extraction (existing pattern at `cache.ts:114`). Each extraction spawns a child `nx graph --print` process. These are I/O-bound (child process exec), so they can run concurrently.
**How to avoid:** Keep parallel extraction (it is the correct approach for I/O-bound work). Each extraction writes its own per-repo cache file independently. No shared mutable state between extractions beyond the `perRepoCache` Map, which is only written after extraction completes.
**Warning signs:** Corrupt cache files or partial writes. Mitigated by writing each file independently.

### Pitfall 3: Pre-cache Hash Mismatch with Plugin Hash

**What goes wrong:** The sync executor computes a per-repo hash for pre-caching, but the plugin computes a different hash. The pre-cached data is never used because the hash doesn't match.
**Why it happens:** The sync executor and the plugin must use identical hash inputs. The plugin hashes `[reposConfigHash, alias, headSha, dirtyFiles]`. The sync executor needs access to `reposConfigHash` (which comes from `hashObject(config.repos ?? {})`).
**How to avoid:** Extract the hash computation into a shared function that both `cache.ts` and the sync executor can call. `resolvePluginConfig()` (in `config/resolve.ts`) already returns `{ config, entries }` where `config` is the full `PolyrepoConfig` -- verified in source. The sync executor can compute `hashObject(config.repos ?? {})` using the same `hashObject` from `nx/src/devkit-internals`. Export `computeRepoHash` from `cache.ts` so both consumers use the identical function.
**Warning signs:** Cache miss on first Nx command after sync despite pre-caching. Check hash values in the cache file vs. what the plugin computes.

### Pitfall 4: Dockerfile ENV Removal Breaks Build-Time Commands

**What goes wrong:** Removing `ENV NX_DAEMON=false` from the `workspace` stage causes build-time `RUN` commands to try starting a daemon inside Docker build.
**Why it happens:** The `workspace` stage has two `RUN` commands that invoke Nx (lines 89 and 116 in the snapshot stage). These already have inline `NX_DAEMON=false` prefixes. But if there are others without the inline prefix, they could try to start a daemon.
**How to avoid:** Audit all `RUN` commands in the `workspace` and `snapshot` stages. Line 89 (`NX_DAEMON=false npx nx show projects`) and line 116 (`NX_DAEMON=false npx nx show projects`) already have inline NX_DAEMON=false. The `workspace` stage line 76 (`cd /workspace && git init && git add . && git commit -m "initial"`) does not invoke Nx. Safe to remove the `ENV`.
**Warning signs:** Docker build hanging at a `RUN` step that invokes Nx. The daemon cannot start properly during `docker build` because there is no persistent process.

### Pitfall 5: E2e Container Daemon Startup Timing

**What goes wrong:** Container starts with `NX_DAEMON=true` (or unset, which defaults to daemon enabled). First `nx graph --print` command may fail because the daemon needs time to start and build the initial graph.
**Why it happens:** The daemon is a background process that starts on the first Nx command. Graph computation happens asynchronously. If the command returns before the daemon has fully initialized, results may be incomplete or the command may timeout.
**How to avoid:** The testcontainers start with `sleep infinity` as the command. The first `exec` call triggers daemon startup. Allow sufficient timeout (the existing 300s test timeout should be adequate). If flaky, add a warmup `exec` call that runs `npx nx show projects` before the actual test assertion.
**Warning signs:** Flaky failures on the first `nx graph --print` call with timeout or stale data. Succeeds on retry.

### Pitfall 6: Backoff State Survives Across Test Cases

**What goes wrong:** Unit tests for the backoff mechanism leave failure state in the module-level `failureStates` Map. Subsequent tests see unexpected backoff behavior.
**Why it happens:** Module-level state persists within a test file's module instance.
**How to avoid:** Use `vi.resetModules()` and dynamic imports, same pattern as existing `cache.spec.ts`. Alternatively, export a `resetFailureStates()` function for testing (guarded by `process.env.NODE_ENV === 'test'` or similar).
**Warning signs:** Backoff tests pass individually but fail when run after failure-recording tests.

### Pitfall 7: `reposConfigHash` vs `pluginOptionsHash` Naming

**What goes wrong:** The existing code uses `pluginOptionsHash` which was recently changed to hash only `config.repos` (not the full options including `implicitDependencies`). The naming is inconsistent.
**Why it happens:** Phase 10 decision (see STATE.md): "Cache key uses only repos config hash, not full options hash -- detection-only options (overrides, negations) don't invalidate extraction cache." The variable name `pluginOptionsHash` in `populateGraphReport` signature is stale.
**How to avoid:** Rename the parameter to `reposConfigHash` during the refactor to match its actual semantics. This is a naming-only change with no behavioral impact.
**Warning signs:** Confusion during code review about what the hash covers.

## Code Examples

### Per-repo Cache File I/O

```typescript
// Source: derived from existing cache.ts patterns
import { readJsonFile, writeJsonFile } from '@nx/devkit';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const PER_REPO_CACHE_FILENAME = '.polyrepo-graph-cache.json';

interface PerRepoCacheFile {
  hash: string;
  report: {
    nodes: Record<string, TransformedNode>;
    dependencies: Array<{ source: string; target: string; type: string }>;
  };
}

function getPerRepoCachePath(workspaceRoot: string, alias: string): string {
  return join(workspaceRoot, '.repos', alias, PER_REPO_CACHE_FILENAME);
}

function tryReadPerRepoCache(
  workspaceRoot: string,
  alias: string,
): PerRepoCacheFile | undefined {
  try {
    return readJsonFile<PerRepoCacheFile>(
      getPerRepoCachePath(workspaceRoot, alias),
    );
  } catch {
    return undefined;
  }
}

function writePerRepoCache(
  workspaceRoot: string,
  alias: string,
  hash: string,
  report: PerRepoCacheFile['report'],
): void {
  try {
    const repoDir = join(workspaceRoot, '.repos', alias);

    if (!existsSync(repoDir)) {
      mkdirSync(repoDir, { recursive: true });
    }

    writeJsonFile(getPerRepoCachePath(workspaceRoot, alias), { hash, report });
  } catch {
    // Non-fatal -- in-memory cache is still valid
  }
}
```

### Container Environment Forwarding

```typescript
// Source: derived from existing container.ts pattern + testcontainers withEnvironment API
import { GenericContainer, type StartedTestContainer } from 'testcontainers';

export async function startContainer(
  snapshotImage: string,
  name: string,
): Promise<StartedTestContainer> {
  let container = new GenericContainer(snapshotImage)
    .withName(`op-nx-polyrepo-e2e-${name}`)
    .withCommand(['sleep', 'infinity']);

  // Forward NX_DAEMON from host environment to container
  const nxDaemon = process.env['NX_DAEMON'];

  if (nxDaemon !== undefined) {
    container = container.withEnvironment({ NX_DAEMON: nxDaemon });
  }

  return container.start();
}
```

### Sync Executor Pre-caching Integration Point

```typescript
// Source: derived from existing sync executor pattern (executor.ts:259-340)
// The pre-cache call goes after successful install, inside syncRepo():

// After installDeps succeeds:
const installed = await tryInstallDeps(
  repoPath,
  entry.alias,
  verbose,
  workspaceRoot,
);

if (installed) {
  // Pre-cache graph for daemon warm start
  await preCacheGraph(repoPath, entry.alias, workspaceRoot, reposConfigHash);
}
```

### Actionable Warning Message

```typescript
// Source: derived from CONTEXT.md error recovery decisions
function logExtractionFailure(alias: string, error: unknown): void {
  const msg = error instanceof Error ? error.message : String(error);

  logger.warn(`Graph extraction failed for ${alias}: ${msg}`);
  logger.warn('Troubleshooting steps:');
  logger.warn(`  1. Run: nx polyrepo-sync`);
  logger.warn(`  2. Run: NX_DAEMON=false nx graph`);
  logger.warn(`  3. Check: .repos/${alias}/ (nx.json, node_modules)`);
  logger.warn(`  4. Run: NX_PLUGIN_NO_TIMEOUTS=true nx graph`);
}
```

## State of the Art

| Old Approach                                                       | Current Approach                                                   | When Changed   | Impact                                                                                       |
| ------------------------------------------------------------------ | ------------------------------------------------------------------ | -------------- | -------------------------------------------------------------------------------------------- |
| Single monolithic cache file (`.repos/.polyrepo-graph-cache.json`) | Per-repo cache files (`.repos/<alias>/.polyrepo-graph-cache.json`) | Phase 11 (now) | Independent invalidation per repo; scales to 10+ repos without re-reading entire cache       |
| Cold start requires `NX_DAEMON=false`                              | Daemon-compatible with pre-caching during sync                     | Phase 11 (now) | First Nx command after sync hits warm disk cache; no manual `NX_DAEMON=false` needed         |
| No error recovery                                                  | Exponential backoff with hash-change reset per repo                | Phase 11 (now) | Failed repos don't repeatedly penalize every Nx command; user fixes are detected immediately |
| E2e tests run only with `NX_DAEMON=false`                          | E2e tests verify both daemon modes via CI matrix                   | Phase 11 (now) | Confidence that the plugin works under production daemon mode                                |

**Deprecated/outdated:**

- The monolithic `.repos/.polyrepo-graph-cache.json` file is replaced by per-repo files. The old file path should be cleaned up (deleted if present) during the first invocation of the new cache.

## Open Questions

1. **Sync executor access to reposConfigHash -- RESOLVED**
   - `resolvePluginConfig()` in `config/resolve.ts` returns `{ config, entries }` where `config` is the full `PolyrepoConfig`. The sync executor already uses `resolvePluginConfig(context.root)` at line 444 of `executor.ts`. It can compute `hashObject(config.repos ?? {})` using the same `hashObject` from `nx/src/devkit-internals`. No code changes needed to `resolve.ts`.

2. **Parallel vs sequential extraction during sync pre-caching**
   - What we know: Sync already processes repos in parallel via `Promise.allSettled` (line 452 of `executor.ts`). Graph extraction is I/O-bound (child process).
   - What's unclear: Whether running extraction in parallel with other repos' installs could cause resource contention (CPU, memory from multiple Nx processes).
   - Recommendation: Run extraction sequentially within each repo's sync flow (extract after that repo's install completes). The sync itself is already parallel across repos, so extraction naturally overlaps with other repos' clone/install. This is simpler and avoids resource spikes.

3. **Old cache file cleanup**
   - What we know: The old cache lives at `.repos/.polyrepo-graph-cache.json`. The new caches live at `.repos/<alias>/.polyrepo-graph-cache.json`.
   - What's unclear: Whether to actively delete the old file or just ignore it.
   - Recommendation: Delete the old file on first invocation of the new cache. A one-time check at the start of `populateGraphReport` is sufficient. This prevents confusion and reclaims disk space.

## Validation Architecture

### Test Framework

| Property           | Value                                                                                                        |
| ------------------ | ------------------------------------------------------------------------------------------------------------ |
| Framework          | Vitest (workspace version)                                                                                   |
| Config file        | `packages/op-nx-polyrepo/vitest.config.mts` (unit) and `packages/op-nx-polyrepo-e2e/vitest.config.mts` (e2e) |
| Quick run command  | `npm exec nx -- test @op-nx/polyrepo --output-style=static`                                                  |
| Full suite command | `npm exec nx -- run-many -t test,e2e --output-style=static`                                                  |

### Phase Requirements -> Test Map

Phase 11 has no explicit requirement IDs from REQUIREMENTS.md. Requirements are derived from CONTEXT.md decisions.

| Req ID    | Behavior                                                              | Test Type | Automated Command                                                                         | File Exists?                                                      |
| --------- | --------------------------------------------------------------------- | --------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| DAEMON-01 | Per-repo cache: in-memory hit returns instantly (global gate)         | unit      | `npm exec nx -- test @op-nx/polyrepo --output-style=static -- --run -t "global gate"`     | Partial -- `cache.spec.ts` exists, needs refactoring for per-repo |
| DAEMON-02 | Per-repo cache: disk hit restores per-repo data                       | unit      | `npm exec nx -- test @op-nx/polyrepo --output-style=static -- --run -t "disk cache"`      | Partial -- `cache.spec.ts` exists, needs new per-repo tests       |
| DAEMON-03 | Per-repo cache: changed repo re-extracts, unchanged repos stay cached | unit      | `npm exec nx -- test @op-nx/polyrepo --output-style=static -- --run -t "selective"`       | No -- new test                                                    |
| DAEMON-04 | Pre-caching during sync writes per-repo cache after install           | unit      | `npm exec nx -- test @op-nx/polyrepo --output-style=static -- --run -t "pre-cache"`       | No -- new test in `executor.spec.ts`                              |
| DAEMON-05 | Pre-caching failure warns and continues                               | unit      | `npm exec nx -- test @op-nx/polyrepo --output-style=static -- --run -t "pre-cache.*warn"` | No -- new test                                                    |
| DAEMON-06 | Exponential backoff skips extraction during cooldown                  | unit      | `npm exec nx -- test @op-nx/polyrepo --output-style=static -- --run -t "backoff"`         | No -- new test                                                    |
| DAEMON-07 | Hash change resets backoff immediately                                | unit      | `npm exec nx -- test @op-nx/polyrepo --output-style=static -- --run -t "hash.*reset"`     | No -- new test                                                    |
| DAEMON-08 | Actionable warning logged on extraction failure                       | unit      | `npm exec nx -- test @op-nx/polyrepo --output-style=static -- --run -t "warning"`         | No -- new test                                                    |
| DAEMON-09 | E2e: graph correct with NX_DAEMON=true                                | e2e       | `NX_DAEMON=true npm exec nx -- e2e op-nx-polyrepo-e2e --output-style=static`              | No -- needs env forwarding in container.ts                        |
| DAEMON-10 | E2e: graph correct with NX_DAEMON=false                               | e2e       | `NX_DAEMON=false npm exec nx -- e2e op-nx-polyrepo-e2e --output-style=static`             | Partial -- existing tests run this way                            |
| DAEMON-11 | E2e: graph correct with --skip-nx-cache                               | e2e       | `npm exec nx -- e2e op-nx-polyrepo-e2e --output-style=static`                             | No -- new assertion                                               |

### Sampling Rate

- **Per task commit:** `npm exec nx -- test @op-nx/polyrepo --output-style=static`
- **Per wave merge:** `npm exec nx -- run-many -t test,lint --output-style=static`
- **Phase gate:** `npm exec nx -- run-many -t test,lint,e2e --output-style=static` (full suite green before `/gsd:verify-work`)

### Wave 0 Gaps

- [ ] Refactor `cache.spec.ts` tests for per-repo cache architecture (update existing tests, add new per-repo scenarios)
- [ ] New tests in `cache.spec.ts` for backoff/retry mechanism
- [ ] New tests in `executor.spec.ts` for pre-cache during sync
- [ ] Update `container.ts` for env forwarding -- enables daemon-on e2e tests
- [ ] Dockerfile modification (remove `ENV NX_DAEMON=false` from workspace stage)

## Sources

### Primary (HIGH confidence)

- `packages/op-nx-polyrepo/src/lib/graph/cache.ts` -- current cache implementation (155 lines), module-level state pattern, two-layer cache
- `packages/op-nx-polyrepo/src/lib/graph/extract.ts` -- graph extraction (147 lines), child process with `NX_DAEMON=false`
- `packages/op-nx-polyrepo/src/lib/graph/cache.spec.ts` -- existing cache tests (396 lines), `vi.resetModules()` pattern for module-level state
- `packages/op-nx-polyrepo/src/lib/executors/sync/executor.ts` -- sync executor (526 lines), `syncRepo` and `tryInstallDeps` integration points
- `packages/op-nx-polyrepo/src/lib/config/resolve.ts` -- `resolvePluginConfig` returns `{ config, entries }` with full `PolyrepoConfig` (60 lines)
- `packages/op-nx-polyrepo/src/index.ts` -- plugin entry (185 lines), `createNodesV2` and `createDependencies` hooks
- `packages/op-nx-polyrepo/src/index.spec.ts` -- existing plugin unit tests (755 lines), SIFERS mock pattern
- `packages/op-nx-polyrepo-e2e/docker/Dockerfile` -- Docker build stages, `ENV NX_DAEMON=false CI=true` at line 58
- `packages/op-nx-polyrepo-e2e/src/setup/container.ts` -- `startContainer` helper, `getProjectGraph`, `writeNxJson`
- `packages/op-nx-polyrepo-e2e/src/setup/global-setup.ts` -- e2e lifecycle, NX_DAEMON save/restore at lines 35/45
- Testcontainers `withEnvironment()` API -- verified via runtime check: `GenericContainer.prototype.withEnvironment` accepts `Record<string, string>`

### Secondary (MEDIUM confidence)

- [Nx Daemon docs](https://nx.dev/docs/concepts/nx-daemon) -- daemon lifecycle, `NX_DAEMON` env var, cache invalidation
- [Nx plugin graph docs](https://nx.dev/docs/extending-nx/project-graph-plugins) -- `createNodesV2`/`createDependencies` API, plugin isolation
- [nrwl/nx#29374](https://github.com/nrwl/nx/issues/29374) -- 5-second plugin worker socket timeout
- [nrwl/nx#34442](https://github.com/nrwl/nx/issues/34442) -- plugin worker connection timeout in Nx 22.x
- [nrwl/nx#33472](https://github.com/nrwl/nx/issues/33472) -- "Plugin Workers should not start a new daemon process"
- [Testcontainers Node docs](https://node.testcontainers.org/features/containers/) -- `withEnvironment` API

### Tertiary (LOW confidence)

- None -- all findings verified against source code or official docs

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH -- no new libraries, all existing infrastructure
- Architecture: HIGH -- per-repo cache is a natural refactor of existing code; all integration points verified in source
- Pitfalls: HIGH -- patterns verified against existing codebase; daemon behavior confirmed via Nx docs and issues
- E2e strategy: HIGH -- testcontainers `withEnvironment` verified at runtime; Dockerfile audit confirms safe `ENV` removal

**Research date:** 2026-03-20
**Valid until:** 2026-04-20 (stable -- Nx plugin API, testcontainers, and caching patterns are mature)
