# Research: Nx SQLite File Locking on Windows (os error 32)

**Domain:** Nx monorepo tooling / Windows arm64 / ReFS Dev Drive
**Researched:** 2026-03-20
**Overall confidence:** HIGH

## Executive Summary

The `os error 32` (`ERROR_SHARING_VIOLATION`) when `connectToNxDb()` runs after plugin workers
shut down is a **known class of bugs** in Nx's SQLite-backed caching system. It is not a single
isolated issue but a convergence of three factors: (1) Windows mandatory file locking semantics,
(2) Node.js child process handle inheritance, and (3) Nx's architecture where plugin workers open
SQLite connections that may not fully release file handles before the task runner opens its own
connection.

The Nx team has progressively hardened the SQLite layer through PRs #28390, #28667, #33054,
#33143, and #34533 (spanning October 2024 to late 2025). PR #33054, merged October 2025, is the
most relevant -- it overhauls `initialize_db` with iterative retry logic, stale WAL file cleanup,
WSL1 detection, and better error messages. PR #34533 adds full-transaction retry on `DatabaseBusy`.

**Critically: `NX_DISABLE_DB` was removed in Nx 22.0.0** (our version is 22.5.4). There is no
way to opt out of the SQLite database in current Nx versions. The Nx team's position is that the
DB layer should be made robust enough that disabling it is unnecessary.

ReFS (Dev Drive) is **not the primary cause** but may contribute: ReFS uses aggressive metadata
checkpointing and copy-on-write semantics that interact differently with SQLite's byte-range
locking compared to NTFS. However, the core issue is Windows mandatory locking + handle
inheritance in Node.js child processes.

## 1. Nx GitHub Issues -- Known Bug Landscape

### Directly Relevant Issues

