# Phase 3: Multi-Repo Git DX - Context

**Gathered:** 2026-03-11
**Status:** Ready for planning

<domain>
## Phase Boundary

Users can monitor and manage git state across all synced repos from a single command surface. The existing `polyrepo-status` executor is enhanced with working tree details (ahead/behind, file counts, warnings, project counts). The existing `polyrepo-sync` executor gets output improvements and `--dry-run`. No new executors or commands are added. Selective operations (pick which repos) are v2 scope (GITX-04).

</domain>

<decisions>
## Implementation Decisions

### Status detail depth
- **Working tree summary per repo**: one line per repo with branch, ahead/behind remote, and dirty file counts using `M` (modified), `A` (added/staged), `D` (deleted), `??` (untracked) labels. No individual file paths listed
- **Auto-fetch before status**: `polyrepo-status` runs `git fetch` in each repo (parallelized) before computing ahead/behind counts. Always accurate, ~1-3s added. Making this configurable (skip-fetch flag) is deferred
- **Tag-pinned repos omit ahead/behind**: repos pinned to a tag (static like `v2.1.0` or moving like `v2.x`) show tag name, drift detection, and dirty file counts but no ahead/behind columns — tags don't have tracking branches, so those numbers would be meaningless
- **Unsynced repos shown**: all configured repos appear in output. Unsynced repos display `[not synced]`. Summary line at the bottom shows totals (configured, synced, not synced)
- **Project count per repo**: status reads the Phase 2 graph cache to show how many projects were extracted from each repo. If cache doesn't exist yet, shows `?` with footer explanation: "graph not yet extracted (run any nx command to trigger)". Any Nx command in the host workspace triggers extraction for all repos (via `createNodesV2`), not just commands targeting that specific repo

### Output presentation
- **Aligned columns**: output padded so values line up vertically across repos (like `docker ps`, `kubectl get pods`). Easy to scan
- **Sync gets aligned summary table**: sync keeps streaming progress lines during execution, then adds an aligned results table at the end showing per-repo outcome (`[OK]` / `[ERROR]` with message)
- **Legend always shown**: printed at bottom of every status run, one symbol per line. Making it hideable via flag is deferred

Output example:
```
repo-a   main      +2 -0  3M 1??  12 projects  [WARN: dirty, sync may fail]
repo-b   develop   +0 -1  clean    8 projects
repo-c   v2.1.0           clean    5 projects
repo-d   (detached)       2M       5 projects   [WARN: detached HEAD]
repo-e   v2.9.0 (expected v3.0.0)  5 projects   [WARN: drift]
repo-f   [not synced]              ? projects

6 configured, 5 synced, 1 not synced

Legend:
  M  = modified files
  A  = staged/added files
  D  = deleted files
  ?? = untracked files
  +N = commits ahead of remote
  -N = commits behind remote
  ?  = graph not yet extracted (run any nx command to trigger)
```

Sync summary example:
```
Cloning repo-a from git@github.com:org/a.git...
Done: repo-a cloned.
Updating repo-b (pull)...
Done: repo-b updated.
Updating repo-ccc (pull)...
[ERROR] repo-ccc: auth denied

Results:
repo-a     cloned   [OK]
repo-b     updated  [OK]
repo-ccc   pull     [ERROR] auth denied

2 synced, 1 failed
```

### Command surface design
- **Enhance polyrepo-status**: the existing executor is upgraded with working tree info, auto-fetch, project counts, warnings, and aligned output. No new command needed. Current branch/drift output is replaced by the richer format
- **Sync is already complete for GITX-02/GITX-03**: bulk pull/fetch with strategy options, parallel execution, and per-repo error reporting already exist. Phase 3 adds the aligned results table and `--dry-run`
- **`--dry-run` for sync**: shows what sync would do without executing — which repos need cloning, which would be pulled, which are dirty and might fail. New executor option on `polyrepo-sync`

