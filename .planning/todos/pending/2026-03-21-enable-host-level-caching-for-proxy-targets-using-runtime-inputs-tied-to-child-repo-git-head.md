---
created: 2026-03-21T20:23:55.000Z
title: Enable host-level caching for proxy targets using runtime inputs tied to child repo git HEAD
area: proxy
files:
  - packages/op-nx-polyrepo/src/lib/graph/transform.ts
---

## Problem

Proxy targets have `cache: false` and `inputs: []` in `createProxyTarget`. The host Nx always re-invokes the proxy executor, which spawns a child Node.js process -> loads ~10 Nx plugins -> reads project graph -> checks child cache -> returns. Even when the child cache is warm, this bootstrap overhead is several seconds per target. With 8 proxy tasks in the `nx test @op-nx/polyrepo` dependency chain, the overhead is significant.

The `cache: false` was intentional for correctness: the host has no way to know when child repo files change, so it can't compute a valid cache key. Setting `cache: true` with `inputs: []` would produce a constant hash and NEVER re-run the proxy, even after `polyrepo-sync` updates the repo.

## Solution

Set `cache: true` with a `runtime` input that hashes the child repo's git HEAD:

```typescript
// In createProxyTarget (transform.ts)
cache: true,
inputs: [{ runtime: `git -C .repos/${repoAlias} rev-parse HEAD` }],
```

Nx executes the command, hashes stdout, and uses it as part of the cache key. When HEAD is unchanged (no sync happened), the host cache hits and skips the proxy invocation entirely -- zero child processes spawned.

## Design decisions

### Input granularity: HEAD vs write-tree

| Approach | What it tracks | When it invalidates | Cost |
|----------|---------------|--------------------|----- |
| `git rev-parse HEAD` | Commit SHA | On sync (new tag/commit) | Negligible (~2ms) |
| `git write-tree` | Working tree state | On ANY file change including untracked | ~50ms for 150-project repo |

**Recommendation: HEAD.** Synced repos are read-only (checked out at a specific tag). Uncommitted changes shouldn't exist. HEAD is simpler, faster, and correct for the sync-based workflow.

### Outputs

Nx can cache targets with no explicit `outputs` -- it stores the terminal output and success status. On cache hit, it replays the terminal output and reports success. This is sufficient for proxy targets since the actual build outputs live in `.repos/<alias>/dist/` (managed by the child Nx's own cache).

No `outputs` declaration needed.

### Scorched-earth edge case

After `rm -rf .repos/nx/dist .repos/nx/.nx`, git HEAD is unchanged but the child's build outputs are gone. The host cache says "success" but post-build scripts fail on missing files.

**Mitigations (choose one):**
1. **Accept sync as prerequisite** -- scorched earth already requires `polyrepo-sync` for recovery. Sync clears stale child cache and rebuilds. After sync, HEAD may or may not change (same tag = same HEAD), but the child cache is rebuilt. The host cache hit is valid because the child cache was restored.
2. **Compound input** -- add a second runtime input checking output existence: `git -C .repos/nx rev-parse HEAD && test -d .repos/nx/dist/packages/devkit`. If dist/ is missing, the command fails or produces different output, invalidating the cache. More defensive but more complex.
3. **Sync clears host cache** -- the sync executor could clear host `.nx/cache/` entries for the affected repo when it reinstalls. This ensures the first post-sync run always rebuilds.

**Recommendation: Option 1** (accept sync as prerequisite). It's already the recovery path, and the `needsInstall` + stale cache clearing from Phase 12 ensures sync restores a working state.

### Alternative: graph cache hash as input

Instead of git HEAD, use the `.polyrepo-graph-cache.json` file's hash or modification time:

```typescript
inputs: [{ runtime: `git hash-object .repos/${repoAlias}/.polyrepo-graph-cache.json` }]
```

This changes whenever the graph extraction runs (after sync). It's slightly more conservative than HEAD (re-extractions without HEAD change would invalidate). But it couples the proxy cache to the graph extraction cache, which is a different concern.

**Not recommended as primary approach**, but could supplement HEAD as a compound input.

### Cross-platform

`git -C .repos/nx rev-parse HEAD` works on Windows (Git for Windows), Linux, and macOS. Nx executes runtime inputs via the shell, so `.cmd` shim resolution is handled automatically.

## Scope

~3 lines in `createProxyTarget` (transform.ts) for the basic implementation. Test updates in `transform.spec.ts`. Estimated: 1 task, half a session.

## Impact

Eliminates child Nx bootstrap overhead on warm runs. First run after sync still pays full cost (HEAD changed -> cache miss -> child builds). Subsequent runs skip all proxy invocations entirely.
