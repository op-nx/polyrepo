# Phase 12: Resolve the cross-repo build cascade issue when syncing external nrwl/nx repo on Windows - Context

**Gathered:** 2026-03-21
**Status:** Ready for planning

<domain>
## Phase Boundary

Fix the targetDefaults isolation leak where host workspace `targetDefaults` (e.g., `test.dependsOn: ["^build"]`) merge into external project proxy targets, causing amplified cross-repo build cascading. Get `nx/devkit:build` (and its intra-repo `^build` chain) working on Windows via the proxy executor so `nx test @op-nx/polyrepo` succeeds without `--exclude-task-dependencies`.

Two deliverables:
1. **targetDefaults isolation** — each workspace's `targetDefaults` only affects its own projects
2. **Windows build resolution** — `nx/devkit:build` succeeds via proxy executor on Windows

</domain>

<decisions>
## Implementation Decisions

### targetDefaults Isolation Model

Full bidirectional isolation — each workspace's `targetDefaults` only affects its own projects:

| Direction | Rule |
|-----------|------|
| Host `targetDefaults` -> external repos | Blocked |
| External repo B `targetDefaults` -> host | Blocked |
| External repo A `targetDefaults` -> repo B | Blocked |
| External repo B `dependsOn` -> cross-repo cascade to host/repo A | Allowed (Nx caching handles it) |
| External repo B `dependsOn` -> intra-repo cascade within repo B | Preserved |

- Host `targetDefaults` must NOT override or remove `dependsOn` that was applied by an external repo's own `targetDefaults`
- External repo A's `targetDefaults` must NOT affect external repo B or host
- Cross-repo cascade from preserved `dependsOn` is expected behavior — let it cascade, Nx caching handles it

### Proxy Target dependsOn Fix

The root cause: proxy targets currently omit `dependsOn` (set to `undefined`). Nx treats `undefined` as "merge `targetDefaults`", which is how host's `test.dependsOn: ["^build"]` leaks into every external project's `test` target.

The fix — set `dependsOn` to an **explicit** value on every proxy target:

| External repo graph output | Proxy target gets | Host targetDefaults merge? |
|---|---|---|
| Target has `dependsOn: ["^build"]` (from repo's own config) | `dependsOn: ["^build"]` (preserved, rewritten) | Blocked — value already defined |
| Target has no `dependsOn` | `dependsOn: []` (explicit empty) | Blocked — value already defined |

- `dependsOn` is read from the raw target config in the external repo's `nx graph --print` output (which already has that repo's `targetDefaults` baked in)
- Project references are rewritten to namespaced form (e.g., `generate-api` -> `nx/generate-api`)
- Caret syntax (`^build`) and self-references (`build`) are kept as-is
- Object entries with `projects` arrays have project names namespaced

### Preserve Only dependsOn

Other proxy target fields remain as-is:
- `inputs: []` — host doesn't hash external files (correct for proxy pattern)
- `cache: false` — proxy always delegates to child repo (correct)
- `outputs` — omitted (child repo manages its own outputs)

These are correct for the proxy architecture: the host-side values only affect host Nx task runner behavior, not the child repo. The child repo's Nx applies its own inputs/outputs/cache when the proxy executor shells out.

### Cross-repo Cascade Behavior

Let cascade happen naturally. `nx test @op-nx/polyrepo` has `^build` from host `targetDefaults` -> cross-repo edge to `nx/devkit` -> `nx/devkit:build` via proxy executor. This is expected and correct.

The fix eliminates the **amplified** cascade: previously `test.dependsOn: ["^build"]` leaked into ALL ~150 `nx/*` test targets, each cascading into their deps. After the fix, only host targets have host `dependsOn`.

### Windows Build Resolution

The cascade into `nx/devkit:build` must succeed on Windows. This is the only cross-repo build that matters (only `@op-nx/polyrepo` has a cross-repo dep, and only on `@nx/devkit`).

- **Scope:** Get `nx/devkit:build` and its intra-repo `^build` chain working via proxy executor on Windows
- **Known leads for research:**
  - `NX_WORKSPACE_DATA` set to unique folder (SQLite locking isolation between host and child Nx)
  - `NX_DAEMON=false` for child processes (ideally unnecessary)
  - `NX_PLUGIN_NO_TIMEOUTS` / `NX_DISABLE_PLUGIN_TIMEOUTS`
  - Running delegated tasks in nx's devcontainer
