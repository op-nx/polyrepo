# Phase 3: Multi-Repo Git DX - Research

**Researched:** 2026-03-11
**Domain:** Git working tree state detection, CLI output formatting, Nx executor options
**Confidence:** HIGH

## Summary

Phase 3 enhances two existing Nx executors (`polyrepo-status` and `polyrepo-sync`) with richer git state information and better output formatting. The core technical challenge is computing per-repo git working tree state (ahead/behind counts, file category counts, warnings) using git plumbing commands, then presenting that data in aligned column-formatted output. A secondary challenge is reading the Phase 2 graph cache to display project counts per repo.

The existing codebase provides strong foundations: `git/detect.ts` already has `getCurrentBranch`, `getCurrentRef`, `getHeadSha`, and `getDirtyFiles`; `git/commands.ts` has `gitFetch`; and both executors have established patterns for config loading, parallel execution (`Promise.allSettled`), and error handling. Phase 3 extends `detect.ts` with new git state queries, rewrites the status executor's output formatting, adds `--dry-run` to the sync executor, and adds an aligned summary table to sync output.

**Primary recommendation:** Extend `git/detect.ts` with a single `getWorkingTreeState()` function that runs `git status --porcelain=v1` and `git rev-list --left-right --count HEAD...@{u}` to gather all needed state in two git calls per repo. Handle shallow clone limitations for ahead/behind by catching errors gracefully and showing `?` when history is insufficient.

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions

- **Working tree summary per repo**: one line per repo with branch, ahead/behind remote, and dirty file counts using `M` (modified), `A` (added/staged), `D` (deleted), `??` (untracked) labels. No individual file paths listed
- **Auto-fetch before status**: `polyrepo-status` runs `git fetch` in each repo (parallelized) before computing ahead/behind counts. Always accurate, ~1-3s added. Making this configurable (skip-fetch flag) is deferred
- **Tag-pinned repos omit ahead/behind**: repos pinned to a tag show tag name, drift detection, and dirty file counts but no ahead/behind columns -- tags don't have tracking branches
- **Unsynced repos shown**: all configured repos appear in output. Unsynced repos display `[not synced]`. Summary line at the bottom shows totals (configured, synced, not synced)
- **Project count per repo**: status reads the Phase 2 graph cache to show how many projects were extracted from each repo. If cache doesn't exist yet, shows `?` with footer explanation
- **Aligned columns**: output padded so values line up vertically across repos (like `docker ps`, `kubectl get pods`)
- **Sync gets aligned summary table**: sync keeps streaming progress lines during execution, then adds an aligned results table at the end showing per-repo outcome (`[OK]` / `[ERROR]` with message)
- **Legend always shown**: printed at bottom of every status run, one symbol per line
- **Enhance polyrepo-status**: the existing executor is upgraded. No new command needed
- **Sync is already complete for GITX-02/GITX-03**: Phase 3 adds aligned results table and `--dry-run`
- **`--dry-run` for sync**: shows what sync would do without executing
- **Proactive warnings in status**: four warning triggers: dirty/sync-may-fail, detached HEAD, merge conflicts, drift
- **Pass through git's error messages**: sync wraps git's stderr with the repo alias for context, no own hints
- **Status always exits 0**: warnings are informational. Exit 1 only if executor itself fails. Sync exit codes unchanged

### Claude's Discretion

- Exact git commands for computing ahead/behind counts, detecting merge conflicts, and detecting detached HEAD
- Column width calculation and padding implementation
- How to read Phase 2 graph cache for project counts (file path, parsing)
- Internal structure of `--dry-run` output formatting
- Whether to extract shared formatting utilities or keep formatting inline per executor

### Deferred Ideas (OUT OF SCOPE)

- Configurable auto-fetch (`--no-fetch` or `--skip-fetch` flag)
- Hideable legend (`--no-legend` flag)
- Sync `--prune` (remove `.repos/` directories for repos no longer in config)
- Polyrepo-specific error hints on top of git's error messages
- Configurable legend format (one-line vs multi-line)
  </user_constraints>

<phase_requirements>

## Phase Requirements

| ID      | Description                                                             | Research Support                                                                                                    |
| ------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| GITX-01 | User can see combined git status of all synced repos in one command     | Enhanced `polyrepo-status` executor with working tree state, ahead/behind, project counts, warnings, aligned output |
| GITX-02 | User can pull/fetch all synced repos with one command                   | Already implemented in `polyrepo-sync`; Phase 3 adds `--dry-run` option and aligned summary table                   |
| GITX-03 | Git operations show clear per-repo output (which repo succeeded/failed) | Sync summary table with `[OK]`/`[ERROR]` per repo; status aligned columns with warnings                             |

