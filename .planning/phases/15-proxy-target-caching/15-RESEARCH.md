# Phase 15: Proxy Target Caching - Research

**Researched:** 2026-03-22
**Domain:** Nx plugin lifecycle hooks, task hashing, git-based cache invalidation
**Confidence:** HIGH

## Summary

Phase 15 enables host-level Nx caching for proxy targets by using the `preTasksExecution` plugin lifecycle hook to set per-repo environment variables based on git state, and then using `{ "env": "POLYREPO_HASH_<ALIAS>" }` inputs on proxy targets. This approach completely bypasses the known Nx daemon runtime input caching bug (nrwl/nx#30170) because env inputs use a stateless code path (`hash_env.rs`) with no DashMap caching layer.

The implementation touches three files: `index.ts` (new `preTasksExecution` export), `transform.ts` (change `cache: false, inputs: []` to `cache: true, inputs: [{ env: "POLYREPO_HASH_<ALIAS>" }]`), and their corresponding test files. The sync executor (`executor.ts`) gains a conditional `nx reset` call only if the primary approach fails verification (PROXY-04 fallback). All behavior verified against Nx 22.5.4 source code.

**Primary recommendation:** Implement `preTasksExecution` + env inputs as the sole caching mechanism. The approach is verified against Nx internals, works identically with daemon on/off/unset, and avoids the runtime input DashMap bug entirely.

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions

- **Caching mechanism:** `preTasksExecution` hook + env inputs (primary). Sets `process.env.POLYREPO_HASH_<ALIAS>` per CLI invocation. Proxy targets use `{ "env": "POLYREPO_HASH_<ALIAS>" }` input. Bypasses nrwl/nx#30170 entirely.
- **Hash content:** `git rev-parse HEAD` (~2ms) + `git status --porcelain` (~5ms) per repo. Hash: `hashArray([headSha, dirty ? 'dirty' : 'clean'])`. Does NOT distinguish between different dirty states.
- **Git failure behavior:** Set env var to random UUID (forces cache-miss every invocation). Print deduplicated stderr warning with sync hint. Failure must NOT block unrelated targets.
- **PROXY-04:** Conditional requirement. Activates ONLY if preTasksExecution + env inputs fails verification. If activated: sync executor runs `nx reset` after sync.
- **Requirements updates:** PROXY-02 reworded to "preTasksExecution + env input per repo alias". PROXY-04 marked conditional. PROXY-05 satisfied by design.
- **Verification:** Scorched earth testing under 3 daemon modes (NX_DAEMON=true, false, unset). 9 test scenarios covering functional correctness, recovery, and cache bypass.

### Claude's Discretion

- Warning deduplication mechanism (temp file sentinel vs best-effort)
- preTasksExecution error handling strategy (swallow vs propagate)
- Reuse of `computeRepoHash` from cache.ts vs independent implementation
- Env var naming normalization for aliases with special characters
- Exact test structure and assertion design

### Deferred Ideas (OUT OF SCOPE)

- Per-target runtime inputs for finer cache granularity (PROXY-F1)
- Output caching for proxy targets (PROXY-F2)
- Contributing PR to fix nrwl/nx#30170 upstream

</user_constraints>

<phase_requirements>

## Phase Requirements

| ID       | Description                                                          | Research Support                                                                                                                                          |
| -------- | -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PROXY-01 | Proxy targets set `cache: true`                                      | Change `createProxyTarget` in `transform.ts` line 115 from `cache: false` to `cache: true`                                                                |
| PROXY-02 | Proxy targets include preTasksExecution + env input per repo alias   | New `preTasksExecution` export in `index.ts` sets `POLYREPO_HASH_<ALIAS>` env vars; `createProxyTarget` uses `inputs: [{ env: "POLYREPO_HASH_<ALIAS>" }]` |
| PROXY-03 | Failed git commands produce random UUID, not constant hash           | `preTasksExecution` catches git errors per-repo, sets env var to `crypto.randomUUID()`                                                                    |
| PROXY-04 | Conditional: sync executor runs `nx reset` if primary approach fails | Sync executor in `executor.ts` gains optional `nx reset` call after sync completes                                                                        |
| PROXY-05 | Caching works with NX_DAEMON=true, false, unset                      | Env inputs use stateless `hash_env.rs` path -- no daemon-specific behavior. Verified in source.                                                           |

</phase_requirements>

## Standard Stack

### Core

| Library              | Version  | Purpose                                    | Why Standard                |
| -------------------- | -------- | ------------------------------------------ | --------------------------- |
| `nx`                 | 22.5.4   | Task runner, hasher, daemon, plugin system | Workspace runtime           |
| `@nx/devkit`         | >=20.0.0 | `hashArray`, `logger`, type definitions    | Plugin API                  |
| `node:child_process` | built-in | `execFile` for git commands                | Already used in `detect.ts` |
| `node:crypto`        | built-in | `randomUUID()` for git failure fallback    | Standard Node.js API        |

### Supporting

| Library  | Version     | Purpose           | When to Use                     |
| -------- | ----------- | ----------------- | ------------------------------- |
| `vitest` | (workspace) | Unit tests        | All new test files              |
| `zod`    | ^4.0.0      | Config validation | Already used, no new dependency |

### Alternatives Considered

| Instead of                       | Could Use                       | Tradeoff                                                         |
| -------------------------------- | ------------------------------- | ---------------------------------------------------------------- |
| `preTasksExecution` + env inputs | `runtime` inputs                | Broken by nrwl/nx#30170 -- daemon caches results forever         |
| `preTasksExecution` + env inputs | Custom hasher (`hasherFactory`) | Over-engineered, breaks batch hashing, not composable            |
| `hashArray` from `@nx/devkit`    | `crypto.createHash`             | hashArray is the Nx-idiomatic way, consistent with cache.ts      |
| `execFile` (async)               | `execFileSync`                  | Hook is async, no need for sync; async matches existing patterns |

**Installation:** No new dependencies needed.

## Architecture Patterns

### Recommended Project Structure (changes only)

```
packages/op-nx-polyrepo/src/
  index.ts                            # ADD: preTasksExecution export
  index.spec.ts                       # ADD: preTasksExecution tests
  lib/
    graph/
      transform.ts                    # MODIFY: createProxyTarget cache/inputs
      transform.spec.ts               # MODIFY: update cache/inputs assertions
      cache.ts                        # REUSE: computeRepoHash pattern (reference)
    git/
      detect.ts                       # REUSE: getHeadSha, existing pattern
    executors/
      sync/
        executor.ts                   # MODIFY: conditional nx reset (PROXY-04 only)
        executor.spec.ts              # ADD: nx reset test (conditional)
```

### Pattern 1: preTasksExecution Hook Export

**What:** Plugin exports a `preTasksExecution` function that Nx calls once per CLI invocation, before any task hashing.

**When to use:** When you need to compute values that feed into task hashing but cannot use `runtime` inputs (due to daemon caching bug) or file-based inputs (due to gitignored paths).

**Example:**

```typescript
// Source: Nx public-api.d.ts line 94, loaded-nx-plugin.js lines 61-80
import type { PreTasksExecution } from 'nx/src/project-graph/plugins/public-api';
import type { PolyrepoConfig } from './lib/config/schema';

export const preTasksExecution: PreTasksExecution<PolyrepoConfig> = async (
  options,
  context,
) => {
  // Compute per-repo hashes
  for (const [alias, repoPath] of repos) {
    const envKey = `POLYREPO_HASH_${alias.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
    try {
      const headSha = await getHeadSha(repoPath);
      const porcelain = await getStatusPorcelain(repoPath);
      const dirty = porcelain.length > 0;
      process.env[envKey] = hashArray([headSha, dirty ? 'dirty' : 'clean']);
    } catch {
      process.env[envKey] = randomUUID();
      // warn once
    }
  }
};
```

**How Nx captures env mutations:**

```
1. Plugin sets process.env[key] = value
2. LoadedNxPlugin Proxy intercepts set() call
3. Proxy records mutation in `updates` object
4. Updates sent back to CLI client (even through daemon IPC)
5. CLI client applies via applyProcessEnvs()
6. hashTasks() receives updated process.env
7. hash_env() in Rust reads from fresh js_env HashMap (no cache)
```

**Verification chain (source code confirmed):**

- `loaded-nx-plugin.js` lines 61-80: Proxy wraps `process.env` when isolation or daemon enabled
- `tasks-execution-hooks.js`: `runPreTasksExecution` collects env arrays, `applyProcessEnvs` sets them
- `run-command.js` line 290: `runPreTasksExecution` called BEFORE `runCommandForTasks` (line 297)
- `hash-task.js` line 42: `hasher.hashTasks(tasksToHash, taskGraph, process.env)` -- uses current env

### Pattern 2: Env Input on Proxy Targets

**What:** Each proxy target declares `inputs: [{ env: "POLYREPO_HASH_<ALIAS>" }]` to tell Nx's hasher that the task's cache key depends on this environment variable.

**When to use:** When the cache invalidation signal is an environment variable set during `preTasksExecution`.

**Example:**

```typescript
// In createProxyTarget (transform.ts)
function createProxyTarget(
  repoAlias: string,
  originalProject: string,
  targetName: string,
  rawTargetConfig: unknown,
): TargetConfiguration {
  const envKey = `POLYREPO_HASH_${repoAlias.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;

  return {
    executor: '@op-nx/polyrepo:run',
    options: { repoAlias, originalProject, targetName },
    inputs: [{ env: envKey }],
    cache: true,
    // ... rest unchanged
  };
}
```

### Pattern 3: Git Failure Fallback with Random UUID

**What:** When git commands fail (repo not synced, corrupt `.git`), set the env var to `crypto.randomUUID()` instead of a constant string. This forces a cache miss every invocation, preventing stale cached results.

**Why not a constant like "error"?** A constant hash would be cached by Nx, meaning every subsequent invocation would be a cache HIT returning potentially stale results from the last successful run. A random UUID ensures every invocation is a cache MISS.

**Example:**

```typescript
import { randomUUID } from 'node:crypto';

try {
  const headSha = await getHeadSha(repoPath);
  // ...
} catch {
  process.env[envKey] = randomUUID();
  warnOnce(alias);
}
```

### Anti-Patterns to Avoid

- **Using `runtime` inputs:** Broken by nrwl/nx#30170. The daemon's DashMap caches the command output forever, meaning the second CLI invocation gets a stale hash.
- **Using a constant fallback on git failure:** A constant like `"error"` or `""` would be cached, permanently serving stale results until `nx reset`.
- **Running git synchronously in createNodesV2:** `createNodesV2` runs during graph computation, which is cached separately. Git state checks must happen per-CLI-invocation via `preTasksExecution`.
- **Computing hash inside the executor:** Too late -- the hash determines WHETHER the executor runs. If the hash matches, the executor is skipped entirely (cache hit).

## Don't Hand-Roll

| Problem            | Don't Build                 | Use Instead                                      | Why                                                        |
| ------------------ | --------------------------- | ------------------------------------------------ | ---------------------------------------------------------- |
| Array hashing      | Custom sha256 concatenation | `hashArray` from `@nx/devkit`                    | Nx-idiomatic, consistent with cache.ts, handles edge cases |
| Git HEAD detection | Parse `.git/HEAD` file      | `git rev-parse HEAD` via `execFile`              | Handles worktrees, packed refs, edge cases                 |
| Dirty detection    | Parse `.git/index`          | `git status --porcelain` via `execFile`          | Handles submodules, renames, complex states                |
| Random UUID        | Custom random string        | `crypto.randomUUID()`                            | Cryptographically secure, RFC 4122 compliant, built-in     |
| Env var naming     | Manual uppercasing          | `alias.toUpperCase().replace(/[^A-Z0-9]/g, '_')` | Handles all special chars (hyphens, dots, etc.)            |

**Key insight:** The hash computation in `preTasksExecution` is intentionally simpler than `computeRepoHash` in `cache.ts`. The graph cache needs per-file dirty tracking (for extraction invalidation), but the proxy target cache only needs "did anything change?" at the repo level.

## Common Pitfalls

### Pitfall 1: Forgetting the Proxy Capture Mechanism is Conditional

**What goes wrong:** Setting `process.env` in `preTasksExecution` but the mutations don't reach the CLI client.
**Why it happens:** The Proxy wrapper in `loaded-nx-plugin.js` (line 65) only activates when `isIsolationEnabled() || isDaemonEnabled()`. Without daemon AND without isolation, mutations go directly to `process.env` of the same process -- which works because `hashTasks` reads the same `process.env`.
**How to avoid:** This actually works in all three modes: (1) daemon enabled = Proxy captures + IPC, (2) non-daemon + isolation = Proxy captures, (3) non-daemon + non-isolated = direct mutation. No special handling needed.
**Warning signs:** Tests pass with `NX_DAEMON=false` but fail with `NX_DAEMON=true`.

### Pitfall 2: preTasksExecution Runs for ALL Nx Commands

**What goes wrong:** Computing git hashes adds latency to every `nx run`, `nx graph`, `nx affected`, etc.
**Why it happens:** `preTasksExecution` runs in `runCommand()` which handles ALL task execution commands.
**How to avoid:** Keep the hook fast. `git rev-parse HEAD` is ~2ms, `git status --porcelain` is ~5ms per repo. For 3 repos = ~21ms total. Acceptable.
**Warning signs:** `nx graph` suddenly takes 500ms+ longer (would indicate git commands hanging).

### Pitfall 3: createProxyTarget Needs the Alias to Compute the Env Key

**What goes wrong:** `createProxyTarget` currently receives `repoAlias` but doesn't use it for inputs. The env key naming (`POLYREPO_HASH_<ALIAS>`) must match between `preTasksExecution` and `createProxyTarget`.
**Why it happens:** The normalization logic (uppercase, replace non-alphanumeric with underscore) must be identical in both places.
**How to avoid:** Extract a shared `toEnvKey(alias: string): string` utility function used by both `preTasksExecution` and `createProxyTarget`.
**Warning signs:** Cache never hits because env key names don't match.

### Pitfall 4: Test Mocking Must Account for process.env Mutation

**What goes wrong:** Unit tests for `preTasksExecution` need to verify that `process.env` is mutated, but vitest may snapshot or freeze env.
**Why it happens:** `process.env` is a global singleton. Tests must clean up after themselves.
**How to avoid:** Save `process.env[key]` before test, delete after. Or mock the git functions and verify the env key/value contract.
**Warning signs:** Tests pass in isolation but fail when run together (env pollution).

### Pitfall 5: Existing Tests Assert cache: false and inputs: []

**What goes wrong:** Changing `createProxyTarget` to `cache: true` and `inputs: [{ env: ... }]` breaks existing `transform.spec.ts` assertions.
**Why it happens:** Multiple tests explicitly check `cache: false` and `inputs: []`.
**How to avoid:** Update all affected assertions in `transform.spec.ts` and `index.spec.ts` simultaneously.
**Warning signs:** Test suite fails after modifying `createProxyTarget`.

### Pitfall 6: The Minified Export Name in Compiled Nx

**What goes wrong:** Nx's compiled JS minifies `preTasksExecution` to `n` in some files (e.g., `isolated-plugin.js`). But `load-resolved-plugin.js` checks for the string `'preTasksExecution'` on the module object.
**Why it happens:** The plugin loader uses the unminified name because it's checking the user's plugin exports, not Nx internals.
**How to avoid:** Export as `export const preTasksExecution` -- this is the correct name the loader checks for.
**Warning signs:** Hook never fires (Nx doesn't detect it).

## Code Examples

### Example 1: Shared Env Key Utility

```typescript
// Shared between preTasksExecution (index.ts) and createProxyTarget (transform.ts)
/**
 * Convert a repo alias to the environment variable name used for proxy target caching.
 * Uppercases and replaces any non-alphanumeric character with underscore.
 */
export function toProxyHashEnvKey(alias: string): string {
  return `POLYREPO_HASH_${alias.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
}
```

### Example 2: preTasksExecution Implementation

```typescript
// Source: Verified against loaded-nx-plugin.js lines 61-80, run-command.js line 290
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { hashArray } from '@nx/devkit';
import type { PreTasksExecution } from 'nx/src/project-graph/plugins/public-api';
import type { PolyrepoConfig } from './lib/config/schema';
import { normalizeRepos } from './lib/config/schema';
import { getHeadSha } from './lib/git/detect';
import { toProxyHashEnvKey } from './lib/graph/proxy-hash';

export const preTasksExecution: PreTasksExecution<PolyrepoConfig> = async (
  options,
  context,
) => {
  if (!options?.repos) {
    return;
  }

  const entries = normalizeRepos(options);

  for (const entry of entries) {
    const repoPath =
      entry.type === 'remote'
        ? join(context.workspaceRoot, '.repos', entry.alias)
        : entry.path;
    const envKey = toProxyHashEnvKey(entry.alias);

    if (!existsSync(join(repoPath, '.git'))) {
      process.env[envKey] = randomUUID();
      // Repo not synced -- will miss cache every time
      continue;
    }

    try {
      const headSha = await getHeadSha(repoPath);
      // git status --porcelain for dirty detection
      const porcelainOutput = await getStatusPorcelain(repoPath);
      const dirty = porcelainOutput.length > 0;
      process.env[envKey] = hashArray([headSha, dirty ? 'dirty' : 'clean']);
    } catch {
      process.env[envKey] = randomUUID();
      // Log warning (deduplicated)
    }
  }
};
```

### Example 3: Updated createProxyTarget

```typescript
// Source: transform.ts, currently lines 103-126
function createProxyTarget(
  repoAlias: string,
  originalProject: string,
  targetName: string,
  rawTargetConfig: unknown,
): TargetConfiguration {
  const config = isRecord(rawTargetConfig) ? rawTargetConfig : {};
  const envKey = toProxyHashEnvKey(repoAlias);

  return {
    executor: '@op-nx/polyrepo:run',
    options: { repoAlias, originalProject, targetName },
    inputs: [{ env: envKey }],
    cache: true,
    dependsOn: rewriteDependsOn(config['dependsOn'], repoAlias),
    configurations: isRecordOfRecords(config['configurations'])
      ? config['configurations']
      : undefined,
    parallelism:
      typeof config['parallelism'] === 'boolean'
        ? config['parallelism']
        : undefined,
    metadata: isRecord(config['metadata']) ? config['metadata'] : undefined,
  };
}
```

### Example 4: git status --porcelain Helper

```typescript
// New function in detect.ts (or reuse pattern from getWorkingTreeState)
export async function getStatusPorcelain(cwd: string): Promise<string> {
  return execGitOutput(['status', '--porcelain'], cwd);
}
```

**Note:** The existing `getDirtyFiles` uses `git diff --name-only HEAD` which does not capture untracked files. `git status --porcelain` captures all workspace changes (modified, staged, deleted, untracked). The CONTEXT.md decision says "git status --porcelain" so use that.

## State of the Art

| Old Approach                             | Current Approach                    | When Changed     | Impact                                                   |
| ---------------------------------------- | ----------------------------------- | ---------------- | -------------------------------------------------------- |
| `runtime` inputs for dynamic values      | `preTasksExecution` + `env` inputs  | Nx 20.5.0 (2024) | Bypasses daemon runtime cache bug                        |
| `cache: false` on proxy targets          | `cache: true` with env-based inputs | This phase       | Eliminates 2-5s child Nx bootstrap per cached invocation |
| Single `inputs: []` on external projects | `inputs: [{ env: "..." }]` per repo | This phase       | Enables meaningful cache invalidation                    |

**Deprecated/outdated:**

- `runtime` inputs with daemon: Permanently broken (nrwl/nx#30170, open 13+ months). Do not use for values that change between CLI invocations.
- `createNodes` (v1): Replaced by `createNodesV2`. Already using v2 in this project.

## Discretion Recommendations

### Warning Deduplication: Best-Effort In-Memory Set

**Recommendation:** Use a module-level `Set<string>` to track which aliases have already been warned. Reset per process lifetime (which is per CLI invocation in non-daemon mode, and per daemon session in daemon mode).

```typescript
const warnedAliases = new Set<string>();

function warnGitFailure(alias: string): void {
  if (warnedAliases.has(alias)) {
    return;
  }
  warnedAliases.add(alias);
  logger.warn(
    `[WARN] polyrepo: git failed for '${alias}', cache bypassed. ` +
      `Hint: run 'nx polyrepo-sync' if repo is not yet cloned.`,
  );
}
```

**Why not temp file sentinel:** Adds filesystem I/O complexity, cleanup concerns, and race conditions. A memory-based set is simpler and sufficient -- `preTasksExecution` runs once per CLI invocation, so deduplication within a single invocation prevents duplicate warnings for the same alias. Across CLI invocations, repeating the warning is acceptable (user needs reminding).

**Confidence:** HIGH -- simplest approach, no edge cases.

### preTasksExecution Error Handling: Swallow Per-Repo, Never Propagate

**Recommendation:** Catch errors per-repo inside the loop. Never let a single repo's git failure propagate and kill the entire hook. Set the random UUID fallback and continue to the next repo.

```typescript
for (const entry of entries) {
  try {
    // ... compute hash
  } catch (error) {
    process.env[envKey] = randomUUID();
    warnGitFailure(entry.alias);
    // Continue to next repo
  }
}
```

**Why:** The CONTEXT.md explicitly states "Failure in preTasksExecution must NOT block unrelated targets from running." Swallowing per-repo and falling back to UUID satisfies this requirement while ensuring the affected repo's targets always re-execute (no stale cache).

**Confidence:** HIGH -- directly follows user requirement.

### Code Reuse: New Utility, Not cache.ts Reuse

**Recommendation:** Create a new `toProxyHashEnvKey` utility in a shared location (e.g., `lib/graph/proxy-hash.ts`). Do NOT reuse `computeRepoHash` from `cache.ts` because:

1. `computeRepoHash` includes `reposConfigHash` and `alias` in its hash -- not needed for proxy target caching (the env key already encodes the alias)
2. `computeRepoHash` uses `getDirtyFiles` (`git diff --name-only HEAD`) -- the CONTEXT.md decision says `git status --porcelain` for dirty detection
3. `computeRepoHash` is async and returns a hash string -- the proxy hash is simpler: `hashArray([headSha, dirty ? 'dirty' : 'clean'])`

However, DO reuse `getHeadSha` from `detect.ts` and add a new `getStatusPorcelain` helper alongside it.

**Confidence:** HIGH -- cleaner separation of concerns.

### Env Var Naming Normalization

**Recommendation:** `alias.toUpperCase().replace(/[^A-Z0-9]/g, '_')`. This handles:

- Hyphens: `repo-a` -> `POLYREPO_HASH_REPO_A`
- Dots: `org.repo` -> `POLYREPO_HASH_ORG_REPO`
- Slashes (if any): `org/repo` -> `POLYREPO_HASH_ORG_REPO`
- Already valid: `myrepo` -> `POLYREPO_HASH_MYREPO`

The regex `[^A-Z0-9]` after `toUpperCase()` catches all non-alphanumeric characters.

**Confidence:** HIGH -- standard env var naming convention.

## Open Questions

1. **Should `git status --porcelain` include untracked files?**
   - What we know: `git status --porcelain` includes untracked files by default. The CONTEXT.md decision says "dirty ? 'dirty' : 'clean'" -- any output means dirty.
   - What's unclear: Whether untracked files in child repos should invalidate the proxy cache. Likely yes -- untracked test fixtures or source files could affect build/test behavior.
   - Recommendation: Use `git status --porcelain` as-is (includes untracked). This is the safest approach -- over-invalidation is better than stale cache.

2. **Where to place the shared `toProxyHashEnvKey` utility?**
   - What we know: Both `index.ts` and `transform.ts` need it. It's a pure function with no dependencies.
   - What's unclear: Whether to create a new file or add to an existing module.
   - Recommendation: Create `lib/graph/proxy-hash.ts` with this single export. Clean separation, testable in isolation.

## Validation Architecture

### Test Framework

| Property           | Value                                       |
| ------------------ | ------------------------------------------- |
| Framework          | vitest (workspace version)                  |
| Config file        | `packages/op-nx-polyrepo/vitest.config.mts` |
| Quick run command  | `npm exec nx -- test @op-nx/polyrepo`       |
| Full suite command | `npm exec nx -- test @op-nx/polyrepo`       |

### Phase Requirements -> Test Map

| Req ID   | Behavior                                                             | Test Type | Automated Command                                                   | File Exists?                                                |
| -------- | -------------------------------------------------------------------- | --------- | ------------------------------------------------------------------- | ----------------------------------------------------------- |
| PROXY-01 | `createProxyTarget` sets `cache: true`                               | unit      | `npm exec nx -- test @op-nx/polyrepo -t "cache"`                    | Exists (needs update): `transform.spec.ts`                  |
| PROXY-02 | `createProxyTarget` uses env input; `preTasksExecution` sets env var | unit      | `npm exec nx -- test @op-nx/polyrepo -t "input\|preTasksExecution"` | Exists (needs update): `transform.spec.ts`, `index.spec.ts` |
| PROXY-03 | Git failure produces random UUID, warning logged                     | unit      | `npm exec nx -- test @op-nx/polyrepo -t "git fail\|random"`         | New in `index.spec.ts`                                      |
| PROXY-04 | Sync executor runs `nx reset` (conditional)                          | unit      | `npm exec nx -- test @op-nx/polyrepo -t "nx reset"`                 | New in `executor.spec.ts`                                   |
| PROXY-05 | Env inputs work identically regardless of daemon mode                | unit      | `npm exec nx -- test @op-nx/polyrepo -t "daemon"`                   | Satisfied by design (no daemon-specific code paths)         |

### Sampling Rate

- **Per task commit:** `npm exec nx -- test @op-nx/polyrepo`
- **Per wave merge:** `npm exec nx -- test @op-nx/polyrepo`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `lib/graph/proxy-hash.ts` -- new file with `toProxyHashEnvKey` utility
- [ ] `lib/graph/proxy-hash.spec.ts` -- unit tests for env key normalization
- [ ] `lib/git/detect.ts` -- new `getStatusPorcelain` helper (or verify existing `getWorkingTreeState` sufficiency)
- [ ] Update `transform.spec.ts` assertions for `cache: true` and `inputs: [{ env: ... }]`
- [ ] New `preTasksExecution` tests in `index.spec.ts`

## Sources

### Primary (HIGH confidence)

- Nx 22.5.4 source code at `node_modules/nx/`:
  - `src/project-graph/plugins/public-api.d.ts` -- `PreTasksExecution` type, `PreTasksExecutionContext` type, `NxPluginV2` interface
  - `src/project-graph/plugins/loaded-nx-plugin.js` lines 61-80 -- Proxy env capture mechanism
  - `src/project-graph/plugins/load-resolved-plugin.js` line 17 -- Plugin detection checks `'preTasksExecution' in m.default`
  - `src/project-graph/plugins/tasks-execution-hooks.js` -- `runPreTasksExecution`, `applyProcessEnvs`
  - `src/tasks-runner/run-command.js` line 290 -- `runPreTasksExecution` called before `runCommandForTasks` (line 297)
  - `src/hasher/hash-task.js` line 42 -- `hasher.hashTasks(tasksToHash, taskGraph, process.env)`
- `.planning/research/nx-runtime-input-caching-bug.md` -- Comprehensive nrwl/nx#30170 analysis with Rust source reading
- Existing codebase: `index.ts`, `transform.ts`, `cache.ts`, `detect.ts`, `executor.ts` and their test files

### Secondary (MEDIUM confidence)

- [nrwl/nx#30170](https://github.com/nrwl/nx/issues/30170) -- Bug report confirming runtime input caching issue (OPEN, 13+ months)
- [nrwl/nx#18432](https://github.com/nrwl/nx/issues/18432) -- Earlier report of same root cause (CLOSED)

### Tertiary (LOW confidence)

- None -- all findings verified against source code.

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH -- all components are existing workspace dependencies, no new libraries
- Architecture: HIGH -- verified against Nx 22.5.4 source code, call chain traced end-to-end
- Pitfalls: HIGH -- based on direct code reading and established patterns in the codebase
- Discretion recommendations: HIGH -- all backed by concrete rationale and codebase patterns

**Research date:** 2026-03-22
**Valid until:** 2026-04-22 (stable -- Nx internal APIs change slowly, plugin hooks are public API)
