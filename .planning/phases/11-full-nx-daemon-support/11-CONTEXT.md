# Phase 11: Full Nx Daemon Support - Context

**Gathered:** 2026-03-20
**Status:** Ready for planning

<domain>
## Phase Boundary

Make the plugin work seamlessly with `NX_DAEMON=true` (Nx's default), `NX_DAEMON=false`, and unset. Eliminate the cold-start `NX_DAEMON=false` requirement. Verify all four combinations (daemon on/off x cache on/off) work correctly in both the local workspace and e2e tests.

</domain>

<decisions>
## Implementation Decisions

### Per-repo Cache Architecture

- **Migrate from single cache file to per-repo cache files.** Each synced repo gets its own cache at `.repos/<alias>/.polyrepo-graph-cache.json` containing `{ hash, report }` for that repo only.
- **Three-layer cache with global gate:** (1) Global in-memory hash gate (combines all per-repo hashes -- existing pattern from `cache.ts:84-87`), (2) Per-repo disk cache, (3) Per-repo extraction on miss. Each layer is progressively more expensive, only reached when the cheaper layer misses.
- **Keep existing hash inputs.** Per-repo hash: `hashArray([reposConfigHash, alias, headSha, dirtyFiles])`. Lockfile hash was considered but `headSha + dirtyFiles` already covers lockfile changes via `git status --porcelain`. Adding it provides marginal benefit with unnecessary coupling to sync executor internals.
- **Scalability target:** Multiple repos with 500+ Nx projects. In-memory hit: ~0ms. Disk hit: ~50-200ms. Only stale repos re-extract.

### Pre-caching During Sync

- **polyrepo-sync writes per-repo disk cache after install.** After clone/pull + dep install, run `extractGraphFromRepo` and write the per-repo cache file. First daemon invocation hits warm disk cache.
- **Progress logging at multiple points.** Sync must log progress during extraction so output doesn't feel stuck (e.g., "Extracting graph for repo-x...", "Cached graph for repo-x (149 projects)").
- **Warn and continue on extraction failure.** Matches existing degradation pattern (`createNodesV2` and `createDependencies` both catch extraction errors and warn). The repo is still cloned and installed; plugin falls back to inline extraction on next Nx command.

### Cache Invalidation Under Daemon

- **Hash-based invalidation (existing approach, no event-driven watcher).** `computeOuterHash` runs per Nx command: `git rev-parse HEAD` + `git status --porcelain` per repo. 10 repos = ~100-200ms total. <1% overhead on typical Nx commands (2-30s).
- **Natural invalidation after sync.** Sync with no new commits: hash unchanged, in-memory hit, zero cost. Sync with changes: hash changes, per-repo disk cache hit (pre-cached by sync), ~100-200ms recovery. No daemon restart or refresh signal needed.
- **This is a synthetic monorepo.** Users actively develop in `.repos/<alias>/` directories. Extraction inside the daemon is the common path, not a rare edge case. Cache must be responsive to frequent local changes.

### E2e Daemon Testing

- **Both daemon modes verified in e2e.** E2e tests must pass with `NX_DAEMON=true` and `NX_DAEMON=false`.
- **Separate test runs, CI matrix.** Same test files, run twice with different env. CI matrix controls `NX_DAEMON`. Local e2e defaults to `NX_DAEMON` unset (daemon enabled, Nx default).
- **Remove `ENV NX_DAEMON=false` from Dockerfile `workspace` stage (line 58).** Keep `CI=true`. Build-time `RUN` commands already have inline `NX_DAEMON=false` (lines 89, 116). `nx-prep` stage (line 14) keeps its `ENV` -- build-time only, never runtime.
- **Forward host env via `startContainer()`.** Read `process.env['NX_DAEMON']` in test setup, pass to container via `withEnvironment()`. If unset, container uses Nx default (daemon on).
- **Establish Docker build baseline before changes.** Record current build times for each Dockerfile stage, then verify no regression after removing `ENV NX_DAEMON=false` from runtime stage. Plan step with manual verification.
- **Also verify with `--skip-nx-cache`.** Four combinations: daemon on/off x cache on/off. All must produce correct results.

### Error Recovery

- **Per-repo isolation.** One repo's extraction failure does not affect other repos. Failed repo's projects drop from graph; other repos served from their own caches.
- **No stale cache fallback.** In a synthetic monorepo, users actively develop across repos. Stale data means incorrect dependency edges. Show the real state, warn clearly.
- **Short exponential retries with hash-change reset.** After extraction failure, skip re-extraction with growing cooldown: 2s, 4s, 8s, 16s, 30s cap. Prevents repeated 30-60s extraction penalties on rapid Nx command sequences. Hash change (any file edit, commit, or sync in the failing repo) resets to attempt 1 immediately.
- **Actionable warning with troubleshooting steps.** On failure, log:
  1. `nx polyrepo-sync` (re-sync + reinstall + pre-cache)
  2. `NX_DAEMON=false nx graph` (detailed error output)
  3. Check `.repos/<alias>/` (nx.json, node_modules)
  4. `NX_PLUGIN_NO_TIMEOUTS=true nx graph` (bypass 10-min plugin timeout)

### Claude's Discretion

- Function signatures and file layout for per-repo cache refactor
- Exact progress log message format during sync extraction
- Whether to extract repos in parallel or sequentially during sync
- Test file organization for daemon-on vs daemon-off scenarios
- Exact backoff timing implementation (setTimeout vs timestamp comparison)

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets

- `extractGraphFromRepo` (`graph/extract.ts`): Shells out to child repo's `nx graph --print`. Already sets `NX_DAEMON=false`, `NX_VERBOSE_LOGGING=false`, `NX_PERF_LOGGING=false` on child processes. Has fast-path for pre-computed `.nx-graph-output.json`.
- `populateGraphReport` (`graph/cache.ts`): Two-layer cache (in-memory + single disk file). Module-level `graphReport`/`currentHash` persist under daemon. Core logic to refactor into per-repo cache.
- `computeOuterHash` (`graph/cache.ts`): Already iterates repos individually with per-repo `headSha`/`dirtyFiles`. Natural refactor point for per-repo hashing.
- `hashLockfile`/`needsInstall`/`writeInstalledHash` (`executors/sync/executor.ts`): Lockfile hash system at lines 177-228. Private to sync executor. Not needed for graph cache (headSha + dirtyFiles sufficient).
- `startContainer` (`e2e/setup/container.ts`): Testcontainers helper. Currently no env forwarding. Add `withEnvironment()` for NX_DAEMON propagation.

### Established Patterns

- Silent skip on missing files: `try/catch` with `continue` for missing `package.json`/tsconfig
- Warn and continue on extraction failure: `createNodesV2` catches `populateGraphReport` errors, logs warning, returns partial results
- SIFERS test pattern: no `beforeEach`/`afterEach`; typed mocks via explicit setup functions
- Module-level state for daemon persistence: `graphReport`/`currentHash` in `cache.ts`

### Integration Points

- `createNodesV2` in `index.ts:29-114`: Calls `populateGraphReport`, registers external projects. Error handling at lines 44-58.
- `createDependencies` in `index.ts:116-185`: Calls `populateGraphReport` again (defensive re-populate). Cross-repo detection at line 167.
- Sync executor (`executors/sync/executor.ts:440-526`): Post-sync hook point for pre-caching. `syncRepo` returns per-repo results at line 452.
- Dockerfile `workspace` stage (line 58): `ENV NX_DAEMON=false CI=true` to change to `ENV CI=true`.
- `global-setup.ts:35,45`: Saves/restores `NX_DAEMON` during publish (host-side, not container).

### Nx Infrastructure Constraints (from research)

- **5-second plugin worker socket timeout** ([nrwl/nx#29374](https://github.com/nrwl/nx/issues/29374), [#34442](https://github.com/nrwl/nx/issues/34442)): Outside our control. Workaround: `NX_PLUGIN_NO_TIMEOUTS=true`.
- **10-minute plugin message timeout** (`isolated-plugin.js` line 15): `MAX_MESSAGE_WAIT = 1000 * 60 * 10`. Bypassable with `NX_PLUGIN_NO_TIMEOUTS=true`.
- **"Plugin Workers should not start a new daemon process"** ([#33472](https://github.com/nrwl/nx/issues/33472)): Already mitigated by `NX_DAEMON=false` on child `exec()`.
- **Daemon OOM on large repos** ([#26786](https://github.com/nrwl/nx/issues/26786)): Outside our control. Workaround: `NX_DAEMON=false`.
- **No built-in partial failure** in Nx: Plugin `createNodesV2` failure → `AggregateCreateNodesError` → full plugin failure. Our catch-and-warn pattern is the correct mitigation.

</code_context>

<specifics>
## Specific Ideas

- The per-repo cache architecture is a natural evolution of the existing code: `computeOuterHash` already iterates repos individually, `populateGraphReport` already extracts/transforms per-repo, `report.repos[alias]` is already per-repo. The refactor is at the cache serialization layer, not the core logic.
- Pre-caching during sync leverages the fact that sync already knows which repos were updated and has access to the workspace root. The cache write is a natural post-install step.
- The global in-memory hash gate preserves the existing `cache.ts:84-87` pattern that makes the common case (nothing changed) instant (~0ms).
- Error recovery with exponential backoff uses module-level state (persists under daemon) to track per-repo failure state. Hash-change reset ensures fixes are picked up immediately.

</specifics>

<deferred>
## Deferred Ideas

- **File watcher for cache invalidation** -- Watch `.repos/` for git changes instead of hash-checking per command. Would eliminate the ~100-200ms hash overhead but adds platform-specific watcher complexity. Revisit if hash overhead becomes measurable at scale.
- **Stale cache fallback** -- Serve outdated cache on extraction failure. Rejected for this phase: in a synthetic monorepo, stale data means incorrect dependency edges. Per-repo isolation with clear warnings is more honest.
- **Automated build-time regression assertion** -- CI check that fails if Docker build exceeds baseline + margin. Manual verification chosen for this phase; revisit if build times regress.
- **`nx affected` cross-repo support (DETECT-07)** -- Carried from Phase 10. Requires `polyrepo-affected` executor. Separate milestone.
- **Consumer-side tsconfig path resolution** -- Carried from Phase 9/10. Deferred to v1.2+.

</deferred>

---

*Phase: 11-full-nx-daemon-support*
*Context gathered: 2026-03-20*