</phase_requirements>

## Standard Stack

### Core

| Library                         | Version          | Purpose                                                     | Why Standard                                                                    |
| ------------------------------- | ---------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `node:child_process` (execFile) | Node.js built-in | Execute git plumbing commands                               | Already used in detect.ts; execFile is correct for git binary (not a .cmd shim) |
| `@nx/devkit` (logger)           | ^22.5.4          | All output via `logger.info`, `logger.warn`, `logger.error` | Established project pattern                                                     |
| `@nx/devkit` (readJsonFile)     | ^22.5.4          | Read graph cache JSON                                       | Already used in cache.ts                                                        |

### Supporting

| Library                              | Version          | Purpose                            | When to Use                 |
| ------------------------------------ | ---------------- | ---------------------------------- | --------------------------- |
| `node:path` (join)                   | Node.js built-in | Construct repo paths               | Already imported everywhere |
| `node:fs` (readFileSync, existsSync) | Node.js built-in | Check file existence, read nx.json | Already used in executors   |

### Alternatives Considered

| Instead of              | Could Use                  | Tradeoff                                                                         |
| ----------------------- | -------------------------- | -------------------------------------------------------------------------------- |
| Manual `execFile` calls | `simple-git` npm package   | Adds dependency; project already has the pattern; not needed for ~5 git commands |
| Manual column padding   | `cli-table3` / `columnify` | Adds dependency; our output is simple enough that `String.padEnd()` suffices     |

**Installation:**
No new packages needed. All functionality uses Node.js built-ins and existing dependencies.

## Architecture Patterns

### Recommended Project Structure

```
packages/op-nx-polyrepo/src/lib/
  git/
    detect.ts            # EXTEND: add getWorkingTreeState(), getAheadBehind(), hasMergeConflicts()
    detect.spec.ts       # EXTEND: tests for new functions
    commands.ts          # NO CHANGES (gitFetch already exists)
  executors/
    status/
      executor.ts        # REWRITE: new reportRepo with aligned columns, warnings, auto-fetch
      executor.spec.ts   # REWRITE: tests for new output format
      schema.json        # NO CHANGES (status takes no options)
    sync/
      executor.ts        # EXTEND: add dry-run branch, aligned summary table
      executor.spec.ts   # EXTEND: tests for dry-run and summary table
      schema.json        # EXTEND: add dryRun boolean property
  format/
    table.ts             # NEW: shared column alignment utility
    table.spec.ts        # NEW: tests for alignment
```

### Pattern 1: Single-Call Working Tree State

**What:** Gather all git working tree information (modified/staged/deleted/untracked counts, merge conflict detection) from a single `git status --porcelain=v1` call, then ahead/behind from a separate `git rev-list` call.
**When to use:** Every status report for a synced repo.
**Why:** `git status --porcelain=v1` is a stable, machine-parseable format that provides all file state information in one call. Reduces from N git calls to 2 per repo.

```typescript
// Source: git-scm.com/docs/git-status (porcelain v1 format)
export interface WorkingTreeState {
  modified: number; // XY where Y is 'M' (working tree changed)
  staged: number; // XY where X is 'M', 'A', 'D', 'R', or 'C'
  deleted: number; // XY where Y is 'D' or X is 'D'
  untracked: number; // '??' prefix
  conflicts: number; // 'UU', 'AA', 'DD', 'AU', 'UA', 'DU', 'UD' patterns
}

export async function getWorkingTreeState(
  cwd: string,
): Promise<WorkingTreeState> {
  const output = await execGitOutput(['status', '--porcelain=v1'], cwd);
  const lines = output.split('\n').filter(Boolean);

  let modified = 0;
  let staged = 0;
  let deleted = 0;
  let untracked = 0;
  let conflicts = 0;

  for (const line of lines) {
    const x = line[0];
    const y = line[1];

    // Unmerged states (must check before other states)
    if (
      x === 'U' ||
      y === 'U' ||
      (x === 'A' && y === 'A') ||
      (x === 'D' && y === 'D')
    ) {
      conflicts++;
      continue;
    }

    // Untracked
    if (x === '?' && y === '?') {
      untracked++;
      continue;
    }

    // Staged (index has changes): X is M, A, D, R, or C
    if ('MADRC'.includes(x)) {
      staged++;
    }

    // Working tree modified: Y is M
    if (y === 'M') {
      modified++;
    }

    // Deleted: Y is D (working tree) or X is D (staged deletion)
    if (y === 'D') {
      deleted++;
    } else if (x === 'D') {
      deleted++;
    }
  }

  return { modified, staged, deleted, untracked, conflicts };
}
```

