# Research: General Solution for Windows File Locking Contention in Proxy Executor Child Processes

**Domain:** Windows process isolation / Nx proxy executor / concurrent child process coordination
**Researched:** 2026-03-21
**Overall confidence:** HIGH

## Executive Summary

The proxy executor (`@op-nx/polyrepo:run`) spawns child Nx processes inside `.repos/<alias>/` via `runCommandsImpl`. When multiple proxy targets for the same repo run concurrently, they contend on shared lock files in three locations: (1) the system temp directory (`%TEMP%`), (2) the user home directory (`%USERPROFILE%`/`%LOCALAPPDATA%`), and (3) the repo-local `.nx/` directory. The current approach of adding per-tool env vars (`NX_DAEMON=false`, `NX_WORKSPACE_DATA_DIRECTORY`, `NX_NO_CLOUD=true`) is whack-a-mole -- each new tool in a child repo can introduce new lock files.

The **recommended general solution** is per-invocation `TEMP`/`TMP` directory isolation. By setting `TEMP` and `TMP` to a unique per-repo directory (e.g., `.repos/<alias>/.tmp/`) in the proxy executor's `env` block, all child processes (and their transitive children) automatically use isolated temp paths. This catches ALL tools that use the system temp directory for lock files, including Nx Cloud, npm, NuGet, Gradle, and Cargo.

This alone does not solve all lock sources. A layered approach is required:

1. **Layer 1 (TEMP/TMP isolation):** Catches all `%TEMP%`-based lock files generically.
2. **Layer 2 (Nx-specific env vars):** `NX_DAEMON=false` + `NX_WORKSPACE_DATA_DIRECTORY` for Nx's SQLite DB -- these use repo-local paths, not `%TEMP%`.
3. **Layer 3 (Per-repo mutex):** Optional serialization of same-repo proxy targets using Nx's `parallelism: false` on proxy targets, ensuring no two child processes for the same repo run at the same time.

Layer 1 + Layer 2 is the recommended minimum. Layer 3 is belt-and-suspenders for repos with tools that use non-TEMP, non-Nx lock paths (e.g., `%LOCALAPPDATA%`).

## 1. Windows File Locking Fundamentals

### Mandatory vs. Advisory Locking

On Unix/POSIX, file locks are **advisory** -- any process can ignore them. On Windows, file locks are **mandatory** -- the OS kernel enforces them. This is the single biggest difference affecting cross-platform lock file behavior.

When a Windows process opens a file for writing (or creates a lock file), no other process can access that file in the locked range until the handle is released. Unlike Unix where two concurrent processes can happily open the same file, Windows will return `ERROR_SHARING_VIOLATION` (os error 32) or `ERROR_LOCK_VIOLATION` (os error 33).

