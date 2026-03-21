# Pitfalls Research

**Domain:** Static dependency edges, proxy target caching, and temp directory rename for Nx polyrepo plugin (v1.2)
**Researched:** 2026-03-22
**Confidence:** HIGH (verified against Nx 22.5.4 source in node_modules, open GitHub issues, and existing plugin source)

## Critical Pitfalls

### Pitfall 1: Static edges require sourceFile -- but .repos/ files are not in Nx's fileMap

**What goes wrong:**
Changing `DependencyType.implicit` to `DependencyType.static` triggers Nx's `validateStaticDependency` function, which throws `"Source project file is required"` when `sourceFile` is missing and the source project exists in `context.projects`. This is not a soft warning -- it is a hard throw that crashes the entire graph construction. Every `nx` command fails.

Verified in `node_modules/nx/src/project-graph/project-graph-builder.js`:
```javascript
function validateStaticDependency(d, { projects }) {
    if (projects[d.source] && !d.sourceFile) {
        throw new Error(`Source project file is required`);
    }
}
```

**Why it happens:**
The current code emits edges with no `sourceFile` property because `.repos/` is gitignored. The comment at line 382 of `detect.ts` explicitly says: "Nx validates sourceFile against its file map for static edges -- .repos/ files are not in the file map (gitignored)." Switching to `DependencyType.static` without providing `sourceFile` triggers the validation throw.

**How to avoid:**
Every static edge MUST include a `sourceFile` property. Two categories:

1. **Host-sourced edges** (host project depends on external): `sourceFile` is the host project's `package.json` path (e.g., `apps/host-app/package.json`). This file IS in the fileMap because it's not gitignored. This is the same pattern Nx's own JS plugin uses in `explicit-package-json-dependencies.js`.

2. **External-sourced edges** (external project depends on another project): `sourceFile` should point to the external project's `package.json` path (e.g., `.repos/repo-a/apps/my-app/package.json`). This file is NOT in the fileMap because `.repos/` is gitignored. The `validateStaticDependency` only requires `sourceFile` to be present (truthy string), not to exist in the fileMap. However, if Nx later uses `getFileData()` to resolve the file for hashing, it will throw `"Source file does not exist in the workspace"`.

**The safe approach:** Use `DependencyType.static` + `sourceFile` only for host-sourced edges (where the package.json is in the fileMap). Keep `DependencyType.implicit` for external-sourced edges (where the package.json is in `.repos/`). This is a **split strategy**, not a blanket migration.

**Warning signs:**
- `nx graph` crashes with "Source project file is required" immediately after switching to static
- If sourceFile is provided but not in fileMap: "Source file does not exist in the workspace" during task hashing
- All Nx commands fail, not just graph -- the error occurs during graph construction which gates everything

**Phase to address:**
Phase 1 (static edge migration) -- must be the FIRST thing validated. Write a test that calls `validateDependency` from `@nx/devkit` on the emitted edges to catch this at unit test time.

---

### Pitfall 2: Nx daemon caches runtime input command results -- proxy cache may never invalidate