### Pattern 2: Ahead/Behind with Graceful Shallow-Clone Handling

**What:** Compute commits ahead/behind using `git rev-list --left-right --count HEAD...@{u}`, with error handling for detached HEAD, no upstream, and shallow clones.
**When to use:** Every synced repo that is on a branch (not detached, not tag-pinned).

```typescript
export interface AheadBehind {
  ahead: number;
  behind: number;
}

export async function getAheadBehind(cwd: string): Promise<AheadBehind | null> {
  try {
    const output = await execGitOutput(
      ['rev-list', '--left-right', '--count', 'HEAD...@{u}'],
      cwd,
    );
    // Output format: "2\t3" (ahead\tbehind)
    const [ahead, behind] = output.split('\t').map(Number);

    return { ahead, behind };
  } catch {
    // Fails when: detached HEAD, no upstream configured, shallow clone
    return null;
  }
}
```

### Pattern 3: Aligned Column Output

**What:** Compute maximum width per column across all repos, then pad each value.
**When to use:** Status output and sync summary table.

```typescript
interface ColumnDef {
  value: string;
  align?: 'left' | 'right';
}

function formatAlignedTable(rows: ColumnDef[][]): string[] {
  // Compute max width per column
  const colWidths: number[] = [];

  for (const row of rows) {
    for (let i = 0; i < row.length; i++) {
      colWidths[i] = Math.max(colWidths[i] ?? 0, row[i].value.length);
    }
  }

  // Format each row with padding
  return rows.map((row) =>
    row
      .map((col, i) => {
        if (col.align === 'right') {
          return col.value.padStart(colWidths[i]);
        }

        return col.value.padEnd(colWidths[i]);
      })
      .join('  '),
  );
}
```

### Pattern 4: Shared Config Loading

**What:** Extract the repeated config loading pattern (readFileSync nx.json, find plugin entry, validateConfig, normalizeRepos) into a shared utility.
**When to use:** Both status and sync executors use identical config loading. Extracting avoids duplication and ensures consistency.
**Recommendation:** Extract to `config/load.ts` since both executors will grow more complex in this phase.

### Anti-Patterns to Avoid

- **Running N separate git commands per repo:** Use `git status --porcelain=v1` for all file state in one call instead of separate `git diff --name-only`, `git diff --cached --name-only`, `git ls-files --others`, etc.
- **Blocking on auto-fetch sequentially:** The auto-fetch step must use `Promise.allSettled` to fetch all repos in parallel, since each fetch involves network I/O.
- **Hard-failing on ahead/behind errors:** Shallow clones (default `depth: 1`) may not have enough history for accurate ahead/behind. Return `null` and display `?` rather than crashing.
- **Custom string-level table formatting in executor code:** Extract alignment logic to keep executor code focused on business logic.

## Don't Hand-Roll

| Problem                   | Don't Build                              | Use Instead                                                            | Why                                                                                       |
| ------------------------- | ---------------------------------------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Parsing git file status   | Custom regex per file state              | `git status --porcelain=v1` output parsing                             | Porcelain format is stable across git versions; guaranteed machine-parseable              |
| Detecting merge conflicts | Searching for `<<<<<<<` markers in files | `git status --porcelain=v1` UU/AA/DD patterns                          | Conflict markers can appear in non-conflicted content; porcelain status is authoritative  |
| Detecting detached HEAD   | `getCurrentBranch() === null` check      | Already have this -- `getCurrentBranch` returns null for detached HEAD | Existing function uses `rev-parse --abbrev-ref HEAD` which returns `'HEAD'` when detached |

**Key insight:** `git status --porcelain=v1` is the single source of truth for working tree state. It provides all file categories (staged, modified, deleted, untracked, conflicted) in a stable, version-independent format. Don't use multiple git commands to gather what one command provides.

## Common Pitfalls

### Pitfall 1: Shallow Clone Ahead/Behind Failure