- **Research required:** Map nx/devkit's build chain inside nrwl/nx repo. Identify which steps fail on Windows and why (SQLite locking, Gradle OOM, native Rust artifacts). Determine if failures are in nx/devkit itself or its intra-repo `^build` dependencies.
- **Approach:** Research heavily through nx source exploration and web search, try different alternatives, find a proper solution informed by understanding exactly what's happening

### Error Handling and DX

- **Silent operation** — no diagnostic logging about targetDefaults isolation or cascade behavior. It just works correctly.
- **Let failures propagate** — if a build fails, the user sees the error and can fix their configuration. No plugin-level mitigation.
- **Remove --exclude-task-dependencies workaround** from documentation and inline code comments once builds work
- **preVersionCommand** `--exclude-task-dependencies` — research during implementation whether it has the same root cause; remove if redundant

### Claude's Discretion

- `rewriteDependsOn` function implementation details (parsing string vs object entries)
- Exact Zod schema changes for validating dependsOn from raw target config
- Research approach for Windows build investigation (order of experiments, which NX_ env vars to try first)
- Whether to extract repos in parallel or sequentially for build testing
- Test organization for targetDefaults isolation tests

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets

- `createProxyTarget` (`graph/transform.ts:43-66`): The function to modify. Currently omits `dependsOn`. Receives `rawTargetConfig: unknown` which contains the external repo's resolved target config including `dependsOn`.
- `isRecord` / `isRecordOfRecords` (`graph/transform.ts:22-36`): Type guards for safely extracting fields from raw target config. Same pattern needed for `dependsOn` extraction.
- `transformGraphForRepo` (`graph/transform.ts:80-180`): Calls `createProxyTarget` per target. Has access to repo alias for namespacing.
- Phase 2 `rewriteDependsOn` (removed): Was in transform.ts before dependsOn stripping was introduced. The v1.0 plan (`02-02-PLAN.md:326-367`) documents the original implementation with caret syntax handling and project reference namespacing.

### Established Patterns

- Proxy target config extraction uses `isRecord` type guard + property access (not Zod) for raw target data
- SIFERS test pattern: dependsOn omission already tested in `transform.spec.ts:392-438` — needs updating to test preservation
- `externalNamedInputs` override in `index.ts:60-73`: Explicit field setting blocks `targetDefaults` merge — same mechanism for `dependsOn`

### Integration Points

- `createProxyTarget` in `transform.ts`: Primary change point — extract and rewrite `dependsOn`
- `transform.spec.ts`: Existing `dependsOn omission` test suite to update
- `nx.json:77-96`: Host `targetDefaults` that currently leak — the trigger for this issue
- Proxy executor (`executors/run/executor.ts`): May need env var changes (NX_WORKSPACE_DATA, NX_DAEMON) for Windows build fix
- `.repos/nx/` — the synced nrwl/nx repo where builds must succeed

</code_context>

<specifics>
## Specific Ideas

- The `nx graph --print` output from external repos already has `targetDefaults` merged into each project's target config. The plugin just needs to read `dependsOn` from the raw target data and preserve it (with namespacing). No need to separately process the external repo's `nx.json#targetDefaults`.
- The `rewriteDependsOn` function needs to handle three dependsOn entry types: (1) string with caret like `"^build"` — keep as-is, (2) bare string like `"generate-api"` — namespace to `"nx/generate-api"`, (3) object like `{target: "build", projects: ["core"]}` — namespace project names in the `projects` array. Self-references (bare target name matching a known target) stay as-is.
- The Windows build investigation should start by running `nx/devkit:build` directly inside `.repos/nx/` to isolate whether failures are from the proxy executor mechanism or from the nrwl/nx build itself.
- Consider whether `NX_WORKSPACE_DATA` can be set per-invocation in the proxy executor to isolate SQLite databases between host and child Nx processes.

</specifics>

<deferred>
## Deferred Ideas

- **`crossRepoCascade` config option** — let users disable cross-repo cascade for repos with native builds that don't work on their platform. Deferred to a future phase if the Windows build fix doesn't cover all cases.
- **Preserving inputs/outputs/cache from external repos** — proxy targets currently strip these. Could be restored for graph accuracy, but the proxy architecture makes them irrelevant to child repo execution.
- **`nx affected` cross-repo support (DETECT-07)** — carried from Phase 10/11. Requires `polyrepo-affected` executor. Separate milestone.

</deferred>

---

*Phase: 12-resolve-the-cross-repo-build-cascade-issue-when-syncing-external-nrwl-nx-repo-on-windows*
*Context gathered: 2026-03-21*