### Error handling & edge cases
- **Proactive warnings in status**: status flags repos whose state would cause sync problems. Four warning triggers:
  1. `[WARN: dirty, sync may fail]` — uncommitted changes that could block pull
  2. `[WARN: detached HEAD]` — not on a branch
  3. `[WARN: merge conflicts]` — unresolved merge conflicts
  4. `[WARN: drift]` — current branch/tag doesn't match configured ref (in addition to the `(expected ...)` display)
- **Pass through git's error messages**: sync wraps git's stderr with the repo alias for context, but does not add its own hints or suggestions. Git's messages already explain problems and suggest fixes. Adding our own hints is deferred
- **Status always exits 0**: warnings are informational. Exit 1 only if the executor itself fails (e.g., can't read config, git binary not found). Consistent with `git status`. Sync exit codes unchanged (0 = all ok, 1 = any failed)

### Claude's Discretion
- Exact git commands for computing ahead/behind counts, detecting merge conflicts, and detecting detached HEAD
- Column width calculation and padding implementation
- How to read Phase 2 graph cache for project counts (file path, parsing)
- Internal structure of `--dry-run` output formatting
- Whether to extract shared formatting utilities or keep formatting inline per executor

</decisions>

<specifics>
## Specific Ideas

- Existing `detect.ts` has `getDirtyFiles` (via `git diff --name-only HEAD`) but needs extension for: staged vs unstaged distinction, untracked file count, ahead/behind counts, merge conflict detection, detached HEAD detection
- Existing `commands.ts` has `gitFetch` which can be reused for the auto-fetch step
- `polyrepo-status` executor currently processes repos sequentially — should switch to parallel (like sync) since auto-fetch adds network latency
- The `--dry-run` option for sync should use the same `detectRepoState` + new git state detection from enhanced status to determine what would happen

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- `git/detect.ts`: `detectRepoState`, `getCurrentBranch`, `getHeadSha`, `getDirtyFiles`, `getCurrentRef` — extend with ahead/behind, staged/unstaged counts, merge conflict detection
- `git/commands.ts`: `gitFetch` — reuse for auto-fetch in status. `execGit` (private) — may need to expose or duplicate for new git queries
- `executors/status/executor.ts`: Current `reportRepo` function replaced by richer output. Config loading pattern (readFileSync nx.json, validateConfig, normalizeRepos) stays the same
- `executors/sync/executor.ts`: `Promise.allSettled` pattern for parallel execution. `syncRepo` logic stays, add dry-run branch. Summary output enhanced with aligned table
- Graph cache from Phase 2: cached in `.repos/` — status reads this for project counts

### Established Patterns
- Executor options: `SyncExecutorOptions` interface with optional fields, validated by Nx executor schema
- Logger: `@nx/devkit` logger for all output (`logger.info`, `logger.warn`, `logger.error`)
- Config loading: identical pattern in both status and sync executors (could be extracted but not required)
- Error collection: `Promise.allSettled` + post-loop analysis for parallel operations

### Integration Points
- `executors.json`: `polyrepo-sync` schema needs `--dry-run` boolean option added
- `git/detect.ts`: new exported functions for enhanced git state queries
- `.repos/*-graph-cache.json` (or similar): read by status for project counts

</code_context>

<deferred>
## Deferred Ideas

- **Configurable auto-fetch**: `--no-fetch` or `--skip-fetch` flag on polyrepo-status to skip the auto-fetch step for faster output
- **Hideable legend**: `--no-legend` flag on polyrepo-status to suppress the legend section
- **Sync `--prune`**: remove `.repos/` directories for repos no longer in config (later milestone)
- **Our own error hints**: add polyrepo-specific suggestions on top of git's error messages (e.g., "resolve in .repos/repo-a/")
- **Configurable legend format**: one-line vs multi-line legend

</deferred>

---

*Phase: 03-multi-repo-git-dx*
*Context gathered: 2026-03-11*