**What goes wrong:** `git rev-list --left-right --count HEAD...@{u}` returns inaccurate counts or errors in shallow clones (default `depth: 1`).
**Why it happens:** Shallow clones have truncated commit history. The merge-base calculation between HEAD and upstream requires graph traversal that may hit the shallow boundary.
**How to avoid:** Wrap `getAheadBehind()` in try/catch. When it returns `null`, display `?` for ahead/behind counts in the status output (consistent with the `?` pattern already used for missing graph cache). The auto-fetch step (`git fetch`) does update remote refs but does NOT deepen the shallow boundary, so the local shallow graph still lacks intermediate commits.
**Warning signs:** Tests that mock `rev-list` output passing but real repos with `depth: 1` showing wrong counts. Integration tests need to cover this scenario.

### Pitfall 2: Tag-Pinned Repos Have No Upstream

**What goes wrong:** `git rev-list HEAD...@{u}` fails with "no upstream branch" for repos checked out to a tag (detached HEAD at a tag).
**Why it happens:** Tags create detached HEAD state. There is no tracking branch configured, so `@{u}` has no meaning.
**How to avoid:** Check if repo is tag-pinned (existing `isTagRef()` in sync executor, or `getCurrentBranch() === null` combined with `getCurrentRef()` returning a tag). Skip ahead/behind for tag-pinned repos entirely, as specified in the locked decisions.
**Warning signs:** Errors logged during status for tag-pinned repos.

### Pitfall 3: Parallel Fetch Errors Masking Each Other

**What goes wrong:** When running `git fetch` in parallel across repos, network errors (auth denied, DNS failure, timeout) from one repo may be silently swallowed.
**Why it happens:** `Promise.allSettled` collects all results but the error handling might only log the first or miss formatting.
**How to avoid:** After `Promise.allSettled` for the fetch phase, check each result individually. Log warnings for failed fetches but proceed with status display (using stale remote refs). Status must not fail because fetch failed.
**Warning signs:** A repo showing `+0 -0` when it should show `+0 -5` because the fetch silently failed and remote refs are stale.

### Pitfall 4: Porcelain Status Double-Counting

**What goes wrong:** A file that is both staged AND has working-tree modifications (e.g., `MM`) gets counted in two categories.
**Why it happens:** The XY format encodes index state (X) and working-tree state (Y) independently. A file with `MM` is staged (M in X position) AND modified in working tree (M in Y position).
**How to avoid:** This is actually correct behavior per the user's decision -- they want counts by category (`M` for modified, `A` for staged). A file that is both staged and modified SHOULD appear in both counts. The CONTEXT.md uses `M` for "modified files" and `A` for "staged/added files" which maps to Y=M and X in [MADRC] respectively. Document this in the output legend.
**Warning signs:** Total file counts seeming higher than expected when files have both staged and unstaged changes.

### Pitfall 5: execFile vs exec for git binary

**What goes wrong:** Confusion about when to use `execFile` vs `exec`.
**Why it happens:** Project memory notes that `.bin/*` shims need `exec` on Windows. However, `git` is not a `.bin` shim -- it's a real executable on PATH.
**How to avoid:** Continue using `execFile('git', args, ...)` in `detect.ts` as it already does. `execFile` is preferred for security (no shell injection) and performance (no shell spawn). Only `.bin/*` shims need `exec`.
**Warning signs:** None currently -- the existing pattern is correct.

### Pitfall 6: Graph Cache Race Condition

**What goes wrong:** Status executor reads the graph cache file while `createNodesV2` might be writing to it.
**Why it happens:** The status executor runs as an Nx target, which triggers `createNodesV2`. But the status executor also independently reads the cache file for project counts. These could overlap.
**How to avoid:** The status executor should read the cache file with try/catch and display `?` on parse failure. Since the cache file is written atomically by `writeJsonFile`, partial reads are unlikely but corrupt JSON is possible during concurrent writes. Alternatively, read the cache file BEFORE the executor logic begins (it will already be populated since createNodesV2 runs before any executor).
**Warning signs:** Intermittent `?` project counts when running status while other Nx commands are active.

## Code Examples

### Computing Working Tree State from Porcelain Output

```typescript
// Source: git-scm.com/docs/git-status (Short Format / Porcelain v1)
// XY format: X = index status, Y = work-tree status
//
// Conflict patterns (unmerged):
//   DD = both deleted
//   AU = added by us
//   UD = deleted by them
//   UA = added by them
//   DU = deleted by us
//   AA = both added
//   UU = both modified
//
// To detect conflicts, check: X === 'U' || Y === 'U' || (X === 'A' && Y === 'A') || (X === 'D' && Y === 'D')

const porcelainOutput = await execGitOutput(['status', '--porcelain=v1'], cwd);
```

