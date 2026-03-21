# Codebase Concerns

**Analysis Date:** 2026-03-22

## Tech Debt

**Auto-detected cross-repo edges use implicit type instead of static:**
- Issue: All cross-repo dependency edges in `detectCrossRepoDependencies` emit `DependencyType.implicit` even when detected from package.json or tsconfig path aliases. These are semantically static dependencies and should carry a `sourceFile` field. Phase 9 planned `DependencyType.static` but the implementation used `implicit` throughout.
- Files: `packages/op-nx-polyrepo/src/lib/graph/detect.ts:385-389`, `packages/op-nx-polyrepo/src/index.ts:130`
- Impact: `nx affected` cannot trace which source file created the edge; provenance information is lost. The `static` edge type with `sourceFile` gives Nx better change impact analysis.
- Fix approach: Change `DependencyType.implicit` to `DependencyType.static` for package.json/tsconfig auto-detected edges. Keep `implicit` for user-configured `implicitDependencies` overrides. Update ~30 test assertions in `detect.spec.ts`, `index.spec.ts`, and 3 e2e tests in `cross-repo-deps.spec.ts`. Tracked in `.planning/todos/pending/2026-03-19-migrate-auto-detected-edges-from-implicit-to-static.md`.

**Proxy targets always run with `cache: false, inputs: []`:**
- Issue: `createProxyTarget` in `transform.ts` hardcodes `cache: false` and `inputs: []`. Even when the child repo's cache is warm, the host always spawns a child Node.js process, loads ~10 Nx plugins, reads the project graph, and checks child cache. With 8 proxy tasks in a dependency chain, the per-target bootstrap overhead is several seconds.
- Files: `packages/op-nx-polyrepo/src/lib/graph/transform.ts:118-121`
- Impact: Significant latency on warm runs. Every `nx test` or `nx build` involving external projects pays full child Nx bootstrap cost even when nothing changed.
- Fix approach: Set `cache: true` with a compound `runtime` input hashing both `git rev-parse HEAD` and `git diff HEAD` for the child repo. This invalidates on sync (new commit) and on user edits (working tree changes). Three-line change in `createProxyTarget`. Tracked in `.planning/todos/pending/2026-03-21-enable-host-level-caching-for-proxy-targets-using-runtime-inputs-tied-to-child-repo-git-head.md`.

**Child repo temp directories use `.tmp` instead of `tmp`:**
- Issue: The proxy executor and graph extractor create per-repo temp dirs at `.repos/<alias>/.tmp/`. This dotfile path requires explicit `.gitignore` entries in each synced repo. Nx workspaces already gitignore `tmp/` by default via `create-nx-workspace` scaffold.
- Files: `packages/op-nx-polyrepo/src/lib/executors/run/executor.ts:41-42`, `packages/op-nx-polyrepo/src/lib/graph/extract.ts:91-92`
- Impact: Users must manually add `.tmp/` to each synced repo's `.gitignore` to avoid dirty working tree status after proxy invocations or graph extraction.
- Fix approach: Rename `.tmp` to `tmp` in both files. Two-line change per file. Update assertions in corresponding spec files if they assert the `.tmp` path. Tracked in `.planning/todos/pending/2026-03-21-rename-tmp-to-tmp-in-child-repo-temp-directories.md`.

**pnpm silent install gives no feedback during long installs:**
- Issue: When `--verbose` is not set, `installDeps` uses `--reporter=silent` for pnpm which suppresses all output. Large repos (e.g., nrwl/nx with 3000+ packages) give zero user feedback during install which can take minutes.
- Files: `packages/op-nx-polyrepo/src/lib/executors/sync/executor.ts:68-131`
- Impact: Poor DX — users see a frozen terminal with no indication of progress.
- Fix approach: Switch to `--reporter=ndjson` for pnpm and parse the structured stream to emit progress dots and a final npm-style summary line. Only affects pnpm; npm/yarn keep their quiet flags. Tracked in `.planning/todos/pending/2026-03-11-parse-pnpm-ndjson-reporter-for-concise-install-progress.md`.

**Duplicate utility functions across modules:**
- Issue: `normalizePath` (converts backslashes to forward slashes) is defined identically in four separate files: `executor/run/executor.ts:16`, `graph/detect.ts:13`, `graph/extract.ts:10`, and `graph/transform.ts:9`. Similarly, `isRecord` (plain object type guard) is duplicated in `graph/detect.ts:20` and `graph/transform.ts:13`.
- Files: `packages/op-nx-polyrepo/src/lib/executors/run/executor.ts`, `packages/op-nx-polyrepo/src/lib/graph/detect.ts`, `packages/op-nx-polyrepo/src/lib/graph/extract.ts`, `packages/op-nx-polyrepo/src/lib/graph/transform.ts`
- Impact: Any future bugfix must be applied in multiple places; inconsistency risk increases over time.
- Fix approach: Extract to a shared `packages/op-nx-polyrepo/src/lib/utils/path.ts` and `packages/op-nx-polyrepo/src/lib/utils/guards.ts`. Low risk — pure functions with no side effects.

