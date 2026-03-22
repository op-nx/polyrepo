# Phase 15: Proxy Target Caching - Context

**Gathered:** 2026-03-22
**Status:** Ready for planning

<domain>
## Phase Boundary

Enable host-level Nx caching for proxy targets so unchanged child repos skip the 2-5s child Nx bootstrap overhead per cached target invocation. Proxy targets get `cache: true` with git-based inputs per repo alias, fallback guards for failed git commands, and daemon-compatible invalidation.

</domain>

<decisions>
## Implementation Decisions

### Caching mechanism: preTasksExecution + env inputs (primary)

- Use `preTasksExecution` plugin lifecycle hook to compute git state per CLI invocation
- Set `process.env.POLYREPO_HASH_<ALIAS>` (uppercased, hyphens replaced with underscores) for each synced repo
- Proxy targets use `{ "env": "POLYREPO_HASH_<ALIAS>" }` input instead of `{ "runtime": "..." }`
- This completely bypasses nrwl/nx#30170 (daemon caches runtime input results in Rust DashMap)
- The Proxy capture mechanism in `loaded-nx-plugin.ts` propagates env mutations back to CLI client through daemon IPC
- `hash_env.rs` reads from per-invocation `js_env` HashMap with no DashMap caching layer
- Available since Nx 20.5.0; workspace uses ^22.5.4
- See `.planning/research/nx-runtime-input-caching-bug.md` for full analysis

### Hash content: HEAD + dirty flag

- Compute `git rev-parse HEAD` (~2ms) + `git status --porcelain` (~5ms) per repo
- Hash: `hashArray([headSha, dirty ? 'dirty' : 'clean'])`
- Cache invalidates when: new commits pulled (HEAD changes) OR any file modified/added/deleted (dirty flag changes)
- Does NOT distinguish between different dirty states (edit file A vs edit file B = both 'dirty')

### Git failure behavior

- If git commands fail (repo not synced, corrupt .git): set env var to random UUID (forces cache-miss every invocation)
- Print deduplicated stderr warning: `[WARN] polyrepo: git failed for '<alias>', cache bypassed`
- Include sync hint: `Hint: run 'nx polyrepo-sync' if repo is not yet cloned`
- Warning deduplication mechanism: Claude's discretion (research best approach during planning -- temp file sentinel or best-effort)
- Failure in preTasksExecution must NOT block unrelated targets from running

### PROXY-04: Conditional requirement (nx reset after sync)

- Primary approach (preTasksExecution + env inputs) makes `nx reset` unnecessary for cache invalidation
- PROXY-04 activates ONLY if preTasksExecution + env inputs fails verification during testing
- If activated: sync executor runs `nx reset` after sync to flush stale runtime input cache
- Both paths tested in e2e regardless of which ships to production

### Requirements updates

- PROXY-02: Reword from "compound runtime input" to "preTasksExecution + env input per repo alias"
- PROXY-04: Mark as conditional (activates only if primary approach fails)
- PROXY-05: Satisfied by design (env inputs work identically with daemon on/off/unset)

### Verification: scorched earth testing

All scenarios verified under 3 daemon modes (NX_DAEMON=true, false, unset):

**Functional correctness:**

1. Cache hit: run target twice with no repo changes -- second run skips child Nx
2. Cache miss after sync: pull new commits -- cache miss without manual nx reset
3. Cache miss on dirty: edit child repo file -- miss; revert -- hit again

**Scorched earth recovery:** 4. `nx reset` in host workspace -- caching still works after 5. `nx reset` in `.repos/<alias>/` -- caching still works after 6. Delete `.nx/` and `tmp/` in both host and child repos -- recovery 7. Delete `.repos/<alias>/.polyrepo-graph-cache.json` -- recovery 8. Full reset in both repos simultaneously -- recovery

**Cache bypass:** 9. `--skip-nx-cache` forces re-execution (testing only, not implementation)

### Claude's Discretion

- Warning deduplication mechanism (temp file sentinel vs best-effort)
- preTasksExecution error handling strategy (swallow vs propagate)
- Reuse of `computeRepoHash` from cache.ts vs independent implementation
- Env var naming normalization for aliases with special characters
- Exact test structure and assertion design

</decisions>

<code_context>

## Existing Code Insights

### Reusable Assets

- `computeRepoHash` in `cache.ts` already computes per-repo hash from git HEAD + dirty files for graph cache invalidation -- similar logic needed in preTasksExecution
- `hashArray` from `@nx/devkit` or custom hasher for combining HEAD + dirty flag
- `normalizePath` utility used throughout for cross-platform path handling

### Established Patterns

- `createProxyTarget` in `transform.ts:103-126` currently has `cache: false, inputs: []` -- the primary edit point
- `ensureTargetDefaultsShield` in `index.ts:38-76` prevents host targetDefaults leaking into proxy targets
- `exec()`/`execSync()` with `{ windowsHide: true }` for child process spawning (cross-platform)
- Plugin exports `createNodesV2` and `createDependencies` from `index.ts` -- `preTasksExecution` is a new export

### Integration Points

- `packages/op-nx-polyrepo/src/index.ts` -- new `preTasksExecution` export
- `packages/op-nx-polyrepo/src/lib/graph/transform.ts:103-126` -- `createProxyTarget` cache/inputs config
- `packages/op-nx-polyrepo/src/lib/graph/cache.ts` -- potential code reuse for git state computation
- `packages/op-nx-polyrepo/src/lib/executors/sync/executor.ts` -- conditional nx reset (if PROXY-04 activates)

### Research Output

- `.planning/research/nx-runtime-input-caching-bug.md` -- comprehensive analysis of nrwl/nx#30170 with 6 approaches evaluated, call chain verification, and implementation sketch

</code_context>

<specifics>
## Specific Ideas

- The Proxy capture mechanism in `loaded-nx-plugin.ts` (lines 122-140) is undocumented in type signatures but load-bearing for Nx Cloud and plugin isolation -- LOW risk of removal
- `preTasksExecution` runs for ALL `nx run` invocations, not just polyrepo targets -- keep it fast (~7ms for HEAD + dirty check per repo)
- `task_output_cache` IS recreated fresh per `hash_plans` call in `task_hasher.rs`, proving Nx team understands per-invocation scoping -- they just missed `runtime_cache`
- Consider contributing a PR to fix nrwl/nx#30170 (one-line Rust fix: `self.runtime_cache.clear()` at start of `hash_plans`) but do NOT depend on it shipping

</specifics>

<deferred>
## Deferred Ideas

- Per-target runtime inputs for finer cache granularity (PROXY-F1) -- repo-level is sufficient for v1.2
- Output caching for proxy targets (PROXY-F2) -- child Nx manages its own build artifacts
- Contributing PR to fix nrwl/nx#30170 upstream -- worth doing but not a dependency

</deferred>

---

_Phase: 15-proxy-target-caching_
_Context gathered: 2026-03-22_