### Computing Ahead/Behind

```typescript
// Source: git-scm.com/docs/git-rev-list
// HEAD...@{u} uses three-dot notation (symmetric difference)
// --left-right distinguishes commits reachable from each side
// --count outputs counts instead of commit hashes
// Output: "ahead_count\tbehind_count"

const output = await execGitOutput(
  ['rev-list', '--left-right', '--count', 'HEAD...@{u}'],
  cwd,
);
const parts = output.split('\t');
const ahead = parseInt(parts[0], 10);
const behind = parseInt(parts[1], 10);
```

### Reading Graph Cache for Project Counts

```typescript
// Source: packages/op-nx-polyrepo/src/lib/graph/cache.ts
// Cache file: .repos/.polyrepo-graph-cache.json
// Structure: { hash: string, report: { repos: { [alias]: { nodes: {...}, dependencies: [...] } } } }

import { readJsonFile } from '@nx/devkit';
import { join } from 'node:path';

interface CacheFile {
  hash: string;
  report: {
    repos: Record<string, { nodes: Record<string, unknown> }>;
  };
}

function getProjectCount(workspaceRoot: string, alias: string): number | null {
  try {
    const cachePath = join(
      workspaceRoot,
      '.repos',
      '.polyrepo-graph-cache.json',
    );
    const cache = readJsonFile<CacheFile>(cachePath);
    const repoReport = cache.report?.repos?.[alias];

    if (!repoReport) {
      return null;
    }

    return Object.keys(repoReport.nodes).length;
  } catch {
    return null;
  }
}
```

### Dry-Run Output for Sync

```typescript
// Determine what sync WOULD do without executing
// Reuses detectRepoState + getWorkingTreeState to predict outcomes

interface DryRunEntry {
  alias: string;
  action: 'clone' | 'pull' | 'fetch-tag' | 'skip';
  warning?: string;
}

// For each entry:
// - not-synced + remote -> 'clone'
// - cloned + tag ref -> 'fetch-tag'
// - cloned + branch ref -> 'pull' (or strategy name)
// - not-synced + local -> 'skip' (path doesn't exist)
// - referenced + local -> 'pull'
// If working tree is dirty: warning = 'dirty, may fail'
```

## State of the Art

| Old Approach                                | Current Approach                           | When Changed     | Impact                                 |
| ------------------------------------------- | ------------------------------------------ | ---------------- | -------------------------------------- |
| `git diff --name-only HEAD` for dirty check | `git status --porcelain=v1` for full state | Always available | Single command provides all categories |
| Sequential repo processing in status        | Parallel with `Promise.allSettled`         | Phase 3          | Required for auto-fetch latency hiding |
| Unstructured logger.info output             | Aligned column table                       | Phase 3          | Scannable output like docker ps        |

**Deprecated/outdated:**

- The current `getDirtyFiles()` in `detect.ts` uses `git diff --name-only HEAD` which only shows unstaged changes relative to HEAD. Phase 3 replaces this with porcelain status for complete state. `getDirtyFiles` is still used by `cache.ts` for hash computation, so it should be kept but the new `getWorkingTreeState` is used for display.

## Open Questions

1. **Column alignment with ANSI-width strings**
   - What we know: The `logger` from `@nx/devkit` may or may not strip ANSI codes. If we add color (e.g., red for warnings), `padEnd` would need to account for invisible ANSI escape sequence bytes.
   - What's unclear: Whether `@nx/devkit` logger applies its own coloring/formatting.
   - Recommendation: Start without colors (plain text). Coloring can be added later since warning text like `[WARN: dirty, sync may fail]` is self-explanatory. The CONTEXT.md output examples show no colors.

2. **Whether to count staged/deleted as separate from modified in status output**
   - What we know: CONTEXT.md example shows `3M 1??` format -- modified and untracked. The legend lists M, A, D, ?? as separate categories.
   - What's unclear: The example output only shows M and ?? but the legend includes A and D.
   - Recommendation: Show all non-zero categories. If a repo has 3 modified, 1 staged, 2 deleted, 1 untracked: `3M 1A 2D 1??`. If only modified: `3M`. If clean: `clean`.

