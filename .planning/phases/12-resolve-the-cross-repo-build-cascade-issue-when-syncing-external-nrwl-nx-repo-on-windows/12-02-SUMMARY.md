---
phase: 12-resolve-the-cross-repo-build-cascade-issue-when-syncing-external-nrwl-nx-repo-on-windows
plan: 02
subsystem: graph, executor, sync
tags: [nx, targetDefaults, proxy-executor, env-isolation, cache-coherence, windows]

# Dependency graph
requires:
  - phase: 12-resolve-the-cross-repo-build-cascade-issue-when-syncing-external-nrwl-nx-repo-on-windows
    provides: dependsOn preservation and env isolation in proxy targets and executor
provides:
  - removal of --exclude-task-dependencies workaround from preVersionCommand
  - targetDefaults shield auto-injection (@op-nx/polyrepo:run executor-scoped entry)
  - general TEMP/TMP/TMPDIR isolation for proxy executor and graph extraction
  - NX_NO_CLOUD=true in proxy executor and extraction (prevents stale cross-platform Cloud cache)
  - needsInstall detection of missing node_modules
  - stale child cache clearing on reinstall
  - cache:false on sync/status targets
affects: [e2e tests, release workflow, sync executor, graph extraction]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Proxy executor env isolation: NX_DAEMON=false + NX_NO_CLOUD=true + NX_WORKSPACE_DATA_DIRECTORY + TEMP/TMP/TMPDIR per-repo"
    - "targetDefaults shield: empty executor-scoped entry intercepts Nx name-based lookup, blocks host overrides"
    - "needsInstall checks node_modules existence before lockfile hash comparison"

key-files:
  created:
    - .planning/research/windows-lock-contention.md
  modified:
    - nx.json
    - packages/op-nx-polyrepo/src/index.ts
    - packages/op-nx-polyrepo/src/index.spec.ts
    - packages/op-nx-polyrepo/src/lib/executors/run/executor.ts
    - packages/op-nx-polyrepo/src/lib/executors/run/executor.spec.ts
    - packages/op-nx-polyrepo/src/lib/executors/sync/executor.ts
    - packages/op-nx-polyrepo/src/lib/executors/sync/executor.spec.ts
    - packages/op-nx-polyrepo/src/lib/graph/extract.ts

key-decisions:
  - "targetDefaults shield: Nx resolves targetDefaults by executor key first (readTargetDefaultsForTarget line 1225). Empty @op-nx/polyrepo:run entry intercepts lookup, returns nothing to merge. Auto-injected by createNodesV2."
  - "NX_NO_CLOUD=true: external repo Cloud config points to wrong workspace. Remote cache entries from CI (Linux) have incomplete output restoration on Windows. Fundamental correctness requirement, not per-tool bandaid."
  - "TEMP/TMP/TMPDIR per-repo: general isolation layer catching ~80% of lock contention (Nx Cloud, npm, pnpm, Gradle, NuGet). All tools using os.tmpdir()/GetTempPath()/$TMPDIR get isolated paths."
  - "needsInstall node_modules check: git clean -fdx deletes node_modules but lockfile hash matches stored hash. Sync skipped install, leaving proxy executor without nx binary."
  - "Stale child cache clearing: tryInstallDeps clears .nx/cache/ and dist/ when node_modules missing. Prevents Cloud remote cache from backfilling stale entries whose output files are gone."
  - "cache:false on sync/status targets: these depend on external filesystem state (.repos/ contents) that Nx input hashing cannot track."

patterns-established:
  - "Proxy executor env block is the single place for child process isolation"
  - "Sync executor validates node_modules existence, not just lockfile hash"
  - "External repo operations use per-repo .tmp/ for temp files"

requirements-completed: [BUILD-02]

# Metrics
duration: extended (multi-session with user verification and iterative fixes)
completed: 2026-03-21
---

# Phase 12 Plan 02: End-to-end Verification and Workaround Cleanup Summary

**Verified cross-repo build cascade works end-to-end, added targetDefaults shield, general TEMP isolation, Cloud cache isolation, and scorched-earth recovery**

## Accomplishments

- Verified `nx test @op-nx/polyrepo` passes without `--exclude-task-dependencies` (359 tests, 8 proxy tasks)
- Removed `--exclude-task-dependencies` from preVersionCommand in nx.json
- Added targetDefaults shield (`@op-nx/polyrepo:run: {}`) auto-injected by createNodesV2
- Replaced per-tool NX_NO_CLOUD with general TEMP/TMP/TMPDIR per-repo isolation
- Restored NX_NO_CLOUD=true for Cloud remote cache correctness (cross-platform stale entries)
- Fixed needsInstall to detect missing node_modules after git clean -fdx
- Added stale child cache clearing (.nx/cache/ + dist/) when node_modules missing
- Set cache:false on sync/status targets (depend on external filesystem state)
- Added TEMP/TMP/TMPDIR isolation to graph extraction exec call
- Researched general Windows lock contention solution (.planning/research/windows-lock-contention.md)

## Task Commits

1. **Task 1: Verification + preVersionCommand cleanup** - `2da3471`
2. **targetDefaults shield** - `8491ad8`
3. **NX_NO_CLOUD in proxy executor** - `5e35ec1` (initial), `48be760` (restored after TEMP experiment)
4. **General TEMP/TMP isolation** - `7d958b6`
5. **Windows lock contention research** - `4e3fb39`
6. **needsInstall node_modules check + extraction TEMP** - `f8af24a`
7. **Stale child cache clearing** - `2cddf4d`
8. **cache:false on sync/status** - `2770e42`

## Proxy Executor Final Env Block

```typescript
env: {
  TEMP: repoTmpDir,       // General lock contention isolation
  TMP: repoTmpDir,
  TMPDIR: repoTmpDir,
  NX_DAEMON: 'false',     // SQLite WAL lock isolation
  NX_NO_CLOUD: 'true',    // Cross-platform stale remote cache
  NX_WORKSPACE_DATA_DIRECTORY: '.../.nx/workspace-data',
}
```

## Verified Results

| Check | Result |
|-------|--------|
| `nx test @op-nx/polyrepo` (no workarounds) | 359 tests, 8 proxy tasks pass |
| Scorched earth recovery (nuke + sync + test) | Pass on first run |
| Second run child cache | `[local cache]` hits on all child tasks |
| `nx/devkit:build.dependsOn` | `["^build","build-base","legacy-post-build"]` (preserved) |
| `nx/devkit:test.dependsOn` | `["test-native","build-native","^build-native"]` (preserved) |
| `nx/devkit:lint.executor` | `@op-nx/polyrepo:run` (correct, not nx:run-commands) |
| targetDefaults shield in nx.json | `{}` present |

## Self-Check: PASSED

- [x] All verification criteria met
- [x] 359 tests pass
- [x] Scorched earth recovery works without NX_DAEMON=false
- [x] User approved checkpoint

---
*Phase: 12-resolve-the-cross-repo-build-cascade-issue-when-syncing-external-nrwl-nx-repo-on-windows*
*Completed: 2026-03-21*