## Known Bugs

**Status executor reads old monolithic cache path for project counts:**
- Symptoms: `polyrepo-status` always shows `? projects` in the project count column, even when repos are synced and the per-repo cache is warm.
- Files: `packages/op-nx-polyrepo/src/lib/executors/status/executor.ts:44`
- Trigger: Running `nx polyrepo-status` after `nx polyrepo-sync` completes.
- Root cause: `getProjectCount` constructs the path as `join(workspaceRoot, '.repos', CACHE_FILENAME)` which resolves to `.repos/.polyrepo-graph-cache.json` — the old monolithic cache location. The Phase 11 migration moved cache files to `.repos/<alias>/.polyrepo-graph-cache.json` (per-repo). The status executor was not updated to match.
- Workaround: None; project counts show as `?` until the read path is corrected.
- Fix: Change line 44 to `join(workspaceRoot, '.repos', alias, CACHE_FILENAME)` so it reads from the per-repo path.

**Drift detection for tag-pinned repos is unreliable:**
- Symptoms: When a repo is configured with a tag ref (e.g., `ref: "v20.0.0"`) and is in tag-pinned detached-HEAD state, `hasDrift` at `status/executor.ts:178` compares `branchDisplay` (which is the tag name like `"v20.0.0"`) against `configuredRef` (also `"v20.0.0"`). This is coincidentally correct, but the comparison conflates branch names and tag names.
- Files: `packages/op-nx-polyrepo/src/lib/executors/status/executor.ts:166-181`
- Trigger: Tag-pinned repos where the display value is the tag name.
- Impact: Coincidentally works when tag names match, but the logic is fragile — any change to how `branchDisplay` is constructed for tag-pinned repos would silently break drift detection.
- Workaround: Currently works correctly by coincidence.

## Security Considerations

**No input validation on repo alias used in file paths:**
- Risk: Repo aliases from `nx.json` configuration are used directly to construct file paths (e.g., `.repos/<alias>/`, `.repos/<alias>/.polyrepo-graph-cache.json`). A malicious or misconfigured alias like `../etc` could produce path traversal — writing or reading files outside `.repos/`.
- Files: `packages/op-nx-polyrepo/src/lib/graph/cache.ts:47`, `packages/op-nx-polyrepo/src/lib/executors/sync/executor.ts` (multiple `join` calls with alias)
- Current mitigation: Zod schema validates alias keys are `z.string().min(1)`, but no character allowlist is enforced.
- Recommendations: Add a regex constraint to alias keys in `polyrepoConfigSchema` (e.g., `z.string().regex(/^[a-zA-Z0-9_-]+$/, 'Alias must contain only alphanumeric, dash, and underscore')`).

**`nx.json` is mutated at startup by `ensureTargetDefaultsShield`:**
- Risk: The plugin writes to `nx.json` on disk during `createNodesV2` as a side effect of normal `nx graph` invocations. This is an unusual and potentially surprising mutation for users with immutable config expectations (e.g., read-only filesystems, CI environments with strict git state checks).
- Files: `packages/op-nx-polyrepo/src/index.ts:38-76`
- Current mitigation: The write is guarded — it only fires once when `targetDefaults['@op-nx/polyrepo:run']` is absent.
- Recommendations: Log a more visible warning during the write. Consider moving this to a one-time migration hint rather than silent auto-mutation. Alternatively, document this behavior prominently in the README.

## Performance Bottlenecks

**Graph extraction spawns a child `nx graph --print` process on every hash miss:**
- Problem: When a repo's hash changes (after sync, commit, or working-tree edit), `extractGraphFromRepo` spawns a full `nx graph --print` subprocess. For repos with Gradle or other slow plugins (e.g., nrwl/nx with `@nx/gradle`), this can take 4-5 minutes on a cold JVM start.
- Files: `packages/op-nx-polyrepo/src/lib/graph/extract.ts:77-163`
- Cause: No fast path exists for the first extraction after a clean install. The `.nx-graph-output.json` fast path only exists in the e2e Docker image, not in general use.
- Improvement path: Documented in Phase 11 research — the sync executor now pre-caches after install (`preCacheGraph`). For repos with very slow graph extraction, exposing a way to manually pre-cache without a full sync would help.