## Validation Architecture

### Test Framework

| Property           | Value                                       |
| ------------------ | ------------------------------------------- |
| Framework          | Vitest 4.x                                  |
| Config file        | `packages/op-nx-polyrepo/vitest.config.mts` |
| Quick run command  | `npm exec nx test @op-nx/polyrepo`          |
| Full suite command | `npm exec nx test @op-nx/polyrepo`          |

### Phase Requirements -> Test Map

| Req ID  | Behavior                                                    | Test Type | Automated Command                                                                 | File Exists?        |
| ------- | ----------------------------------------------------------- | --------- | --------------------------------------------------------------------------------- | ------------------- |
| GITX-01 | `getWorkingTreeState` parses porcelain output correctly     | unit      | `npm exec nx test @op-nx/polyrepo -- --reporter=verbose -t "getWorkingTreeState"` | No - Wave 0         |
| GITX-01 | `getAheadBehind` computes counts and handles errors         | unit      | `npm exec nx test @op-nx/polyrepo -- --reporter=verbose -t "getAheadBehind"`      | No - Wave 0         |
| GITX-01 | Status executor outputs aligned columns with all data       | unit      | `npm exec nx test @op-nx/polyrepo -- --reporter=verbose -t "statusExecutor"`      | Yes - needs rewrite |
| GITX-01 | Status executor runs auto-fetch in parallel before state    | unit      | `npm exec nx test @op-nx/polyrepo -- --reporter=verbose -t "auto-fetch"`          | No - Wave 0         |
| GITX-01 | Status executor reads graph cache for project counts        | unit      | `npm exec nx test @op-nx/polyrepo -- --reporter=verbose -t "project count"`       | No - Wave 0         |
| GITX-01 | Status shows warnings for dirty, detached, conflicts, drift | unit      | `npm exec nx test @op-nx/polyrepo -- --reporter=verbose -t "WARN"`                | No - Wave 0         |
| GITX-02 | Sync `--dry-run` shows predicted actions without executing  | unit      | `npm exec nx test @op-nx/polyrepo -- --reporter=verbose -t "dry-run"`             | No - Wave 0         |
| GITX-03 | Sync summary table shows aligned per-repo results           | unit      | `npm exec nx test @op-nx/polyrepo -- --reporter=verbose -t "summary table"`       | No - Wave 0         |
| GITX-03 | Table alignment utility pads columns correctly              | unit      | `npm exec nx test @op-nx/polyrepo -- --reporter=verbose -t "formatAlignedTable"`  | No - Wave 0         |

### Sampling Rate

- **Per task commit:** `npm exec nx test @op-nx/polyrepo`
- **Per wave merge:** `npm exec nx test @op-nx/polyrepo`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] New test cases in `detect.spec.ts` for `getWorkingTreeState`, `getAheadBehind`
- [ ] Rewritten test cases in `status/executor.spec.ts` for new output format
- [ ] New test cases in `sync/executor.spec.ts` for `--dry-run` and summary table
- [ ] `format/table.ts` + `format/table.spec.ts` for alignment utility (new files)

## Sources

### Primary (HIGH confidence)