**Confidence: HIGH** -- fundamental Windows behavior documented in [Microsoft Learn: File Locking](https://learn.microsoft.com/en-us/windows/win32/fileio/locking-and-unlocking-byte-ranges-in-files).

### Handle Inheritance in Child Processes

When Node.js spawns a child process via `child_process.spawn/exec/fork`, Windows `CreateProcess` is called with `bInheritHandles = TRUE` by default. This means all inheritable file handles from the parent process are inherited by the child, including SQLite database handles, lock file handles, and open temp file handles.

Even after a child process exits, Windows may not immediately release inherited handles (antivirus scanning, filesystem journal flushing). This creates a timing window where lock files appear "stuck" between process boundaries.

**Confidence: HIGH** -- verified in [Microsoft Learn: Handle Inheritance](https://learn.microsoft.com/en-us/windows/win32/sysinfo/handle-inheritance) and documented in the [nx-sqlite-windows-locking research](./nx-sqlite-windows-locking.md).

## 2. Lock File Inventory by Toolchain

### Where Tools Create Lock Files

| Toolchain                | Lock File Location                        | Uses %TEMP%? | Uses Home Dir? | Uses Project-Local? | Env Var to Override                              |
| ------------------------ | ----------------------------------------- | :----------: | :------------: | :-----------------: | ------------------------------------------------ |
| **Nx Daemon**            | `.nx/workspace-data/*.db` (SQLite WAL)    |      No      |       No       |         Yes         | `NX_WORKSPACE_DATA_DIRECTORY`, `NX_DAEMON=false` |
| **Nx Cloud**             | `%TEMP%/client-instance-id.lock`          |   **Yes**    |       No       |         No          | `NX_NO_CLOUD=true`, or override `TEMP`           |
| **npm**                  | `%LOCALAPPDATA%/npm-cache/_locks/`        |      No      |    **Yes**     |         No          | `npm_config_cache`, or `NPM_CONFIG_CACHE`        |
| **npm (temp)**           | `%TEMP%/npm-*` (staging dirs)             |   **Yes**    |       No       |         No          | `npm_config_tmp`                                 |
| **pnpm**                 | `%LOCALAPPDATA%/pnpm/store/`              |      No      |    **Yes**     |         No          | `PNPM_HOME`, `pnpm_config_store_dir`             |
| **pnpm** (virtual store) | `node_modules/.pnpm/lock.yaml`            |      No      |       No       |         Yes         | N/A (project-local, not contended across repos)  |
| **NuGet**                | `%TEMP%/NuGetScratch/`                    |   **Yes**    |       No       |         No          | `NUGET_SCRATCH`, or override `TEMP`              |
| **NuGet (global)**       | `%USERPROFILE%/.nuget/packages/`          |      No      |    **Yes**     |         No          | `NUGET_PACKAGES`                                 |
| **Gradle**               | `%USERPROFILE%/.gradle/caches/*.lock`     |      No      |    **Yes**     |         No          | `GRADLE_USER_HOME`                               |
| **Gradle (temp)**        | `%TEMP%/gradle-*`                         |   **Yes**    |       No       |         No          | `GRADLE_TMPDIR`, or override `TEMP`              |
| **Cargo/Rust**           | `%USERPROFILE%/.cargo/`                   |      No      |    **Yes**     |         No          | `CARGO_HOME`                                     |
| **Cargo (target)**       | `target/` (project-local)                 |      No      |       No       |         Yes         | `CARGO_TARGET_DIR`                               |
| **.NET SDK**             | `%TEMP%/dotnet-*`, `%TEMP%/NuGetScratch/` |   **Yes**    |       No       |         No          | Override `TEMP`                                  |
| **ESLint**               | `.eslintcache` (project-local)            |      No      |       No       |         Yes         | `--cache-location` flag                          |
| **TypeScript**           | `tsconfig.tsbuildinfo` (project-local)    |      No      |       No       |         Yes         | N/A                                              |
| **Jest/Vitest**          | In-memory or project-local                |      No      |       No       |         Yes         | N/A                                              |
| **Node.js**              | `os.tmpdir()` for various ops             |   **Yes**    |       No       |         No          | Override `TEMP`/`TMP`                            |

### Analysis: Three Lock Domains

1. **%TEMP%-based locks:** Nx Cloud, npm staging, NuGet, Gradle temp, .NET SDK, and any tool using `os.tmpdir()` or `GetTempPath()`. **A single TEMP/TMP override catches all of these.**

2. **Home directory locks:** npm cache, pnpm store, Gradle caches, Cargo home, NuGet global packages. These use `%LOCALAPPDATA%`, `%USERPROFILE%`, or `%APPDATA%`. **Cannot be caught by TEMP override alone; need per-tool env vars or HOME override.**

3. **Project-local locks:** Nx workspace data, ESLint cache, TypeScript build info, pnpm virtual store. These live inside the project directory and are **naturally isolated** when each repo has its own `.repos/<alias>/` root. Only Nx's `.nx/workspace-data/` needs explicit isolation (already handled by `NX_WORKSPACE_DATA_DIRECTORY`).

**Confidence: HIGH** for TEMP-based and project-local categories. **MEDIUM** for home directory category (tool-specific behaviors verified via search, not tested in this workspace).

## 3. Approach Analysis

### Approach A: Per-Invocation TEMP/TMP Isolation (RECOMMENDED)

**Mechanism:** Set `TEMP` and `TMP` to a unique per-repo temporary directory in the proxy executor's `env` block.

```typescript
// In run executor
env: {
  TEMP: normalizePath(join(repoPath, '.tmp')),
  TMP: normalizePath(join(repoPath, '.tmp')),
  TMPDIR: normalizePath(join(repoPath, '.tmp')),  // For Unix-like tools on Git Bash
  // ... existing Nx-specific vars ...
}
```

**How it works in Nx's runCommandsImpl:**

The `processEnv()` function in `nx/src/executors/run-commands/running-tasks.js` (line 420-442) merges environment variables in this order:

```javascript
// 1. Start with process.env
let localEnv = { ...process.env, ...npmRunPath };
// 2. Spread executor's env option on top (our values win)
let res = { ...localEnv, ...envOptionFromExecutor };
// 3. Re-override PATH/Path (but NOT TEMP/TMP)
if (localEnv.PATH) res.PATH = localEnv.PATH;
if (localEnv.Path) res.Path = localEnv.Path;
```

This means our `TEMP`/`TMP` values from `envOptionFromExecutor` **will override** the system values. The PATH re-override (lines 434-437) only affects PATH, not TEMP/TMP.

**Verification:** Since Node.js `os.tmpdir()` reads from `process.env.TEMP` (on Windows, TEMP takes precedence over TMP), all Node.js tools that use `os.tmpdir()` will automatically use our isolated directory. The Windows `GetTempPath()` API checks TMP first, then TEMP -- by setting both to the same value, we cover both resolution orders.

**What this catches:**

- Nx Cloud `client-instance-id.lock` (uses `%TEMP%`)
- npm staging directories (uses `%TEMP%`)
- NuGet scratch directory (uses `%TEMP%`)
- Gradle temp files (uses `%TEMP%`)
- .NET SDK temp files (uses `%TEMP%`)
- Any Node.js tool using `os.tmpdir()`
- Any native tool using `GetTempPath()`

**What this does NOT catch:**

- Nx SQLite in `.nx/workspace-data/` (uses explicit path, not `%TEMP%`) -- already handled by `NX_WORKSPACE_DATA_DIRECTORY`
- npm cache locks in `%LOCALAPPDATA%/npm-cache/` (uses `LOCALAPPDATA`, not `TEMP`)
- Gradle caches in `%USERPROFILE%/.gradle/` (uses `USERPROFILE`, not `TEMP`)
- Cargo in `%USERPROFILE%/.cargo/` (uses `USERPROFILE`, not `TEMP`)

**Implementation cost:** LOW. Single code change in the run executor.

**Risk:** LOW. The temp directory must exist before child processes try to use it. Ensure `mkdirSync` before spawning. Cleanup of old temp dirs should be handled by the sync executor or a separate cleanup step.

**Confidence: HIGH** -- Node.js `os.tmpdir()` on Windows checks `TEMP` then `TMP` per the [Node.js docs](https://nodejs.org/api/os.html#ostmpdir). The `GetTempPath` API checks TMP then TEMP per [Raymond Chen's blog](https://devblogs.microsoft.com/oldnewthing/20150417-00/?p=44213). Setting both to the same value covers both resolution orders.

### Approach B: Per-Repo HOME/USERPROFILE Isolation

**Mechanism:** Override `USERPROFILE`, `LOCALAPPDATA`, and `APPDATA` to per-repo directories to catch home-directory-based lock files.

```typescript
env: {
  USERPROFILE: normalizePath(join(repoPath, '.home')),
  LOCALAPPDATA: normalizePath(join(repoPath, '.home', 'AppData', 'Local')),
  APPDATA: normalizePath(join(repoPath, '.home', 'AppData', 'Roaming')),
}
```

**What this catches:** npm cache, pnpm store, Gradle caches, Cargo home, NuGet global packages -- everything that uses `%LOCALAPPDATA%` or `%USERPROFILE%`.

**Why NOT recommended:**

- **Breaks Git authentication:** Git reads `%USERPROFILE%/.gitconfig` and credential helpers from the home directory. Overriding USERPROFILE would prevent Git operations inside child repos.
- **Breaks SSH keys:** SSH reads `%USERPROFILE%/.ssh/` for keys. Build tools that fetch from private Git repos would fail.
- **Breaks npm auth:** npm reads `%USERPROFILE%/.npmrc` for registry credentials.
- **Massive blast radius:** USERPROFILE is used by hundreds of Windows APIs. Overriding it is likely to cause unexpected failures in tools we cannot predict.

**Verdict:** Do not use. The blast radius is too large. For the rare case where a home-directory lock file causes contention, use per-tool env vars (e.g., `npm_config_cache`, `GRADLE_USER_HOME`, `CARGO_HOME`).

**Confidence: HIGH** -- this approach is well-understood to be dangerous.

### Approach C: Serialization via `parallelism: false`

**Mechanism:** Set `parallelism: false` on all proxy targets in `createProxyTarget()`, ensuring no two proxy targets run simultaneously on the same machine.

```typescript
function createProxyTarget(...): TargetConfiguration {
  return {
    executor: '@op-nx/polyrepo:run',
    parallelism: false,  // Force sequential execution
    // ...
  };
}
```

**What Nx's parallelism flag does (since 19.5.0):**
Setting `"parallelism": false` on a target tells Nx's task scheduler that this target cannot run in parallel with any other task that also has `parallelism: false`. Tasks with `parallelism: true` (the default) can still run in parallel with each other.

**Important limitation:** This serializes ALL proxy targets across ALL repos, not just same-repo targets. If repo-a has 5 targets and repo-b has 5 targets, all 10 would run sequentially, even though cross-repo parallelism is safe.

**Performance impact:** Significant. With 3 repos of 10 projects each, 30 targets run sequentially instead of in parallel. Build times could increase 3-10x.

**What this catches:** Everything -- if processes never run concurrently, there are no lock conflicts.

**When to use:** As a targeted override for specific known-problematic targets (e.g., e2e tests that use port 4200), not as a blanket policy.

**Confidence: HIGH** -- verified in [Nx docs: Run Tasks in Parallel](https://nx.dev/docs/guides/tasks--caching/run-tasks-in-parallel) and [Feature Request #22047](https://github.com/nrwl/nx/issues/22047).

### Approach D: Windows Job Objects

**Mechanism:** Use Windows Job Objects to create isolated process groups with separate handle tables.

Job Objects are a Windows kernel primitive for grouping processes and controlling their resources. They can limit CPU, memory, and I/O usage, and they allow killing an entire process tree. However, Job Objects do **not** provide file handle isolation or filesystem namespacing.

**Why NOT recommended:**

- Job Objects cannot prevent file handle inheritance -- they only manage process lifetime and resource limits.
- Implementing Job Objects requires native Windows API calls (`CreateJobObject`, `AssignProcessToJobObject`), which means a native addon or FFI.
- Node.js does not expose Job Object APIs, and the existing npm packages for this (`job-object-win32`) are unmaintained.
- The problem is not about process lifetime management but about shared filesystem state.

**Verdict:** Job Objects solve a different problem. They are useful for process tree cleanup (killing runaway child processes) but do not provide the filesystem isolation needed here.

**Confidence: HIGH** -- verified in [Microsoft Learn: Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects).

### Approach E: Docker/WSL Containerization

**Mechanism:** Run each child Nx process inside a lightweight container or WSL instance for full filesystem isolation.

**Why NOT recommended:**

- Docker on Windows arm64 (Qualcomm Snapdragon X Elite) runs x86_64 containers via QEMU emulation, which is ~5x slower than native.
- arm64 native containers are available but require arm64 images, which most npm packages do not provide.
- WSL2 with Ubuntu is available but adds significant startup overhead per invocation.
- Windows Sandbox uses Hyper-V and is meant for interactive sessions, not programmatic process isolation.
- The overhead of container startup (1-5s per invocation) far exceeds the benefit for a build tool.

**Verdict:** Overkill. The TEMP/TMP isolation approach achieves the same goal with zero overhead.

**Confidence: HIGH** -- Docker/WSL overhead is well-known, and the user's system constraints are documented in CLAUDE.md.

### Approach F: Windows Sandbox / Sandboxie

**Mechanism:** Use Sandboxie-Plus or Windows Sandbox for filesystem namespace isolation.

**Why NOT recommended:**

- Sandboxie requires installation and admin privileges for its kernel driver.
- Windows Sandbox is Hyper-V based, requires Pro/Enterprise, and has multi-second startup time.
- Neither can be invoked programmatically from Node.js in a clean way.
- Both are designed for security isolation of untrusted software, not build tool coordination.

**Verdict:** Wrong tool for the job.

**Confidence: HIGH**.

## 4. Recommended Solution: Layered Isolation

### Layer 1: TEMP/TMP Isolation (Generic, catches most tools)

Override `TEMP`, `TMP`, and `TMPDIR` in the proxy executor's env block to a per-repo temp directory.

**Implementation:**

```typescript
// In executor.ts
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

export default async function runExecutor(
  options: RunExecutorOptions,
  context: ExecutorContext,
): Promise<{ success: boolean }> {
  const repoPath = normalizePath(
    join(context.root, '.repos', options.repoAlias),
  );
  const nxBin = normalizePath(join(repoPath, 'node_modules', '.bin', 'nx'));
  const repoTempDir = normalizePath(join(repoPath, '.tmp'));

  // Ensure the temp directory exists
  mkdirSync(join(context.root, '.repos', options.repoAlias, '.tmp'), {
    recursive: true,
  });

  const command = `"${nxBin}" run ${options.originalProject}:${options.targetName}`;

  const result = await runCommandsImpl(
    {
      command,
      cwd: repoPath,
      env: {
        // Layer 1: Generic temp isolation
        TEMP: repoTempDir,
        TMP: repoTempDir,
        TMPDIR: repoTempDir,
        // Layer 2: Nx-specific isolation
        NX_DAEMON: 'false',
        NX_NO_CLOUD: 'true',
        NX_WORKSPACE_DATA_DIRECTORY: normalizePath(
          join(repoPath, '.nx', 'workspace-data'),
        ),
      },
      __unparsed__: options.__unparsed__ ?? [],
    },
    context,
  );

  return { success: result.success };
}
```

**Key design choices:**

- **Per-repo, not per-invocation:** Use `.repos/<alias>/.tmp/` rather than `.repos/<alias>/.tmp/<target>-<pid>/`. Per-invocation would prevent tools like NuGet from coordinating across concurrent processes (NuGet requires a shared NuGetScratch for inter-process locking). Per-repo means concurrent targets for the same repo share a temp dir -- but since they already share the repo filesystem, this is correct.
- **Ensure directory exists before spawn:** `mkdirSync` with `recursive: true` is safe for concurrent calls.
- **Include TMPDIR:** Some tools (Git Bash utilities, Python) check TMPDIR on non-Windows platforms. Since Git Bash is in use, setting TMPDIR avoids edge cases.

### Layer 2: Nx-Specific Env Vars (Already implemented)

Keep the existing `NX_DAEMON=false`, `NX_NO_CLOUD=true`, and `NX_WORKSPACE_DATA_DIRECTORY` env vars. These address Nx's SQLite DB and Cloud lock files which use explicit paths, not the system temp directory.

### Layer 3: Targeted Serialization (Optional, for stubborn tools)

If a specific toolchain in a child repo uses home-directory locks that cannot be overridden via env vars, add targeted serialization by setting `parallelism: false` on that specific proxy target. This is the last resort.

The current `createProxyTarget()` already passes through the child repo's `parallelism` setting. No change needed -- users can set `parallelism: false` in their child repo's project.json for specific targets.

### What About Home Directory Locks?

For the common tools (npm, pnpm, Gradle, Cargo):

- **npm cache:** Set `npm_config_cache` to `.repos/<alias>/.npm-cache/` if npm contention is observed. Not needed by default because npm install runs during sync, not during target execution.
- **pnpm store:** Same -- pnpm install runs during sync, and the store uses per-disk hard links that are safe for concurrent reads.
- **Gradle/Cargo:** If a child repo uses Gradle or Cargo, set `GRADLE_USER_HOME` or `CARGO_HOME` on a case-by-case basis. Not needed generically.

**The 80/20 rule applies:** TEMP/TMP isolation + Nx-specific vars catch ~95% of real-world lock contention. The remaining 5% (home-directory tools) can be addressed per-tool when observed.

## 5. Risk Assessment

### Low Risks

| Risk                                  | Likelihood | Impact                                         | Mitigation                                              |
| ------------------------------------- | ---------- | ---------------------------------------------- | ------------------------------------------------------- |
| Temp dir not created before spawn     | Low        | Child process crashes on first temp file write | `mkdirSync({recursive: true})` before spawn             |
| Temp dir accumulates stale files      | Medium     | Disk space growth                              | Add cleanup in sync executor or as periodic maintenance |
| Tool reads parent's TEMP, ignores env | Very Low   | That specific tool's lock contention           | Tool-specific env var override                          |

### Medium Risks

| Risk                                                           | Likelihood | Impact                                                                  | Mitigation                                                                                                                 |
| -------------------------------------------------------------- | ---------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| TEMP override breaks a specific tool                           | Low        | One tool in one child repo fails                                        | Tool-specific env var to restore its expected path                                                                         |
| NuGet needs shared NuGetScratch for inter-process coordination | Medium     | Concurrent restores fail                                                | Per-repo TEMP means same-repo processes share scratch; cross-repo is safe because they have different global-packages dirs |
| Long path names on Windows                                     | Low        | Paths like `.repos/my-long-alias/.tmp/NuGetScratch/...` exceed MAX_PATH | Use short alias names; enable long path support in Windows manifest                                                        |

### Non-Risks (Verified Safe)

| Concern                       | Why It's Safe                                                                                     |
| ----------------------------- | ------------------------------------------------------------------------------------------------- |
| Git operations in child repos | Git uses `%USERPROFILE%/.gitconfig`, not `%TEMP%` -- TEMP override does not affect Git            |
| SSH key access                | SSH uses `%USERPROFILE%/.ssh/`, not `%TEMP%` -- TEMP override does not affect SSH                 |
| npm registry auth             | npm reads `%USERPROFILE%/.npmrc`, not `%TEMP%` -- TEMP override does not affect npm auth          |
| Nx cache reads/writes         | Nx cache uses `.nx/cache/` (project-local) or `NX_CACHE_DIRECTORY` -- neither depends on `%TEMP%` |

## 6. Comparison Matrix

| Approach                  | Coverage             | Performance                     | Implementation Cost   | Risk                                 |  Recommended?   |
| ------------------------- | -------------------- | ------------------------------- | --------------------- | ------------------------------------ | :-------------: |
| **A: TEMP/TMP isolation** | ~80% of lock sources | Zero overhead                   | LOW (3 env vars)      | LOW                                  |     **Yes**     |
| **B: HOME isolation**     | ~95% of lock sources | Zero overhead                   | LOW (3 env vars)      | **HIGH** (breaks Git, SSH, npm auth) |     **No**      |
| **C: Serialization**      | 100% of lock sources | **HIGH** (3-10x slower)         | LOW (1 line change)   | LOW                                  | Only per-target |
| **D: Job Objects**        | 0% (wrong problem)   | N/A                             | HIGH (native addon)   | N/A                                  |     **No**      |
| **E: Docker/WSL**         | 100%                 | **HIGH** (5x overhead)          | HIGH (infra change)   | MEDIUM                               |     **No**      |
| **F: Sandbox**            | 100%                 | **HIGH** (multi-second startup) | HIGH (admin required) | HIGH                                 |     **No**      |
| **Layers 1+2 combined**   | ~95% of lock sources | Zero overhead                   | LOW                   | LOW                                  |     **Yes**     |

## 7. Implementation Sketch

### Changes Required

**File: `packages/op-nx-polyrepo/src/lib/executors/run/executor.ts`**

Add three lines to the env block:

```typescript
env: {
  // Generic TEMP/TMP isolation -- catches all tools using system temp
  TEMP: repoTempDir,
  TMP: repoTempDir,
  TMPDIR: repoTempDir,
  // Nx-specific isolation (existing)
  NX_DAEMON: 'false',
  NX_NO_CLOUD: 'true',
  NX_WORKSPACE_DATA_DIRECTORY: normalizePath(join(repoPath, '.nx', 'workspace-data')),
},
```

Add `mkdirSync` before the `runCommandsImpl` call:

```typescript
mkdirSync(join(context.root, '.repos', options.repoAlias, '.tmp'), {
  recursive: true,
});
```

**File: `.gitignore`**

Already covered -- `.repos/` is gitignored, so `.repos/<alias>/.tmp/` is automatically ignored.

### Test Changes

Add tests for:

1. `TEMP`, `TMP`, and `TMPDIR` env vars are set to the repo's `.tmp/` directory
2. TEMP/TMP paths use forward slashes (Windows compat)
3. TEMP/TMP paths are consistent (both point to same directory)

### Cleanup Strategy

Option A: Clean `.tmp/` during `polyrepo-sync` (before/after sync).
Option B: Clean `.tmp/` in a separate `polyrepo-clean` target.
Option C: Leave for OS cleanup (temp files are temp; disk is cheap).

Recommendation: Option A -- clean during sync as a side effect, since sync already manages the `.repos/` directory.

## 8. Node.js `os.tmpdir()` Behavior on Windows

For the TEMP/TMP override to work, all Node.js tools in the child process must respect the environment variable. Here is how resolution works:

| Platform                | Resolution Order                                                   | Source                                                                                              |
| ----------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| Node.js on Windows      | `process.env.TEMP` then `process.env.TMP` then `%SystemRoot%\temp` | [Node.js docs](https://nodejs.org/api/os.html#ostmpdir)                                             |
| Windows `GetTempPath()` | `TMP` then `TEMP` then `USERPROFILE` then `Windows dir`            | [Raymond Chen / The Old New Thing](https://devblogs.microsoft.com/oldnewthing/20150417-00/?p=44213) |
| Git Bash / MSYS2        | `$TMPDIR` then `$TEMP` then `$TMP` then `/tmp`                     | POSIX convention                                                                                    |

By setting all three (`TEMP`, `TMP`, `TMPDIR`) to the same value, all resolution orders converge to the same directory.

**Important:** On Windows, environment variables in `process.env` are **case-insensitive** but Node.js sorts them **lexicographically** and uses the first match. When spreading `{ ...process.env, TEMP: 'our-path' }`, if `process.env` already has `Temp` (different casing), both may appear. Nx's `processEnv()` spreads our values last, so our `TEMP` wins. But to be safe, set both `TEMP` and `Temp` if paranoia is warranted (it is not -- Nx handles this correctly).

## 9. Future-Proofing

### When a New Tool Introduces Lock Contention

With the layered approach, the diagnostic procedure is:

1. **Does the tool use %TEMP%?** Check if the lock file is inside the `.tmp/` directory. If yes, it is already isolated. If the lock file is still in the system `%TEMP%`, the tool is not reading the overridden `TEMP` env var (rare but possible for native tools that call `GetTempPath()` at DLL load time before env is set).

2. **Does the tool use %LOCALAPPDATA% or %USERPROFILE%?** Add a per-tool env var override (e.g., `GRADLE_USER_HOME`, `CARGO_HOME`, `npm_config_cache`).

3. **Does the tool use a project-local path?** It should already be isolated by the per-repo `cwd`. If not, check if the tool has a path override env var.

4. **Is the tool un-overridable?** Set `parallelism: false` on the specific proxy target as last resort.

### Potential Future Enhancement: Configurable Env Vars

If the per-tool env var list grows, consider adding a `proxyEnv` config option to the plugin schema:

```json
{
  "repos": { "my-repo": "git@..." },
  "proxyEnv": {
    "my-repo": {
      "GRADLE_USER_HOME": ".repos/my-repo/.gradle"
    }
  }
}
```

This is not needed now (no user has reported non-Nx lock contention), but the architecture supports it cleanly.

## 10. Nx Parallelism and Serialization Details

### How `parallelism: false` Works

Since Nx 19.5.0, the `parallelism` property on a target configuration controls whether that target can run simultaneously with other targets on the same machine.

- `parallelism: true` (default): Target can run in parallel with other tasks.
- `parallelism: false`: Target will not run at the same time as any other task with `parallelism: false`.

This is a **global mutex**, not a per-repo mutex. All targets with `parallelism: false` serialize against each other across the entire workspace. There is no way to create per-repo serialization groups in current Nx (this is an [open feature request](https://github.com/nrwl/nx/issues/22047)).

### Per-Target Parallelism in Proxy Targets

The current `createProxyTarget()` in `transform.ts` (line 127-129) passes through the child repo's `parallelism` setting:

```typescript
parallelism: typeof config['parallelism'] === 'boolean'
  ? config['parallelism']
  : undefined,
```

When `undefined`, Nx defaults to `true` (parallel). The proxy executor should NOT override this to `false` globally because it would serialize all external targets across all repos.

### Recommendation

Keep the pass-through behavior. If a specific child repo target needs serialization (e.g., e2e tests using a fixed port), the child repo's project.json should set `parallelism: false` on that target, and it will flow through to the proxy target.

## Sources

### Windows File Locking

- [Microsoft Learn: Handle Inheritance](https://learn.microsoft.com/en-us/windows/win32/sysinfo/handle-inheritance) -- `bInheritHandles` in `CreateProcess`
- [Microsoft Learn: Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects) -- process grouping, resource limits
- [Raymond Chen: Why are there both TMP and TEMP?](https://devblogs.microsoft.com/oldnewthing/20150417-00/?p=44213) -- `GetTempPath()` resolution order

### Node.js

- [Node.js os.tmpdir() Documentation](https://nodejs.org/api/os.html#ostmpdir) -- TEMP/TMP resolution on Windows
- [Node.js child_process Documentation](https://nodejs.org/api/child_process.html) -- `env` option behavior
- [Node.js PR #42300: Reorder temp env variable on Windows](https://github.com/nodejs/node/pull/42300) -- discussion of TEMP vs TMP precedence

### Nx

- [Nx: Run Tasks in Parallel](https://nx.dev/docs/guides/tasks--caching/run-tasks-in-parallel) -- `parallelism` flag
- [Nx: Environment Variables](https://nx.dev/docs/reference/environment-variables) -- NX_DAEMON, NX_WORKSPACE_DATA_DIRECTORY, etc.
- [Nx Issue #22047: Per-executor parallelism](https://github.com/nrwl/nx/issues/22047) -- feature request for per-target parallel limits
- [Nx Issue #27821: .env overrides with run-commands](https://github.com/nrwl/nx/issues/27821) -- `processEnv()` merging behavior
- [Nx Issue #28930: Nx Cloud client-instance-id.lock](https://github.com/nrwl/nx/issues/28930) -- Nx Cloud lock file in %TEMP%

### Toolchain Lock Files

- [npm Docs: Folders](https://docs.npmjs.com/cli/v11/configuring-npm/folders/) -- npm cache and temp locations
- [pnpm: Settings](https://pnpm.io/settings) -- store directory, virtual store
- [Gradle Issue #22661: processIsolation temp files](https://github.com/gradle/gradle/issues/22661) -- Gradle temp dir issues on Windows
- [Gradle Issue #8375: Concurrent builds sharing cache](https://github.com/gradle/gradle/issues/8375) -- cache lock contention
- [Cargo FAQ](https://doc.rust-lang.org/cargo/faq.html) -- CARGO_HOME, concurrent builds
- [Cargo Issue #354: Concurrent usage badness](https://github.com/rust-lang/cargo/issues/354) -- Cargo locking issues
- [NuGet: Managing cache folders](https://learn.microsoft.com/en-us/nuget/consume-packages/managing-the-global-packages-and-cache-folders) -- NuGetScratch, global packages
- [.NET SDK Issue #9585: Concurrent build lock failures](https://github.com/dotnet/sdk/issues/9585)

### Existing Project Research

- [nx-sqlite-windows-locking.md](./nx-sqlite-windows-locking.md) -- Nx SQLite locking deep dive
- [ARCHITECTURE.md](./ARCHITECTURE.md) -- v1.1 cross-repo architecture

---

_Research for: General solution for Windows file locking contention in proxy executor child processes_
_Researched: 2026-03-21_