**What goes wrong:**
Setting `cache: true` with `inputs: [{ runtime: "git -C .repos/nx rev-parse HEAD" }]` appears correct but the Nx daemon caches the result of runtime input commands and does not re-execute them on subsequent invocations. The proxy target returns a cache hit even after `polyrepo-sync` changes HEAD. This is a confirmed bug: [nrwl/nx#30170](https://github.com/nrwl/nx/issues/30170) (OPEN, Nx 20.0.3+, confirmed still occurring in December 2025). The daemon process persists the hash of the runtime command's output and reuses it until the daemon restarts.

**Why it happens:**
The Nx native task hasher (Rust) computes runtime input hashes once per daemon session. When `NX_DAEMON=true` (default), the daemon process keeps the hash plan in memory. Subsequent task hash computations reuse the cached plan without re-executing the runtime command. This is by design for tool versions (`node --version`) that don't change within a session, but it's broken for git-based inputs that change when users run `polyrepo-sync`.

**How to avoid:**
Three mitigation strategies, ordered by preference:

1. **Env input instead of runtime input:** Use `{ env: "POLYREPO_CACHE_BUST" }` set by the sync executor to a timestamp or hash. The sync executor writes a marker file (e.g., `.repos/<alias>/.polyrepo-sync-hash`) with the new HEAD SHA after sync. The proxy target uses a runtime input reading that file: `{ runtime: "cat .repos/<alias>/.polyrepo-sync-hash" }`. This is still vulnerable to daemon caching.

2. **File-based inputs instead of runtime:** Use `{ fileset: ".repos/<alias>/.polyrepo-sync-hash" }` where the sync executor writes the HEAD SHA. File-based inputs bypass the runtime caching issue because Nx's file watcher detects file changes natively. But `.repos/` is gitignored, and gitignored files are excluded from Nx's file scanning. So this approach also fails.

3. **Write a marker file OUTSIDE .repos/:** After sync, write a per-repo marker file to an un-gitignored location (e.g., `tmp/polyrepo-cache/<alias>.hash`). Use `{ fileset: "tmp/polyrepo-cache/<alias>.hash" }` as the input. This file IS visible to Nx's file watcher because `tmp/` inside a project root is not the same as the gitignored `tmp` in the workspace root. But marker files in project roots may not map correctly.

4. **Accept NX_DAEMON=false as a workaround:** Document that users needing cache correctness should set `NX_DAEMON=false`. This bypasses the daemon caching issue entirely. Reported as the working workaround in issue #30170.

**Recommended approach:** Implement runtime inputs as designed (compound `HEAD + diff`) but acknowledge the daemon bug. Document the `NX_DAEMON=false` workaround prominently. Additionally, have the sync executor call `nx reset` after sync to clear the daemon's cached hash plans -- this forces the daemon to restart and re-execute runtime commands. The `nx reset` approach is the most practical mitigation.

**Warning signs:**
- Proxy targets report "existing outputs match the cache" even after `polyrepo-sync` pulled new changes
- `nx run repo-a/lib:build --skip-nx-cache` succeeds but `nx run repo-a/lib:build` returns stale output
- Behavior differs between `NX_DAEMON=false` and `NX_DAEMON=true`
- `nx reset` followed by the command produces correct results

**Phase to address:**
Phase 2 (proxy caching) -- must validate with both daemon on and off. Include a smoke test in the e2e suite.

---

### Pitfall 3: Synthetic sourceFile paths that don't match fileMap entries cause silent hash failures

**What goes wrong:**
When a static edge has a `sourceFile` value like `.repos/repo-a/apps/my-app/package.json`, Nx's task hasher attempts to look up this file in the `projectFileMap` to compute file-level hashes for `nx affected` and cache computation. Since `.repos/` files are not in the fileMap (gitignored), the lookup fails. In the `getFileData()` function, if the file is not found in `projectFileMap`, Nx falls back to `nonProjectFiles`. If not found there either, it throws: `"Source file does not exist in the workspace."` This crash happens not during graph construction but during task hashing -- a different and harder-to-debug failure mode.

Verified in `node_modules/nx/src/project-graph/project-graph-builder.js`:
```javascript
function getNonProjectFileData(sourceFile, files) {
    const fileData = files.find((f) => f.file === sourceFile);
    if (!fileData) {
        throw new Error(`Source file "${sourceFile}" does not exist in the workspace.`);
    }
    return fileData;
}
```

**Why it happens:**
The `validateStaticDependency` function only checks that `sourceFile` is truthy -- it does not validate the file exists in the fileMap. The crash occurs later when the task hasher tries to use the sourceFile for computing affected status or cache keys. This temporal gap between validation-passes and runtime-crashes is the trap.

**How to avoid:**
For edges where the source project is an external project (root starts with `.repos/`), there are two safe strategies:

1. **Keep external-sourced edges as implicit:** The simplest approach. External-to-anything edges use `DependencyType.implicit` (no sourceFile needed). Only host-to-external edges use `DependencyType.static` with `sourceFile` pointing to the host project's package.json (which IS in the fileMap).

2. **Override namedInputs to prevent file lookup:** The existing `externalNamedInputs` override (all namedInputs set to `[]`) already prevents the task hasher from expanding file-based patterns against external projects. But `sourceFile` lookups in the dependency graph builder are separate from namedInputs expansion -- the hasher may still try to resolve sourceFile for `nx affected` calculations.

**Strategy 1 is safer.** The split approach (static for host-sourced, implicit for external-sourced) avoids the fileMap issue entirely while still gaining static edge benefits for host projects.

**Warning signs:**
- `nx affected` crashes with "Source file does not exist in the workspace" mentioning a `.repos/` path
- `nx build host-app` crashes during hash computation but `nx graph` succeeds (graph construction vs. task hashing are separate)
- The crash is intermittent -- it only triggers when `nx affected` or the task hasher walks an edge to/from an external project with a synthetic sourceFile

**Phase to address:**
Phase 1 (static edge migration) -- must be validated with both `nx graph` and `nx affected` / `nx build` commands. Unit tests alone will not catch this because they don't invoke the native task hasher.

---

### Pitfall 4: Runtime input commands that fail silently produce constant hash -- permanent cache hit

**What goes wrong:**
If the runtime input command fails (non-zero exit, stderr only, or empty stdout), the Nx hasher receives an empty string or error output. Since the failure output is consistent across runs, the hash is constant. The proxy target becomes permanently cached: it never re-runs because the hash never changes. The user sees "success" from the cache but actual builds may be stale.

Specific failure modes for `git -C .repos/<alias> rev-parse HEAD`:
- `.repos/<alias>` does not exist yet (repo not synced): git error, empty stdout
- `.repos/<alias>/.git` is corrupt: git error
- `git` is not on PATH (unlikely but possible in CI): command not found
- Compound command `git -C ... rev-parse HEAD && git -C ... diff HEAD` -- if the first part fails, the second part never runs, but `&&` chains produce exit code 1 which may result in empty hash

**Why it happens:**
Nx runtime inputs execute via shell and capture stdout. If the command fails, stdout may be empty or contain error text. The hasher hashes whatever it gets. Empty string hashes to a constant. If the error message is deterministic (e.g., "fatal: not a git repository"), it also hashes to a constant. In both cases, the hash never changes between runs, so cache always hits.

**How to avoid:**
1. **Guard the runtime command:** Use a shell construct that produces a unique-per-invocation output on failure: `git -C .repos/<alias> rev-parse HEAD 2>/dev/null || echo "NO_CACHE_$(date +%s)"`. On failure, the timestamp makes the hash unique, forcing a cache miss. Cross-platform concern: `date +%s` works on Linux/macOS/Git-Bash-on-Windows but not PowerShell.
2. **Pre-validate:** Check that `.repos/<alias>/.git` exists before setting `cache: true`. If the repo is not synced, set `cache: false` (the current default). This requires dynamic target generation in `createNodesV2` based on repo sync state.
3. **Use the existing namedInputs override pattern:** External projects already have all namedInputs set to `[]`. The runtime input is only needed on proxy targets. If the proxy target executor already checks sync state and returns `{ success: false }` for unsynced repos, the permanent-cache-hit is actually harmless because the cached result is a failure.

**Recommended:** Option 1 (fallback echo on failure) plus option 2 (skip cache for unsynced repos) as defense in depth.

**Warning signs:**
- Proxy targets for repos not yet synced report cache hits with "success"
- After a `git` corruption event, proxy targets remain cached on stale results
- `nx run-many --all --target=build` succeeds suspiciously fast despite `.repos/` being empty

**Phase to address:**
Phase 2 (proxy caching) -- runtime input design must account for failure modes before enabling `cache: true`.

---

### Pitfall 5: Compound runtime input using `&&` produces platform-dependent behavior

**What goes wrong:**
The proposed compound input `git -C .repos/<alias> rev-parse HEAD && git -C .repos/<alias> diff HEAD` uses shell `&&` chaining. This works on bash/zsh but has subtle differences:
- On Windows with Git Bash (used by Nx on Windows): works, but `diff HEAD` output includes Windows line endings (`\r\n`) vs. Unix (`\n`), producing different hashes for the same content across platforms. This breaks remote cache sharing.
- Shell escaping: the runtime command string is passed to the platform shell. On Windows, `cmd.exe` interprets `&&` differently than bash. Nx uses `child_process.exec` which uses `cmd.exe` on Windows unless `shell` is set.
- Output encoding: `git diff` output can contain binary data (for binary files), which may cause encoding issues.

**Why it happens:**
Nx executes runtime inputs via the shell. The default shell on Windows is `cmd.exe`, which handles `&&` but may have different escaping rules. The runtime input command string is not sanitized or normalized by Nx.

**How to avoid:**
1. **Single git command:** Instead of chaining `&&`, use `git -C .repos/<alias> describe --always --dirty`. This produces a single output that changes on both HEAD changes and dirty working tree. It's a single command, no chaining.
2. **Hash file approach:** Write a composite hash to a file in the sync executor, read it as a runtime input: `{ runtime: "cat .repos/<alias>/.polyrepo-sync-hash" }`. But `cat` may not exist on Windows `cmd.exe` (it does in Git Bash). Use `type` instead, or use `node -e "..."` for cross-platform.
3. **Normalize line endings:** If using `git diff`, pipe through `tr -d '\\r'` to strip carriage returns. This adds another shell dependency.

**Recommended:** Use `git -C .repos/<alias> describe --always --dirty` as the runtime input. It's a single cross-platform command that captures both commit identity and dirty state. Falls back gracefully (the `--always` flag ensures output even without tags). If the working tree is dirty, appends `-dirty` to the output, changing the hash.

**Warning signs:**
- Cache hits on one platform but misses on another for the same repo state
- `nx affected` gives different results on CI (Linux) vs. local (Windows)
- Runtime input output contains `\r\n` on Windows, `\n` on Linux -- visible when debugging with `NX_VERBOSE_LOGGING=true`

**Phase to address:**
Phase 2 (proxy caching) -- must be validated on both Windows and Linux (CI).

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Use `DependencyType.static` for ALL edges (including external-sourced) | Uniform edge type, simpler code | fileMap crashes for `.repos/` paths during task hashing | Never -- split strategy required |
| Skip compound input, use only `git rev-parse HEAD` | Simpler runtime command, fewer failure modes | Misses user edits in `.repos/` -- cache serves stale results for uncommitted changes | MVP only -- document the limitation, plan compound input for v1.3 |
| Hardcode `cache: true` on all proxy targets | Every proxy target benefits from caching | Unsynced repos produce permanent cache hits on failure | Never -- check sync state or use the fallback-echo pattern |
| Rename `.tmp` to `tmp` without checking child repo `.gitignore` | Quick one-line fix | If a child repo does NOT have `tmp/` in its `.gitignore`, the temp dir gets committed to the child repo's git history | Never -- verify or explicitly add `tmp/` to `.repos/<alias>/.gitignore` patterns |
| Ignore daemon caching bug for runtime inputs | Ship faster | Users with `NX_DAEMON=true` (default) get stale cache hits | MVP only -- document workaround, plan sync-executor cache-bust for next version |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| `validateDependency` | Assuming it only checks types | It also calls `validateStaticDependency` which THROWS on missing sourceFile for internal nodes. Call it in unit tests on every emitted edge. |
| `projectFileMap` / `nonProjectFiles` | Assuming sourceFile just needs to be a string | The task hasher resolves sourceFile against fileMap. If the file is not in either projectFileMap or nonProjectFiles, it throws during hashing (not during graph construction). |
| `externalNamedInputs` override | Assuming it prevents ALL file-based lookups | It prevents `^production`-style expansion but NOT sourceFile resolution in dependency edges. These are separate code paths. |
| Runtime inputs under daemon | Assuming runtime commands re-execute on each `nx run` | The daemon caches hash plans including runtime input results. Commands are not re-executed until daemon restarts. Use `nx reset` after sync. |
| `git -C` path argument | Using backslash paths on Windows | `git -C .repos\nx` fails on some Windows git builds. Always use forward slashes in the runtime command string: `git -C .repos/nx`. |
| `runCommandsImpl` env override | Assuming `env: { ... }` merges with `process.env` | In the run executor, `env` REPLACES the entire environment. If the runtime input command needs PATH to find `git`, it may fail. The current extract.ts correctly does `{ ...process.env, TEMP: ... }` but the run executor does NOT spread `process.env`. |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Runtime input executed for EVERY proxy target in task graph | 50 proxy targets x ~12ms per git command = 600ms overhead on every `nx run-many` | Use a single named input or workspace-level sharedGlobals so the command runs once | 50+ proxy targets |
| `git diff HEAD` on large repos with many changes | Produces megabytes of output that must be hashed | Use `git diff HEAD --stat` (summary only) or `git describe --always --dirty` (single line) | Repos with 100+ changed files |
| `cache: true` without outputs causes Nx to cache terminal output only | Correct behavior, but Nx stores the full terminal output blob in `.nx/cache/` per run | Set reasonable `outputs` or accept the storage cost | High-frequency proxy target runs filling cache |
| File-based cache busting marker written on every sync | Triggers file watcher, which triggers full graph recomputation | Write marker file only when HEAD actually changes (compare before/after) | Frequent `polyrepo-sync` runs in dev loop |

## "Looks Done But Isn't" Checklist

- [ ] **Static edges:** Edge type changed to `DependencyType.static` -- verify `sourceFile` is set on EVERY static edge (not just some)
- [ ] **Static edges:** Host-sourced edges work -- verify `sourceFile` path exists in `context.fileMap.projectFileMap[sourceName]` for the host project
- [ ] **Static edges:** External-sourced edges kept as implicit -- verify edges where source root starts with `.repos/` use `DependencyType.implicit`
- [ ] **Static edges:** `validateDependency` called in tests -- verify unit tests actually invoke Nx's validator, not just check the type enum
- [ ] **Proxy caching:** Runtime input produces different output after sync -- verify with `NX_DAEMON=false` first, then `NX_DAEMON=true`
- [ ] **Proxy caching:** Runtime input produces correct output on Windows -- verify `git -C .repos/alias ...` works on Windows with forward slashes
- [ ] **Proxy caching:** Failed runtime command does not produce constant hash -- verify the fallback-echo or guard pattern is in place
- [ ] **Proxy caching:** Unsynced repo proxy targets are not cached on "success" -- verify `cache: true` is only set when repo is synced, or that failure result is correctly cached
- [ ] **Temp rename:** Child repos with default Nx `.gitignore` already ignore `tmp/` -- verify by checking scaffold `.gitignore` from `create-nx-workspace`
- [ ] **Temp rename:** Existing `.tmp` directories in `.repos/` are cleaned up -- verify migration path (or document that old `.tmp` dirs become orphaned)
- [ ] **Temp rename:** The `tmp` directory does not collide with any Nx-internal usage -- verify Nx does not write to project-root `tmp/`

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Static edge missing sourceFile (graph crash) | LOW | Revert edge type to implicit for affected edges; no data loss, just performance regression |
| Static edge sourceFile not in fileMap (hash crash) | LOW | Switch affected edges to implicit type; or add sourceFile to nonProjectFiles workaround |
| Daemon caching stale runtime inputs | LOW | Run `nx reset` to restart daemon; document in troubleshooting guide |
| Permanent cache hit from failed runtime command | LOW | Run `nx reset` followed by `--skip-nx-cache` once; fix the runtime command guard |
| Cross-platform hash mismatch from line endings | MEDIUM | Normalize runtime command output; invalidate remote cache entries (if shared cache is in use) |
| Temp dir rename breaks child repo | LOW | Rename back to `.tmp`; or add `tmp/` to child repo `.gitignore` |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| Static edge sourceFile requirement | Phase 1 (static edges) | Unit test: call `validateDependency` from `@nx/devkit` on every emitted edge; expect no throws |
| Split strategy (static vs implicit by source) | Phase 1 (static edges) | Unit test: host-sourced edges are `DependencyType.static` with valid sourceFile; external-sourced edges are `DependencyType.implicit` |
| fileMap crash on synthetic sourceFile | Phase 1 (static edges) | Integration/e2e test: run `nx affected --base=HEAD~1` after adding static edges; verify no "does not exist" errors |
| Daemon caching runtime inputs | Phase 2 (proxy caching) | e2e test: enable caching, run target, change HEAD via sync, run target again -- verify cache miss (with NX_DAEMON=false AND NX_DAEMON=true) |
| Failed runtime command constant hash | Phase 2 (proxy caching) | Unit test: mock runtime command failure; verify hash differs from success hash |
| Cross-platform compound command | Phase 2 (proxy caching) | CI test: run on Linux and Windows; compare runtime input output for same repo state |
| Temp dir .gitignore coverage | Phase 3 (temp rename) | Manual verification: check that `create-nx-workspace` scaffold includes `tmp` in `.gitignore` |

## Sources

- `node_modules/nx/src/project-graph/project-graph-builder.js` -- `validateStaticDependency` requires sourceFile for internal nodes, `getFileData`/`getNonProjectFileData` throw on missing files (HIGH confidence, verified in Nx 22.5.4)
- `node_modules/nx/src/plugins/js/project-graph/build-dependencies/explicit-package-json-dependencies.js` -- Nx's own static edge pattern uses `sourceFile: packageJsonPath` (HIGH confidence, verified)
- `node_modules/nx/src/config/workspace-json-project-json.d.ts` -- `InputDefinition` type includes `{ runtime: string }` shape (HIGH confidence, verified)
- [nrwl/nx#30170](https://github.com/nrwl/nx/issues/30170) -- "Runtime cache input simply does not work" (OPEN, Nx 20.0.3+, last confirmed December 2025) (HIGH confidence)
- [nrwl/nx#18432](https://github.com/nrwl/nx/issues/18432) -- runtime input broken with daemon (CLOSED as outdated, but underlying issue persists per #30170) (MEDIUM confidence)
- [Nx Inputs Reference](https://nx.dev/docs/reference/inputs) -- runtime inputs documentation, gitignored file exclusion (HIGH confidence)
- [Configure Inputs for Task Caching](https://nx.dev/docs/guides/tasks--caching/configure-inputs) -- cross-platform runtime input warnings (HIGH confidence)
- `packages/op-nx-polyrepo/src/lib/graph/detect.ts` -- current edge emission using `DependencyType.implicit` with explicit comment about `.repos/` fileMap exclusion (HIGH confidence, codebase)
- `packages/op-nx-polyrepo/src/lib/graph/transform.ts` -- `createProxyTarget` sets `cache: false, inputs: []` (HIGH confidence, codebase)
- `packages/op-nx-polyrepo/src/lib/executors/run/executor.ts` -- proxy executor uses `.tmp` for temp isolation, env does NOT spread `process.env` (HIGH confidence, codebase)
- `packages/op-nx-polyrepo/src/lib/graph/extract.ts` -- graph extraction uses `.tmp` for temp isolation, env DOES spread `process.env` (HIGH confidence, codebase)
- `packages/op-nx-polyrepo/src/index.ts` -- `externalNamedInputs` override prevents file-based pattern expansion but not sourceFile resolution (HIGH confidence, codebase)

---
*Pitfalls research for: static dependency edges, proxy target caching, and temp directory rename in Nx polyrepo plugin (v1.2)*
*Researched: 2026-03-22*