**`computeGlobalHash` makes `git rev-parse HEAD` + `git status --porcelain` calls for every repo on every Nx command:**
- Problem: Each `populateGraphReport` call (invoked by both `createNodesV2` and `createDependencies`) runs these two git commands per configured repo. At 10 repos with ~20ms per call, this is ~200ms of overhead on every Nx command even when caches are warm.
- Files: `packages/op-nx-polyrepo/src/lib/graph/cache.ts:109-142`
- Cause: Hash-based invalidation requires checking current state on every invocation. The global gate short-circuits once all hashes are confirmed unchanged, but the hash computation itself still runs.
- Improvement path: The Phase 11 research notes this as a known cost (~100-200ms for 10 repos, <1% of typical Nx command duration). File-watcher-based invalidation was deferred as an optimization for future milestones.

**Status executor runs `git fetch` for all synced repos on every invocation:**
- Problem: `statusExecutor` calls `gitFetch` in parallel for all synced repos before collecting state. On slow network connections or repos with large pack files, this blocks the status display.
- Files: `packages/op-nx-polyrepo/src/lib/executors/status/executor.ts:119-138`
- Cause: Fetch is needed for accurate ahead/behind counts; without it, the data is stale.
- Improvement path: Make fetch optional (e.g., `--no-fetch` flag) or add a configurable timeout. Currently fetch failures produce a warning but do not skip ahead/behind display.

## Fragile Areas

**`nx/src/devkit-internals` and `nx/src/executors/run-commands/run-commands.impl` are internal Nx APIs:**
- Files: `packages/op-nx-polyrepo/src/index.ts:12`, `packages/op-nx-polyrepo/src/lib/executors/run/executor.ts:3`, `packages/op-nx-polyrepo/src/lib/executors/sync/executor.ts:8`
- Why fragile: These import paths (`nx/src/...`) are not part of Nx's public API surface. They can change or be removed in any Nx minor version without a migration guide.
- Safe modification: Use the public `@nx/devkit` package for anything available there. For `hashObject`, the only alternative is implementing SHA-256 hashing directly via `node:crypto`. For `runCommandsImpl`, the only alternative is re-implementing the command-spawning logic.
- Test coverage: Tests mock these imports, so unit tests pass but runtime compatibility is only validated by e2e tests against the exact pinned Nx version.

**`extractGraphFromRepo` parses JSON from stdout by finding the first `{`:**
- Files: `packages/op-nx-polyrepo/src/lib/graph/extract.ts:123-135`
- Why fragile: The slow path uses `stdout.indexOf('{')` to skip Nx banner/progress output before the JSON payload. If Nx ever outputs a `{` character in its banner (e.g., in a progress message), the parser will attempt to parse from the wrong offset and fail.
- Safe modification: The fast path in `tryReadCachedGraph` uses a more robust regex `\{\s*"graph"` to find the JSON envelope. Consider applying the same regex to the slow path's stdout parsing.
- Test coverage: `extract.spec.ts` has tests for banner-prefixed output, but they use a fixed `{` prefix. A `{` appearing in a progress message before the actual JSON is untested.

**Module-level state in `cache.ts` is shared between `createNodesV2` and `createDependencies` invocations:**
- Files: `packages/op-nx-polyrepo/src/lib/graph/cache.ts:24-37`
- Why fragile: `perRepoCache`, `globalHash`, `failureStates`, and `oldCacheCleaned` are module-level variables. Under the Nx daemon, these persist across commands (intentional). Under test, `vi.resetModules()` must be called to reset state between test cases. Forgetting this causes state bleed between tests.
- Safe modification: Follow the existing `cache.spec.ts` pattern — call `vi.resetModules()` and dynamically re-import the module before each test that needs clean state.
- Test coverage: `cache.spec.ts` correctly uses `vi.resetModules()`. Risk is in future test additions that omit this pattern.

**`resolvePluginConfig` throws synchronously if `nx.json` is missing or unparseable:**
- Files: `packages/op-nx-polyrepo/src/lib/config/resolve.ts:31-59`
- Why fragile: Called directly from `syncExecutor` and `statusExecutor` at startup. No try/catch wraps the call in these executors, so malformed `nx.json` produces an unhandled exception rather than a friendly error message.
- Safe modification: Wrap in try/catch in each executor and emit a human-readable error before re-throwing.
- Test coverage: Error case is tested in `resolve.spec.ts` but not in `executor.spec.ts`.

## Scaling Limits

**Per-repo graph extraction scales poorly for repos with slow graph plugins:**
- Current capacity: Tested with the nrwl/nx repo (~150 projects). Each extraction spawns one child process.
- Limit: Repos using `@nx/gradle` or other JVM-based plugins require a full JVM cold start (~4-5 minutes) on first extraction. With multiple such repos, serial extraction during `polyrepo-sync` can take 10+ minutes.
- Scaling path: The `.nx-graph-output.json` pre-computed fast path (used in e2e) could be exposed as a user-facing feature — allow users to commit a pre-computed graph JSON to the synced repo to skip live extraction entirely.