- [Git - git-status Documentation](https://git-scm.com/docs/git-status) - porcelain v1 format specification, XY status codes, unmerged patterns
- [Git - git-rev-list Documentation](https://git-scm.com/docs/git-rev-list) - `--left-right --count` for ahead/behind
- [Git - git-rev-parse Documentation](https://git-scm.com/docs/git-rev-parse) - `@{u}` upstream shorthand, `--abbrev-ref HEAD` for branch detection
- Existing codebase: `packages/op-nx-polyrepo/src/lib/git/detect.ts`, `commands.ts`, `executors/status/executor.ts`, `executors/sync/executor.ts`, `graph/cache.ts`

### Secondary (MEDIUM confidence)

- [Brandon Rozek - Ahead/Behind Git](https://brandonrozek.com/blog/ahead-behind-git/) - practical examples of rev-list ahead/behind
- [GitHub Blog - Partial Clone and Shallow Clone](https://github.blog/open-source/git/get-up-to-speed-with-partial-clone-and-shallow-clone/) - shallow clone limitations
- [Stefan Judis - git status porcelain mode](https://www.stefanjudis.com/today-i-learned/the-short-version-of-git-status-and-the-close-but-different-porcelain-mode/) - porcelain vs short format differences

### Tertiary (LOW confidence)

- None. All findings verified with official Git documentation.

## Competitive Landscape: Multi-Repo Tools

**Researched:** 2026-03-11 (online research during UAT gap-closure)
**Context:** Researched how existing polyrepo tools handle ref switching (tag-to-branch, branch-to-tag) to inform our sync executor design.

### Tools Surveyed

| Tool                                                                | Type                | Manifest-driven         | Ref switching behavior                                                                   |
| ------------------------------------------------------------------- | ------------------- | ----------------------- | ---------------------------------------------------------------------------------------- |
| [Google repo](https://source.android.com/docs/setup/reference/repo) | Android multi-repo  | Yes (XML manifest)      | Fetch + checkout/rebase. `-d` forces manifest revision. No ref-type-change warning.      |
| [git-submodule](https://git-scm.com/docs/git-submodule)             | Git built-in        | Yes (.gitmodules + SHA) | Always detached HEAD on pinned SHA. Branch tracking opt-in via `--remote`.               |
| [vcstool](https://github.com/dirk-thomas/vcstool)                   | ROS workspace       | Yes (YAML)              | `git fetch` + `git checkout`. Auto-detects ref type via `git ls-remote`.                 |
| [tsrc](https://github.com/your-tools/tsrc)                          | Manifest multi-repo | Yes (YAML)              | Separate `branch`, `tag`, `sha1` fields. Branches: merge. Tags/SHAs: `git reset --hard`. |
| [mrgit (mgit2)](https://github.com/cksource/mrgit)                  | CKSource multi-repo | Yes (JSON)              | Switches to configured branch, then pulls. Skips dirty repos entirely.                   |
| [meta](https://github.com/mateodelnorte/meta)                       | npm multi-repo      | No (thin wrapper)       | Passthrough to git. No manifest-driven ref management.                                   |
| [gita](https://github.com/nosarthur/gita)                           | Multi-repo CLI      | No (thin wrapper)       | Delegates to git directly. No ref type tracking.                                         |
| [myrepos (mr)](https://myrepos.branchable.com/)                     | Multi-repo tool     | Yes (.mrconfig)         | Fully configurable per-repo commands. No built-in ref switching.                         |
| [git-subrepo](https://github.com/ingydotnet/git-subrepo)            | Subrepo management  | Yes (.gitrepo)          | Destructive re-clone (`--force`) to switch refs. No incremental switching.               |
| [Lerna](https://lerna.js.org/)                                      | Monorepo versioning | No                      | Does not manage repo checkouts. Tags for releases only.                                  |

### Key Patterns Observed

**1. Fetch-then-checkout is universal**
Every tool that handles ref switching does `git fetch` before any checkout/reset/merge. No tool attempts a pull on potentially stale state.

**2. Config is source of truth — no warnings on ref type change**
No tool warns about ref type transitions (tag→branch or vice versa). They apply whatever the manifest says. This is an opportunity for @op-nx/polyrepo to provide better UX.

**3. Dirty working tree handling: refuse by default**
tsrc, mrgit, vcstool, Google repo, and git-submodule all refuse to switch refs when the working tree is dirty. Force flags (`--force`) available as opt-in for destructive override.

**4. tsrc is the closest model to our use case**

- Explicit ref type distinction in manifest
- Different sync strategies per ref type (merge for branches, reset for tags)
- Dirty repo detection before any operation
- Always fetches first

**5. Git DWIM for local branch creation**
After fetching, `git checkout <branch>` auto-creates a local tracking branch from `origin/<branch>` if it uniquely matches. tsrc and vcstool both rely on this behavior.

### Implications for @op-nx/polyrepo

- **Sync should detect ref type transitions** and handle them gracefully (checkout target branch before pull)
- **Fetch before checkout** when switching from tag→branch to ensure remote refs are available
- **Dirty tree check before ref switch** — already partially done via dry-run warnings; sync should also check before attempting a branch switch
- **No need to warn about ref type changes** — following established convention, just apply the config

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH - no new dependencies, extending existing patterns with well-documented git plumbing commands
- Architecture: HIGH - clear extension points in existing code, well-understood git porcelain format
- Pitfalls: HIGH - shallow clone limitation verified against multiple sources including official git docs; all edge cases (detached HEAD, no upstream, tag-pinned) have established handling patterns

**Research date:** 2026-03-11
**Valid until:** 2026-04-11 (stable domain -- git plumbing commands and Nx executor patterns are mature)
