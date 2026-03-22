# Research: Nx Daemon Runtime Input Caching Bug (nrwl/nx#30170)

**Researched:** 2026-03-22
**Nx version in workspace:** ^22.5.4
**Nx clone version (local `.repos/nx/`):** tag 22.5.4 (HEAD: 1ce5e91f)
**Overall confidence:** HIGH (verified against source code)

## Issue Status

| Property  | Value                                                                                         |
| --------- | --------------------------------------------------------------------------------------------- |
| Issue     | [nrwl/nx#30170](https://github.com/nrwl/nx/issues/30170)                                      |
| State     | **OPEN** (as of 2026-03-22)                                                                   |
| Created   | 2025-02-25                                                                                    |
| Labels    | `type: bug`, `scope: core`, `priority: medium`                                                |
| PRs/fixes | **None found**                                                                                |
| Related   | [nrwl/nx#18432](https://github.com/nrwl/nx/issues/18432) (closed, same root cause, since v16) |

The bug has been open for over a year with no Nx team response. Community comments
confirm it affects real workloads including Next.js setups and files-outside-workspace
use cases.

## Root Cause (Confirmed)

The bug is a **cache lifecycle mismatch**: runtime input results are cached at the
daemon process level, but runtime command outputs change between CLI invocations.

### Call chain

```
CLI client (hashTasks) -> daemon IPC -> handle-hash-tasks.ts -> storedHasher
  -> TaskHasher (Rust) -> hash_plans() -> hash_runtime()
```

### Three contributing factors

**1. Daemon reuses the hasher across CLI invocations**

`packages/nx/src/daemon/server/handle-hash-tasks.ts` (lines 10-11):

```typescript
let storedProjectGraph: any = null;
let storedHasher: InProcessTaskHasher | null = null;
```

The hasher is only recreated when the project graph reference changes (line 29).

**2. The native hasher holds a persistent runtime cache**

`packages/nx/src/native/tasks/task_hasher.rs` (line 114):

```rust
runtime_cache: Arc<DashMap<String, String>>,
```

Initialized once per `TaskHasher` construction. **Never cleared.**

Note: `task_output_cache` IS created fresh per `hash_plans` call (line 153), proving
the Nx team understands per-invocation cache scoping -- they just missed `runtime_cache`.

**3. Runtime commands hit cache on matching key and never re-execute**

`packages/nx/src/native/tasks/hashers/hash_runtime.rs` (lines 22-25):

```rust
let cache_key = runtime_cache_key(command, env);
if let Some(cache_results) = cache.get(&cache_key) {
    return Ok(cache_results.clone());  // returns without re-executing
}
```

Cache key = `command + sorted env vars`. Same command + same env = eternal cache hit.

### Why env inputs work but runtime inputs don't

The `hash_env` function (`hash_env.rs`) receives `js_env: &HashMap<String, String>`
which is a fresh `structuredClone(process.env)` from the CLI client per invocation
(`client.ts` line 352). No caching layer -- always reads the current value.

Runtime inputs, by contrast, shell out to execute a command (`Command::new("sh").arg("-c")`)
and cache the result in the DashMap. The env HashMap passed to `hash_runtime` becomes
part of the cache key, so even a fresh env clone doesn't help -- the key still matches.

## Alternative Approaches Investigated

### Approach 1: `preTasksExecution` Hook + Env Inputs (RECOMMENDED)

**Confidence:** HIGH -- verified against source code

The `preTasksExecution` plugin lifecycle hook runs once per CLI invocation, BEFORE
task hashing begins. The execution flow:

```
runCommand() -> runPreTasksExecution() -> applyProcessEnvs() -> runCommandForTasks()
                                                                  -> hashTasks(process.env)
```

The hook uses a Proxy on `process.env` to capture mutations
(`loaded-nx-plugin.ts` lines 122-140):

```typescript
this.preTasksExecution = async (context) => {
  const updates = {};
  process.env = new Proxy(originalEnv, {
    set: (target, key, value) => {
      target[key] = value;
      updates[key] = value; // captures mutation
      return true;
    },
  });
  await plugin.preTasksExecution(this.options, context);
  process.env = originalEnv;
  return updates; // sent back to CLI client
};
```

Mutations flow:

1. Plugin sets `process.env.FOO = 'bar'` inside hook
2. Proxy captures `{ FOO: 'bar' }` as mutations
3. Mutations are serialized and sent back to CLI client (even through daemon IPC)
4. CLI client applies mutations via `applyProcessEnvs()`
5. CLI client then sends `structuredClone(process.env)` with hash request
6. `hash_env("FOO", js_env)` in Rust receives the fresh value

**Strategy:** In our plugin's `preTasksExecution`, compute the git HEAD hash for
each synced repo and set it as an env var (e.g., `POLYREPO_HASH_<alias>`). Then use
`{ "env": "POLYREPO_HASH_<alias>" }` as the input instead of `{ "runtime": "..." }`.

**Advantages:**

- Works with daemon (env inputs are always fresh per CLI invocation)
- Runs per CLI invocation by design
- No Nx bug workaround needed -- uses the intended mechanism
- Env input hashing has no caching layer in Rust (`hash_env.rs` is stateless)
- Available since Nx 20.5.0 (`preTasksExecution` was added in the commit tagged 20.5.0)

**Disadvantages:**

- The `PreTasksExecution` type signature says `void | Promise<void>` -- the env
  mutation capture via Proxy is an undocumented implementation detail
- Hook runs for ALL `nx run` invocations, not just polyrepo targets
- Need to compute git hashes synchronously in the hook (but `git rev-parse HEAD`
  is fast, ~2ms)

**Risk assessment:** LOW risk. The Proxy capture mechanism is deeply integrated
(used by Nx's own plugin isolation layer, has dedicated tests in
`isolated-plugin.spec.ts`). Even if the type annotation is `void`, the runtime
behavior is stable and load-bearing for Nx Cloud and other first-party plugins.

### Approach 2: NX_DAEMON=false

**Confidence:** HIGH

Disabling the daemon causes a fresh `TaskHasher` per CLI invocation, which means
a fresh `DashMap`. Runtime inputs execute every time.

**Advantages:**

- Simplest workaround
- Confirmed working by issue commenters

**Disadvantages:**

- Loses ALL daemon benefits (file watching, incremental project graph, warm caches)
- Every `nx run` pays full startup cost (~2-5s on large workspaces)
- Not viable for development workflows

**Verdict:** Acceptable for CI only, not for local development.

### Approach 3: Runtime Inputs with Unique Env Busting

**Confidence:** MEDIUM

Since the runtime cache key includes env vars, injecting a unique env var per
CLI invocation would bust the cache:

```bash
POLYREPO_NONCE=$(date +%s%N) nx run my-project:build
```

The runtime cache key would be different each time because the env HashMap changes.

**Advantages:**

- Works without plugin changes
- Simple to implement in shell wrappers

**Disadvantages:**

- Defeats intra-invocation deduplication (same command still cached within one batch)
  -- actually this still works because the key is the same within one invocation
- Requires every invocation to set the nonce
- Fragile -- relies on understanding the cache key implementation
- Runtime commands still execute (shelling out), which is slower than env lookups

Wait -- actually this works. The nonce changes per CLI invocation, so the key is
different between invocations. Within a single `hash_plans` call, the nonce is
the same, so intra-batch deduplication still works. This is actually viable.

**Verdict:** Works but is a hack. The `preTasksExecution` approach is cleaner because
it computes the actual semantic value (git hash) rather than using a nonce.

### Approach 4: Custom Hasher (executor-level)

**Confidence:** MEDIUM

Executors can export a `hasherFactory` which provides a custom hashing function.
Checked in `packages/nx/src/tasks-runner/utils.ts` line 450-456:

```typescript
export function getCustomHasher(task, projectGraph): CustomHasher | null {
  const factory = getExecutorForTask(task, projectGraph).hasherFactory;
  return factory ? factory() : null;
}
```

Custom hashers run in TypeScript (not Rust), so they bypass the DashMap entirely.

**Advantages:**

- Full control over hash computation
- No daemon caching bug applies
- Per-executor, so only affects polyrepo targets

**Disadvantages:**

- Must be part of the executor package (not configurable via nx.json)
- Breaks batch hashing optimization (custom hasher tasks are hashed individually)
- Complex to implement correctly (must produce deterministic hashes)
- Not composable with standard file/env inputs

**Verdict:** Viable fallback but over-engineered for this use case.

### Approach 5: Trigger Project Graph Rebuild

**Confidence:** LOW

If the project graph changes, `storedHasher` is recreated (`handle-hash-tasks.ts`
line 29). Could we touch a tracked file to force a graph rebuild?

**Disadvantages:**

- `.repos/` is gitignored, so child repo changes don't trigger it
- Would need to touch a workspace file, which is a side effect
- Graph rebuild is expensive (~1-3s)
- Fragile dependency on implementation detail

**Verdict:** Not viable.

### Approach 6: Contribute Fix to Nx

**Confidence:** HIGH (the fix is straightforward)

The fix is to clear `runtime_cache` at the start of each `hash_plans` call,
exactly as `task_output_cache` is already recreated fresh. One line:

```rust
// At the start of hash_plans:
self.runtime_cache.clear();
```

This preserves intra-batch deduplication while ensuring fresh results per CLI
invocation. The fix posted in the issue comment (by us) proposes two options:

- **Option A:** `self.runtime_cache.clear()` in `hash_plans` (simplest)
- **Option B:** Expose `clearRuntimeCache()` via napi, call from `handleHashTasks`
  (more precise lifecycle control)

**Status:** Root cause analysis posted to the issue on 2026-03-22. No Nx team
response yet. Given the issue has been open 13 months with `priority: medium`,
a fix landing in a timely manner is unlikely.

**Verdict:** Worth contributing a PR, but we cannot depend on it shipping. Design
our solution to work without the fix.

## Recommended Strategy

**Use Approach 1 (`preTasksExecution` + env inputs) as the primary mechanism.**

### Implementation sketch

```typescript
// In plugin's index.ts
export const preTasksExecution: PreTasksExecution = async (
  options,
  context,
) => {
  const repos = discoverSyncedRepos(context.workspaceRoot);
  for (const [alias, repoPath] of Object.entries(repos)) {
    const envKey = `POLYREPO_HASH_${alias.toUpperCase().replace(/-/g, '_')}`;
    const hash = execSync(`git -C "${repoPath}" rev-parse HEAD`, {
      encoding: 'utf8',
      windowsHide: true,
    }).trim();
    process.env[envKey] = hash;
  }
};
```

```jsonc
// In createNodesV2-generated target config
{
  "inputs": [{ "env": "POLYREPO_HASH_MY_REPO" }],
}
```

### Why this works

1. `preTasksExecution` runs per CLI invocation (even with daemon active)
2. The Proxy captures `process.env` mutations and sends them to the CLI client
3. The CLI client includes them in `structuredClone(process.env)` sent to daemon
4. `hash_env` in Rust reads from the fresh `js_env` HashMap (no DashMap caching)
5. Different git HEAD = different env value = different task hash = cache miss

### What to watch out for

1. **The hook runs for ALL nx commands** (not just polyrepo targets). Keep it fast.
   `git rev-parse HEAD` is ~2ms per repo, so even 10 repos = ~20ms. Acceptable.

2. **The `PreTasksExecution` return type is `void`** but the implementation captures
   env mutations via Proxy. This is stable internal behavior but not documented.
   If Nx ever removes the Proxy mechanism, our env mutations would stop propagating
   through the daemon. Mitigation: also set the env vars directly (which works for
   non-daemon mode), and the Proxy mechanism is load-bearing for Nx Cloud.

3. **`createNodesV2` still won't re-run** when child repo state changes (the graph
   files are gitignored). This means the project graph structure (which projects
   exist, which targets they have) remains stable -- only task hashing changes.
   This is actually desirable: the graph structure is determined by workspace
   config, while cache validity is determined by child repo state.

4. **Consider using `git rev-parse HEAD` vs `git diff --stat`** for the hash value.
   `HEAD` only changes on commits. If we also want to detect uncommitted changes
   (dirty working tree), use `git describe --always --dirty` or hash the output of
   `git status --porcelain`. For the proxy target caching use case, `HEAD` is likely
   sufficient since we're proxying build/test commands that operate on committed code.

## Related Issues and Context

| Issue                                                    | Status            | Relevance                                                   |
| -------------------------------------------------------- | ----------------- | ----------------------------------------------------------- |
| [nrwl/nx#30170](https://github.com/nrwl/nx/issues/30170) | OPEN              | Primary bug -- runtime inputs cached forever by daemon      |
| [nrwl/nx#18432](https://github.com/nrwl/nx/issues/18432) | CLOSED (outdated) | Same root cause, reported against v16                       |
| [nrwl/nx#33781](https://github.com/nrwl/nx/issues/33781) | OPEN              | Related: daemon file watcher slow start causing stale cache |

## Nx Version Compatibility

| Feature                  | Min Version | Notes                                                       |
| ------------------------ | ----------- | ----------------------------------------------------------- |
| `preTasksExecution` hook | 20.5.0      | First appeared in tag 20.5.0                                |
| `env` inputs             | 14.4.0      | Stable, well-documented                                     |
| `runtime` inputs (buggy) | 14.4.0      | Affected by DashMap bug since daemon was introduced         |
| Plugin isolation         | 20.0.0      | Proxy capture works in both isolated and non-isolated modes |

Our workspace uses Nx ^22.5.4, so all features are available.

## Confidence Assessment

| Finding                                     | Confidence | Basis                                                                               |
| ------------------------------------------- | ---------- | ----------------------------------------------------------------------------------- |
| Root cause (DashMap never cleared)          | HIGH       | Direct source code reading                                                          |
| `preTasksExecution` env mutation capture    | HIGH       | Verified in source: LoadedNxPlugin, isolated-plugin, plugin-worker                  |
| `preTasksExecution` timing (before hashing) | HIGH       | Verified in run-command.ts: runPreTasksExecution -> runCommandForTasks -> hashTasks |
| `env` inputs bypass runtime cache           | HIGH       | `hash_env.rs` has no DashMap, reads from per-invocation `js_env`                    |
| Issue unlikely to be fixed soon             | MEDIUM     | 13 months open, no Nx team engagement, `priority: medium`                           |
| `preTasksExecution` API stability           | MEDIUM     | Undocumented return-via-Proxy pattern, but load-bearing for Nx internals            |

## Sources

- [nrwl/nx#30170 -- Runtime cache input simply does not work](https://github.com/nrwl/nx/issues/30170)
- [nrwl/nx#18432 -- nx:run-commands runtime input is broken](https://github.com/nrwl/nx/issues/18432)
- [nrwl/nx#33781 -- Daemon file watcher slow to start causing stale cache](https://github.com/nrwl/nx/issues/33781)
- Local Nx clone at `.repos/nx/` (tag 22.5.4):
  - `packages/nx/src/daemon/server/handle-hash-tasks.ts`
  - `packages/nx/src/native/tasks/task_hasher.rs`
  - `packages/nx/src/native/tasks/hashers/hash_runtime.rs`
  - `packages/nx/src/native/tasks/hashers/hash_env.rs`
  - `packages/nx/src/project-graph/plugins/tasks-execution-hooks.ts`
  - `packages/nx/src/project-graph/plugins/loaded-nx-plugin.ts`
  - `packages/nx/src/project-graph/plugins/public-api.ts`
  - `packages/nx/src/tasks-runner/run-command.ts`
  - `packages/nx/src/hasher/hash-task.ts`
  - `packages/nx/src/daemon/client/client.ts`