**`nx graph --print` output buffered entirely in memory with 1 GB maxBuffer:**
- Current capacity: `LARGE_BUFFER = 1024 * 1024 * 1024` bytes reserved per extraction.
- Limit: Repos with extremely large project graphs could approach the buffer limit. The 1 GB cap matches Nx's own constant.
- Files: `packages/op-nx-polyrepo/src/lib/graph/extract.ts:18`
- Scaling path: Stream-parse the JSON output rather than buffering entirely. Low priority given Nx itself uses the same buffer size.

## Dependencies at Risk

**`nx/src/devkit-internals` — internal import path:**
- Risk: `hashObject` is imported from `nx/src/devkit-internals` in three production files. This path is not in Nx's public API and has no stability guarantees.
- Impact: Any Nx major or minor release could relocate `hashObject`, breaking the plugin at runtime with a module-not-found error.
- Migration plan: Implement `hashObject` locally using `node:crypto` (`createHash('sha256').update(JSON.stringify(sorted(obj))).digest('hex')`) to eliminate the dependency on internal paths.

**`nx/src/executors/run-commands/run-commands.impl` — internal import path:**
- Risk: `runCommandsImpl` is imported from an internal path in `run/executor.ts`. Used to delegate proxy target execution to the child repo.
- Impact: Breakage on Nx version upgrade without migration guide.
- Migration plan: Re-implement the command spawning using Node.js `child_process.spawn` directly. The full `runCommandsImpl` surface is not needed — only the `command`/`cwd`/`env` path is used.

## Missing Critical Features

**`nx affected` is blind to changes in `.repos/<alias>/` directories:**
- Problem: `.repos/` is gitignored so `nx affected --base/--head` never maps file changes in synced repos to project names. Cross-repo edges are correctly present in the dependency graph, but `nx affected` cannot traverse them from the change side.
- Blocks: CI workflows that rely on `nx affected` to selectively build only changed projects cannot include external repo changes in the affected set.
- Files: `packages/op-nx-polyrepo/src/index.ts:221-227` (comment explains the limitation)
- Planned solution: A `polyrepo-affected` executor that maps git diffs inside `.repos/<alias>/` to namespaced project names. Explicitly deferred to a future milestone (DETECT-07).

**No devcontainer sidecar support for cross-platform child repo execution:**
- Problem: The run executor proxies targets by spawning commands on the host OS. Repos requiring Linux-only tooling or x86_64 native modules cannot run on Windows arm64 without QEMU emulation (which is slow and sometimes breaks).
- Blocks: Using the plugin on Windows arm64 with repos that have Linux-only build dependencies.
- Files: `packages/op-nx-polyrepo/src/lib/executors/run/executor.ts`
- Planned solution: Detect `.devcontainer/devcontainer.json` in synced repos and dispatch via `devcontainer exec` instead of host shell. Tracked in `.planning/todos/pending/2026-03-21-run-external-repo-nx-commands-in-devcontainer-sidecar.md`.

## Test Coverage Gaps

**Status executor's `getProjectCount` stale-path bug has no test:**
- What's not tested: `getProjectCount` reading from `.repos/.polyrepo-graph-cache.json` (old monolithic path) instead of `.repos/<alias>/.polyrepo-graph-cache.json` (per-repo path). The function always returns `null` when per-repo cache is used, but this is not caught by any test.
- Files: `packages/op-nx-polyrepo/src/lib/executors/status/executor.ts:39-56`
- Risk: The `? projects` column silently displays as unknown without any error or warning.
- Priority: High — this is a regression from Phase 11 with observable user-facing impact.

**No unit tests for `ensureTargetDefaultsShield` nx.json mutation:**
- What's not tested: The `nx.json` write path in `ensureTargetDefaultsShield`. Only the happy path (shield already present) is implicitly tested via `createNodesV2` unit tests.
- Files: `packages/op-nx-polyrepo/src/index.ts:38-76`
- Risk: Silent nx.json corruption on malformed JSON or concurrent access.
- Priority: Medium.

**No tests for `extractGraphFromRepo` slow path with `{` appearing in banner before JSON envelope:**
- What's not tested: A banner that contains a `{` character before the actual `{"graph":...}` JSON payload. The current `indexOf('{')` heuristic would produce a parse failure for this input.
- Files: `packages/op-nx-polyrepo/src/lib/graph/extract.ts:123-135`
- Risk: If a future Nx version emits `{` in progress output, extraction silently fails and falls back to the backoff mechanism.
- Priority: Low — the regex-based fast path (`tryReadCachedGraph`) is more robust and is used in e2e.

---

*Concerns audit: 2026-03-22*