| Issue                                             | Title                                         | Status   | Platform     | Key Detail                                                              |
| ------------------------------------------------- | --------------------------------------------- | -------- | ------------ | ----------------------------------------------------------------------- |
| [#28424](https://github.com/nrwl/nx/issues/28424) | Parallel tasks fail with "disk I/O error"     | Closed   | `win32-x64`  | First Windows-specific SQLite report. Nx 19.8.4.                        |
| [#28608](https://github.com/nrwl/nx/issues/28608) | Multiple Nx instances throw database locked   | Closed   | Multiple     | `DatabaseBusy` (extended_code: 5) on concurrent runs                    |
| [#28665](https://github.com/nrwl/nx/issues/28665) | SqliteFailure "DatabaseBusy" on `nx run-many` | Closed   | Linux/Docker | After upgrade from 18.3.5 to 20.0.6                                     |
| [#28640](https://github.com/nrwl/nx/issues/28640) | Unable to set journal_mode: CannotOpen        | Closed   | Linux CI     | **High priority**. Self-hosted GitHub runners                           |
| [#28772](https://github.com/nrwl/nx/issues/28772) | "database disk image is malformed"            | Closed   | Multiple     | Parallel tasks + UNIQUE constraint failures                             |
| [#30856](https://github.com/nrwl/nx/issues/30856) | Daemon crash: SQLite "locking protocol"       | Closed   | WSL1/WSL2    | `FileLockingProtocolFailed` (code 15). Workaround: `NX_DISABLE_DB=true` |
| [#32894](https://github.com/nrwl/nx/issues/32894) | Nx 21.6.2: disk I/O error on journal_mode     | Closed   | Multiple     | After migration, `SystemIoFailure` (code 522)                           |
| [#32981](https://github.com/nrwl/nx/issues/32981) | taskDetails logging should be opt-out         | **OPEN** | Linux        | Requests `NX_DISABLE_DB` replacement for parallel runs                  |
| [#34442](https://github.com/nrwl/nx/issues/34442) | Plugin worker not connected within 5 seconds  | Open     | `win32-x64`  | Worker shutdown race on Windows                                         |

### Key Fix PRs

| PR                                              | Title                                                   | Merged     | What it does                                                                            |
| ----------------------------------------------- | ------------------------------------------------------- | ---------- | --------------------------------------------------------------------------------------- |
| [#28390](https://github.com/nrwl/nx/pull/28390) | Add busy handler for sqlite                             | 2024-10-15 | Added `busy_handler` callback to retry on SQLite busy signal                            |
| [#28667](https://github.com/nrwl/nx/pull/28667) | Retry more db operations                                | 2024-10-30 | Transaction and pragma_update retry logic, `FULL_MUTEX` mode on CI                      |
| [#28747](https://github.com/nrwl/nx/pull/28747) | Disable the db by default                               | ~2024-11   | Temporarily disabled DB. Later reversed.                                                |
| [#33054](https://github.com/nrwl/nx/pull/33054) | Improve db connection init and error messages           | 2025-10-16 | **Major overhaul**: iterative retry, stale WAL cleanup, WSL1 detection, DELETE fallback |
| [#33143](https://github.com/nrwl/nx/pull/33143) | Do not remove wal files manually for existing databases | 2025-10-21 | Simplified initialization, prevents race with manual WAL deletion                       |
| [#34533](https://github.com/nrwl/nx/pull/34533) | Retry entire SQLite transaction on DatabaseBusy         | ~2025+     | Retries the whole transaction, not just individual statements                           |
| [#32887](https://github.com/nrwl/nx/pull/32887) | Remove NX_DISABLE_DB                                    | Nx 22.0.0  | **Breaking change**: removed the escape hatch                                           |

### Assessment

No single issue matches our exact error signature (`os error 32` on `connectToNxDb` after plugin
worker shutdown on Windows arm64 ReFS). However, issues #28424 and #34442 are the closest
analogues. The error is a variant of the same underlying problem: **SQLite file handles held by
exiting processes causing lock contention on Windows**.

**Confidence: HIGH** -- the issue class is well-documented even if our exact platform combo is not.

## 2. Nx Environment Variables

### Database-Related

| Variable                           | Status (Nx 22)        | Description                                                                          |
| ---------------------------------- | --------------------- | ------------------------------------------------------------------------------------ |
| `NX_DISABLE_DB`                    | **REMOVED** in 22.0.0 | Was the primary escape hatch. No replacement.                                        |
| `NX_WORKSPACE_DATA_DIRECTORY`      | Active                | Redirects `.nx/workspace-data` to a custom path. **Our current workaround.**         |
| `NX_PROJECT_GRAPH_CACHE_DIRECTORY` | Legacy fallback       | Older name for `NX_WORKSPACE_DATA_DIRECTORY`                                         |
| `NX_CACHE_DIRECTORY`               | Active                | Redirects `.nx/cache` for task outputs. Separate from workspace data.                |
| `NX_SKIP_NX_CACHE`                 | Active                | Skips cache reads/writes but **does NOT skip DB metadata writes** (per issue #32981) |

### Debugging / Logging

| Variable                 | Description                                                                             |
| ------------------------ | --------------------------------------------------------------------------------------- |
| `NX_NATIVE_LOGGING`      | Controls Rust-side logging to stdout. Example: `NX_NATIVE_LOGGING=nx::native::db=trace` |
| `NX_NATIVE_FILE_LOGGING` | Same filter syntax but writes to `.nx/workspace-data/nx.log` instead of stdout          |
| `NX_VERBOSE_LOGGING`     | TypeScript-side verbose logging                                                         |
| `NX_DAEMON`              | Set to `false` to disable the daemon (useful for debugging)                             |
| `NX_PERF_LOGGING`        | Profiling data for executors and Nx internals                                           |

### Important Notes

- There is **no env var to disable WAL mode** or control SQLite journal mode directly. The Rust
  code in `initialize.rs` handles journal mode selection automatically with WAL-first, DELETE
  fallback.
- There is **no env var to add a delay** between plugin shutdown and task runner start.
- `NX_SKIP_NX_CACHE` does **not** prevent SQLite writes (task_details are always logged).
  Issue #32981 requests a mechanism for this but it remains open.

**Confidence: HIGH** -- verified against Nx 22 source code and official documentation.

## 3. Windows ReFS / Dev Drive Specifics

### Does ReFS Handle File Locks Differently Than NTFS?

**Yes, but in subtle ways that are unlikely to be the root cause here.**

ReFS (Resilient File System) used by Dev Drive differs from NTFS in several ways relevant to
SQLite:

1. **Copy-on-write semantics**: ReFS uses allocate-on-write for metadata, which means file
   metadata updates behave differently under concurrent access. NTFS uses in-place updates.

2. **Aggressive metadata checkpointing**: ReFS v3.14+ (used in Windows 11 24H2) is more
   aggressive with metadata flushing. In high-concurrency scenarios, this can conflict with
   storage filter drivers (AV, EDR).

3. **Locked-down root ACL**: Dev Drive ships with SYSTEM ownership and a restricted ACL. This
   can cause unexpected permission issues that look like locking errors but are actually access
   control failures.

4. **No known SQLite + ReFS incompatibility**: SQLite's byte-range locking (`LockFile()` /
   `LockFileEx()`) works on ReFS. The locking protocol is the same Windows API regardless of
   filesystem. SQLite does not use memory-mapped I/O for its lock page on Windows, so ReFS's
   different mmap semantics are not relevant.

### Is ReFS the Cause?

**Unlikely as the primary cause.** The same error class occurs on NTFS (issues #28424, #23224).
ReFS may exacerbate timing-sensitive race conditions due to its different I/O scheduling, but the
fundamental problem is handle inheritance in child processes.

**One exception**: if Windows Defender or another filter driver is configured differently on the
Dev Drive (e.g., performance mode, trust designation changes), it could hold file handles
differently. Dev Drive allows configuring antivirus filter bypass for trusted processes.

**Confidence: MEDIUM** -- no specific "SQLite + ReFS = broken" evidence found, but limited testing
in the ecosystem. ReFS is newer and less battle-tested with SQLite than NTFS.

## 4. SQLite on Windows -- Fundamental Constraints

### Mandatory vs. Advisory Locking

On Unix/POSIX, file locks are **advisory** -- any process can ignore them. On Windows, file locks
are **mandatory** -- the OS enforces them at the kernel level. This is the single biggest
difference affecting SQLite cross-platform behavior.

SQLite uses `LockFile()` and `LockFileEx()` on Windows for byte-range locks. These are mandatory
locks that prevent both reading and writing by other processes in the locked range.

### WAL Mode on Windows

- WAL (Write-Ahead Logging) mode holds `SQLITE_LOCK_SHARED` continuously while the connection is
  open. This means the database file is **always locked** (at least shared) while any connection
  exists.
- WAL creates two auxiliary files: `.db-wal` (write-ahead log) and `.db-shm` (shared memory).
  The `.db-shm` file uses memory-mapped I/O on Unix but falls back to file I/O on Windows.
- **Known issue**: WAL mode on Windows can cause file locks to persist **beyond `close()` calls**
  (reported in oven-sh/bun#25964 and elsewhere). This is because the OS may not release the lock
  immediately when the handle is closed if another process has inherited a copy of the handle.

### Handle Inheritance -- The Root Cause Mechanism

The likely mechanism for our `os error 32`:

1. **Nx daemon opens SQLite DB** via `connectToNxDb()` in the Rust native layer.
2. **Plugin workers are spawned** as Node.js child processes (via `child_process.fork()`).
   On Windows, `CreateProcess` is called with `bInheritHandles = TRUE` by default in Node.js.
3. **SQLite file handles are inherited** by the plugin worker processes. The workers may or may
   not use the DB directly, but they hold inherited copies of the parent's file handles.
4. **Plugin workers shut down**, but their process exit may not release the inherited SQLite
   file handles immediately (Windows has no guarantee on handle release timing at process exit).
5. **Task runner calls `connectToNxDb()`**, which tries to set journal_mode. Because inherited
   handles from recently-exited workers still hold locks, SQLite gets `ERROR_SHARING_VIOLATION`
   (os error 32) when trying to open the file with exclusive access for journal mode changes.

This is the same pattern documented by CodiLime in their analysis of faultily inherited file
handles on Windows, and by the .NET runtime team in dotnet/runtime#19569 (proposing that
`Process` should not inherit handles by default).

### Windows Defender / Antivirus Factor

On fast systems, Windows Defender may hold file handles **briefly after a process closes them**
for scanning. This window is typically <100ms but can overlap with the task runner's immediate
attempt to open the same DB file. This is well-documented in the Rust ecosystem
(rust-lang/rust#88924, rust-lang/rustup#4181).

**Confidence: HIGH** -- this mechanism is well-understood and documented across multiple ecosystems.

## 5. Debugging: NX_NATIVE_LOGGING and Related Flags

### Available Debugging Tools

```bash
# Enable trace-level logging for the db module to stdout
NX_NATIVE_LOGGING=nx::native::db=trace npm exec nx -- build devkit

# Same but to a file (useful for non-interactive runs)
NX_NATIVE_FILE_LOGGING=nx::native::db=trace npm exec nx -- build devkit
# Output: .nx/workspace-data/nx.log

# Enable all native module logging (very verbose)
NX_NATIVE_LOGGING=trace npm exec nx -- build devkit

# Combine with daemon disabled for clearest output
NX_DAEMON=false NX_NATIVE_LOGGING=nx::native::db=trace npm exec nx -- build devkit
```

### What the Logs Will Show

With `nx::native::db=trace`, you will see:

- `Creating connection to "<path>"` -- which DB file is being opened
- `Creating lock file at "<path>"` -- the `.lock` file acquisition
- `Got lock on db lock file` -- successful lock acquisition
- `Checking if current existing database is compatible with Nx X.Y.Z`
- `Database is compatible` or `Incompatible database because: ...`
- `Successfully enabled WAL journal mode` or `WAL mode failed: ...`
- `Database busy. Retrying N of 20` -- retry logic triggered

### What Logs Will NOT Show

- **Which process holds the conflicting lock** -- SQLite's error does not include PID information.
  On Windows, use Process Explorer (Ctrl+F, search for the `.db` filename) to identify the
  holding process.
- **Whether the issue is handle inheritance vs. active use** -- the error is the same regardless
  of whether the file handle is actively being used or is a stale inherited handle.

**Confidence: HIGH** -- verified from Nx source code (`logger/mod.rs` and `initialize.rs`).

## 6. Recommended Solutions

### Solution A: NX_WORKSPACE_DATA_DIRECTORY per-run (Current Workaround) -- ADEQUATE

```bash
# What we're already doing
NX_WORKSPACE_DATA_DIRECTORY=$(mktemp -d) npm exec nx -- build devkit
```

**Pros:**

- Works reliably. Each run gets its own SQLite DB, no contention.
- No Nx version dependency.

**Cons:**

- Loses cross-run caching (task history, estimated timings).
- Creates temp directories that need cleanup.
- Doesn't address the root cause.

**Verdict:** Good enough for CI and ephemeral contexts. Wasteful for local development.

### Solution B: Disable the Daemon (NX_DAEMON=false) -- RECOMMENDED FOR THIS USE CASE

```bash
NX_DAEMON=false npm exec nx -- build devkit
```

**Rationale:** When running Nx in a child repo (`.repos/nx/`) from our plugin, the daemon is
unnecessary overhead. The daemon is the process that keeps SQLite connections open across runs.
Disabling it means:

- No persistent SQLite connections that could be inherited by plugin workers.
- Each `nx` invocation opens and closes its own DB connection cleanly.
- Plugin workers still run but without a daemon holding the DB open in the background.

**Pros:**

- Addresses the root cause (persistent connections across process boundaries).
- Simple, single env var.
- Cross-run caching still works (the DB is opened/closed per invocation, not held open).

**Cons:**

- Slightly slower startup (no daemon to keep warm project graph in memory).
- For large repos like `nrwl/nx` (~21 plugins), cold graph computation adds ~2-5s.

**Verdict:** Best tradeoff for our use case (running builds in synced external repos).

### Solution C: Upgrade to Nx 22.5+ and Let Retry Logic Handle It -- PARTIAL

Nx 22.x includes all the fixes from PRs #33054, #33143, and #34533:

- Iterative retry with exponential backoff (25ms \* 2^n, max 12s, 20 retries)
- Stale WAL file cleanup
- Full-transaction retry on DatabaseBusy
- Lock file (`fs4` crate) serialization of `initialize_db`

**BUT**: `os error 32` (`ERROR_SHARING_VIOLATION`) is **not** the same as `DatabaseBusy` (code 5).
The retry logic catches `DatabaseBusy` specifically (see `connection.rs` line 27-29). An
`ERROR_SHARING_VIOLATION` from the OS would surface as a different error code -- likely
`CannotOpen` (code 14) or `SystemIoFailure` (code 522). The current retry logic may or may not
catch this variant.

**Confidence: MEDIUM** -- the retry improvements help but may not cover `os error 32` specifically.

### Solution D: Force DELETE Journal Mode -- NOT DIRECTLY POSSIBLE

There is no env var to force DELETE mode. The `is_known_incompatible_environment()` function only
checks for WSL1. However, if WAL initialization fails, the code falls back to DELETE automatically
after one retry cycle.

A theoretical approach: corrupt the WAL files so initialization fails and triggers the DELETE
fallback. This is fragile and not recommended.

### Solution E: Combine NX_DAEMON=false + NX_WORKSPACE_DATA_DIRECTORY -- BELT AND SUSPENDERS

```bash
NX_DAEMON=false \
NX_WORKSPACE_DATA_DIRECTORY=".repos/nx/.nx/workspace-data" \
npm exec nx -- build devkit
```

This is our most robust option:

- Daemon disabled: no persistent connections.
- Workspace data in the child repo's own directory: isolates from the host project's DB.
- The DB path is deterministic (not a temp dir), so cross-run caching works.

**Verdict:** Recommended for production use in the polyrepo-sync flow.

## 7. Diagnostic Procedure

If the error recurs, use this procedure to identify the exact cause:

```bash
# 1. Enable detailed Nx native logging
NX_NATIVE_FILE_LOGGING=nx::native::db=trace npm exec nx -- build devkit

# 2. Check the log file
cat .repos/nx/.nx/workspace-data/nx.log

# 3. While Nx is running, use Process Explorer to find who holds the DB file:
#    - Open Process Explorer (Ctrl+Shift+Esc -> File -> Run Process Explorer)
#    - Ctrl+F -> search for the .db filename
#    - Check if any exited/zombie processes still hold handles

# 4. Use handle.exe (Sysinternals) from command line:
handle.exe <db-filename>
```

## 8. Open Questions / Gaps

1. **Does Nx's Rust layer set `O_NOINHERIT` on SQLite file handles?** The `rusqlite` crate uses
   SQLite's C library which calls `CreateFile` with default flags. It is unclear whether
   `FILE_FLAG_NO_INHERIT` is set. This would be the definitive fix at the Nx level but would
   require changes in rusqlite or the SQLite C library itself.

2. **Does Node.js `child_process.fork()` inherit handles on Windows when `stdio` is set to
   `'pipe'`?** The Nx plugin worker system uses `fork()` for workers. If `bInheritHandles` is
   always TRUE in Node.js on Windows, even `'pipe'` stdio won't prevent SQLite handle leakage.

3. **Is there a ReFS-specific interaction?** No evidence found, but the combination has not been
   widely tested. If the issue occurs on NTFS but not ReFS (or vice versa), that would be
   significant.

4. **Will the Nx team add a `NX_DISABLE_DB` replacement?** Issue #32981 is open and a contributor
   (@HaasStefan) is actively requesting this. The Nx team's response (from @leosvelperez) suggests
   they prefer to fix the retry logic rather than provide an opt-out.

## Sources

### Nx GitHub Issues

- [#28424 - Parallel tasks fail with disk I/O error](https://github.com/nrwl/nx/issues/28424) (win32-x64)
- [#28608 - Multiple Nx instances: database locked](https://github.com/nrwl/nx/issues/28608)
- [#28640 - Unable to set journal_mode: CannotOpen](https://github.com/nrwl/nx/issues/28640) (high priority)
- [#28665 - DatabaseBusy on nx run-many](https://github.com/nrwl/nx/issues/28665)
- [#28772 - Database disk image malformed](https://github.com/nrwl/nx/issues/28772)
- [#30856 - Daemon crash: SQLite locking protocol](https://github.com/nrwl/nx/issues/30856) (WSL)
- [#32894 - Nx 21.6.2 disk I/O error](https://github.com/nrwl/nx/issues/32894)
- [#32981 - taskDetails logging opt-out](https://github.com/nrwl/nx/issues/32981) (OPEN)
- [#34442 - Plugin worker connection timeout on Windows](https://github.com/nrwl/nx/issues/34442)
- [#23224 - nx reset fails on Windows (file locked)](https://github.com/nrwl/nx/issues/23224)

### Nx Fix PRs

- [#28390 - Add busy handler for sqlite](https://github.com/nrwl/nx/pull/28390)
- [#28667 - Retry more db operations](https://github.com/nrwl/nx/pull/28667)
- [#33054 - Improve db connection init and error messages](https://github.com/nrwl/nx/pull/33054)
- [#33143 - Do not remove wal files manually](https://github.com/nrwl/nx/pull/33143)

### Nx Release Notes

- [Nx 22.0.0 release](https://newreleases.io/project/github/nrwl/nx/release/22.0.0) (NX_DISABLE_DB removed)

### Nx Documentation

- [Environment Variables](https://nx.dev/docs/reference/environment-variables)

### SQLite Documentation

- [File Locking And Concurrency in SQLite Version 3](https://sqlite.org/lockingv3.html)
- [Write-Ahead Logging](https://sqlite.org/wal.html)
- [How To Corrupt An SQLite Database File](https://sqlite.org/howtocorrupt.html)

### Windows / Handle Inheritance

- [CodiLime: Debugging faultily inherited file handles on Windows](https://codilime.com/blog/debugging-faultily-inherited-file-handles-on-microsoft-windows/)
- [Microsoft Learn: Handle Inheritance](https://learn.microsoft.com/en-us/windows/win32/sysinfo/handle-inheritance)
- [dotnet/runtime#19569 - Process should not inherit handles by default](https://github.com/dotnet/runtime/issues/19569)
- [rust-lang/rust#88924 - Windows CI runners failing with os error 32](https://github.com/rust-lang/rust/issues/88924)
- [rust-lang/rustup#4181 - os error 32 file in use on Windows](https://github.com/rust-lang/rustup/issues/4181)

### ReFS / Dev Drive

- [Windows Dev Drive / ReFS overview](https://windowsforum.com/threads/refs-on-windows-11-dev-drive-access-integrity-and-when-to-use.395360/)
- [WSL#12220 - Cannot access Dev Drive after 24H2 upgrade](https://github.com/microsoft/WSL/issues/12220)

### Nx Source Code (Verified)

- `packages/nx/src/utils/db-connection.ts` -- TypeScript DB connection wrapper
- `packages/nx/src/utils/cache-directory.ts` -- `NX_WORKSPACE_DATA_DIRECTORY` handling
- `packages/nx/src/native/db/mod.rs` -- `connect_to_nx_db` NAPI binding, lock file creation
- `packages/nx/src/native/db/connection.rs` -- `NxDbConnection` with retry macro (20 retries, exponential backoff)
- `packages/nx/src/native/db/initialize.rs` -- `initialize_db`, journal mode selection, WAL fallback
- `packages/nx/src/native/logger/mod.rs` -- `NX_NATIVE_LOGGING` and `NX_NATIVE_FILE_LOGGING` env vars
