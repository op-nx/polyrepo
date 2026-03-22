# Phase 12: Resolve the cross-repo build cascade issue when syncing external nrwl/nx repo on Windows - Research

**Researched:** 2026-03-21
**Domain:** Nx targetDefaults isolation, proxy target dependsOn preservation, Windows build support
**Confidence:** HIGH

## Summary

Phase 12 has two deliverables: (1) isolate host `targetDefaults` from leaking into external project proxy targets, and (2) get `nx/devkit:build` working via the proxy executor on Windows. Both are well-understood problems with clear solutions grounded in verified Nx internals.

The targetDefaults isolation fix is straightforward: the root cause is that proxy targets set `dependsOn: undefined`, and Nx's `mergeTargetDefaultWithTargetDefinition` function treats `undefined` as "apply targetDefaults." Setting an explicit value (either the preserved original or `[]`) blocks the merge. This is confirmed by both reading the Nx merge source code (`project-configuration-utils.ts:981`) and an existing Nx test (`project-configuration-utils.spec.ts:2485-2523`).

The Windows build fix requires passing `NX_DAEMON=false` and `NX_WORKSPACE_DATA_DIRECTORY` to child processes via the `runCommandsImpl` `env` option to isolate the child Nx's SQLite databases from the host. The nrwl/nx `devkit:build` chain involves TypeScript compilation (`build-base`), asset copying (`legacy-post-build`), and a copy-readme command -- all of which are pure Node.js operations that work on Windows. The main risk is `build-native` (Rust/NAPI compilation) which is in the `nx` core package's build chain, but this only runs if Rust artifacts are stale.

**Primary recommendation:** Preserve `dependsOn` from raw graph data in `createProxyTarget`, use `[]` for targets with no `dependsOn`, and add `NX_DAEMON=false` + `NX_WORKSPACE_DATA_DIRECTORY` to the proxy executor's environment.

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions

**targetDefaults Isolation Model:** Full bidirectional isolation -- each workspace's `targetDefaults` only affects its own projects. Host targetDefaults blocked from external repos, and vice versa. Cross-repo cascade from preserved `dependsOn` is allowed (Nx caching handles it).

**Proxy Target dependsOn Fix:** Set `dependsOn` to an explicit value on every proxy target. Targets with `dependsOn` from the external repo preserve it (rewritten). Targets without `dependsOn` get `dependsOn: []`. The raw `nx graph --print` output already has the external repo's `targetDefaults` baked in.

**Preserve Only dependsOn:** Other proxy target fields (`inputs: []`, `cache: false`, no `outputs`) remain as-is. These are correct for the proxy architecture.

**Cross-repo Cascade Behavior:** Let cascade happen naturally. The fix eliminates amplified cascade (host `test.dependsOn: ["^build"]` leaking into all ~150 `nx/*` test targets), not legitimate cascade.

**Windows Build Resolution:** Get `nx/devkit:build` and its intra-repo `^build` chain working via proxy executor on Windows. Known leads: `NX_WORKSPACE_DATA_DIRECTORY`, `NX_DAEMON=false`, `NX_PLUGIN_NO_TIMEOUTS`.

**Error Handling and DX:** Silent operation, let failures propagate, remove `--exclude-task-dependencies` workaround once builds work.

### Claude's Discretion

- `rewriteDependsOn` function implementation details (parsing string vs object entries)
- Exact Zod schema changes for validating dependsOn from raw target config
- Research approach for Windows build investigation (order of experiments, which NX\_ env vars to try first)
- Whether to extract repos in parallel or sequentially for build testing
- Test organization for targetDefaults isolation tests

### Deferred Ideas (OUT OF SCOPE)

- `crossRepoCascade` config option
- Preserving inputs/outputs/cache from external repos
- `nx affected` cross-repo support (DETECT-07)
  </user_constraints>

## Standard Stack

### Core

| Library                                           | Version   | Purpose                                     | Why Standard                    |
| ------------------------------------------------- | --------- | ------------------------------------------- | ------------------------------- |
| `@nx/devkit`                                      | workspace | TargetConfiguration types, dependsOn typing | Already the plugin's dependency |
| `vitest`                                          | workspace | Unit testing for transform and executor     | Existing test framework         |
| `nx/src/executors/run-commands/run-commands.impl` | workspace | Proxy executor's process spawning           | Already imported by executor    |

### Supporting

| Library | Version   | Purpose                              | When to Use              |
| ------- | --------- | ------------------------------------ | ------------------------ |
| `zod`   | workspace | Schema validation for raw graph data | Already used in types.ts |

### Alternatives Considered

| Instead of               | Could Use                                            | Tradeoff                                                                                   |
| ------------------------ | ---------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Explicit `dependsOn: []` | `dependsOn: undefined` with targetDefaults filtering | Would require modifying how host-side Nx processes targets -- far more complex and fragile |

**Installation:** No new dependencies needed.

## Architecture Patterns

### Recommended Change Structure

```
packages/op-nx-polyrepo/src/lib/
  graph/
    transform.ts        # Modify createProxyTarget + add rewriteDependsOn
    transform.spec.ts   # Update dependsOn omission tests -> preservation tests
    types.ts            # No changes needed (targets already z.unknown())
  executors/run/
    executor.ts         # Add env vars to runCommandsImpl options
    executor.spec.ts    # Test env var passing
```

### Pattern 1: dependsOn Preservation in createProxyTarget

**What:** Extract `dependsOn` from raw target config and rewrite project references
**When to use:** Every proxy target creation
**Example:**

```typescript
// Source: Nx project-configuration-utils.ts:981 -- confirms undefined triggers merge
// When target has dependsOn from external repo's nx graph --print:
function createProxyTarget(
  repoAlias: string,
  originalProject: string,
  targetName: string,
  rawTargetConfig: unknown,
): TargetConfiguration {
  const config = isRecord(rawTargetConfig) ? rawTargetConfig : {};

  return {
    executor: '@op-nx/polyrepo:run',
    options: { repoAlias, originalProject, targetName },
    inputs: [],
    cache: false,
    // CRITICAL: explicit value blocks host targetDefaults merge
    dependsOn: rewriteDependsOn(config['dependsOn'], repoAlias),
    configurations: /* ... existing ... */,
    parallelism: /* ... existing ... */,
    metadata: /* ... existing ... */,
  };
}
```

### Pattern 2: rewriteDependsOn Function

**What:** Transform dependsOn entries from external repo context to host context
**When to use:** Called by createProxyTarget for every proxy target
**Example:**

```typescript
// Source: Nx TargetDependencyConfig type -- node_modules/nx/src/config/workspace-json-project-json.d.ts:149
function rewriteDependsOn(
  rawDependsOn: unknown,
  repoAlias: string,
): (
  | string
  | {
      target: string;
      projects?: string | string[];
      params?: string;
      options?: string;
      dependencies?: boolean;
    }
)[] {
  // No dependsOn in raw config -> explicit empty array blocks targetDefaults
  if (!Array.isArray(rawDependsOn)) {
    return [];
  }

  return rawDependsOn.map((entry) => {
    // String entries: caret (^build) and bare targets (build-base) pass through
    if (typeof entry === 'string') {
      return entry;
    }

    // Object entries: namespace projects array if present
    if (isRecord(entry) && typeof entry['target'] === 'string') {
      const result: Record<string, unknown> = { ...entry };

      if (Array.isArray(entry['projects'])) {
        result['projects'] = entry['projects'].map((p: unknown) =>
          typeof p === 'string' ? `${repoAlias}/${p}` : p,
        );
      }
      // projects: "self" passes through unchanged

      return result;
    }

    return entry; // Unknown shape, pass through
  });
}
```

### Pattern 3: Environment Isolation in Proxy Executor

**What:** Pass env vars to child Nx process to isolate SQLite databases
**When to use:** Every proxy executor invocation
**Example:**

```typescript
// Source: cache-directory.ts:88 -- NX_WORKSPACE_DATA_DIRECTORY overrides workspace-data path
const result = await runCommandsImpl(
  {
    command,
    cwd: repoPath,
    env: {
      NX_DAEMON: 'false',
      NX_WORKSPACE_DATA_DIRECTORY: normalizePath(
        join(repoPath, '.nx', 'workspace-data'),
      ),
    },
    __unparsed__: options.__unparsed__ ?? [],
  },
  context,
);
```

### Anti-Patterns to Avoid

- **Filtering targetDefaults at the host level:** Attempting to modify how the host Nx applies targetDefaults to specific projects would require deep Nx internals patching and would break on Nx version updates.
- **Omitting dependsOn (undefined) for targets that had no dependsOn:** This is the current bug. `undefined` means "apply targetDefaults." Must use `[]` for explicit "no dependencies."
- **Namespacing bare string dependsOn entries as project references:** Bare strings like `"build-base"` in `dependsOn` are self-references (same-project target names), NOT project references. Do not namespace them.
- **Using `NX_WORKSPACE_DATA_CACHE_DIRECTORY`:** This env var name is documented but NOT actually used by Nx. The correct variable is `NX_WORKSPACE_DATA_DIRECTORY`.

## Don't Hand-Roll

| Problem                  | Don't Build                                    | Use Instead                                    | Why                                                                 |
| ------------------------ | ---------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------- |
| targetDefaults filtering | Custom plugin-level targetDefaults interceptor | Set explicit `dependsOn` on every proxy target | Nx's merge logic already respects explicit values -- just set them  |
| Environment isolation    | Manual SQLite lock management                  | `NX_WORKSPACE_DATA_DIRECTORY` env var          | Built into Nx's cache-directory.ts, tested across workspace setups  |
| Child process spawning   | Custom `exec`/`spawn` in executor              | `runCommandsImpl` with `env` option            | Already used by executor, handles env passing, PATH management, PTY |

**Key insight:** Both fixes leverage existing Nx mechanisms rather than fighting them. The targetDefaults isolation uses Nx's own merge behavior (explicit value blocks defaults). The environment isolation uses Nx's built-in env var support.

## Common Pitfalls

### Pitfall 1: Confusing dependsOn string entries as project references

**What goes wrong:** Bare strings like `"build-base"` get namespaced to `"nx/build-base"`, which Nx interprets as running target `build-base` on project `nx/build-base` (nonexistent).
**Why it happens:** In `dependsOn`, a bare string can mean either a target name (self-reference) or a project name (when used with caret). The distinction is: caret prefix (`^`) = run on dependency projects, no caret = run on same project.
**How to avoid:** String entries pass through unchanged. Only object entries with explicit `projects` arrays need namespacing.
**Warning signs:** `Could not find project "nx/build-native"` errors when running tasks.

### Pitfall 2: Using the wrong NX_WORKSPACE_DATA env var name

**What goes wrong:** Setting `NX_WORKSPACE_DATA_CACHE_DIRECTORY` has no effect because Nx reads `NX_WORKSPACE_DATA_DIRECTORY`.
**Why it happens:** Nx documentation has historically used `NX_WORKSPACE_DATA_CACHE_DIRECTORY` but the actual code reads `NX_WORKSPACE_DATA_DIRECTORY` (confirmed in `cache-directory.ts:88`).
**How to avoid:** Use `NX_WORKSPACE_DATA_DIRECTORY` (verified from source).
**Warning signs:** SQLite locking errors or stale cache despite setting the env var.

### Pitfall 3: Object dependsOn entries with `projects: "self"`

**What goes wrong:** If `"self"` gets treated as a project name and namespaced to `"nx/self"`, the self-reference breaks.
**Why it happens:** The `projects` field in `TargetDependencyConfig` can be `string | string[]`. The special value `"self"` means "this project." There are 209 such entries in the nrwl/nx repo.
**How to avoid:** Only namespace when `projects` is an array. `projects: "self"` and `projects: "dependencies"` pass through unchanged.
**Warning signs:** `Could not find project "nx/self"` errors.

### Pitfall 4: Tag-based project selectors in dependsOn

**What goes wrong:** `{target: "build", projects: ["tag:npm:public"]}` gets namespaced to `{projects: ["nx/tag:npm:public"]}`, which is invalid.
**Why it happens:** The `projects` array can contain tag selectors like `"tag:npm:public"` alongside actual project names.
**How to avoid:** Detect entries starting with `"tag:"` and pass them through unchanged. The tags exist on the namespaced projects because `transformGraphForRepo` preserves original tags.
**Warning signs:** `Cannot find projects matching "nx/tag:npm:public"` errors.

### Pitfall 5: Rust build-native target timeout or failure

**What goes wrong:** `nx:build-native` uses `@monodon/rust:napi` which compiles Rust. If Rust toolchain is not installed or compilation is slow, the build times out.
**Why it happens:** The nrwl/nx repo has native Rust code in `packages/nx/src/native/`. The `build-native` target compiles it.
**How to avoid:** A `.node` binary already exists for `win32-arm64-msvc`. Nx's caching should skip `build-native` if the input hash (Rust files, Cargo.toml) hasn't changed. Set `NX_PLUGIN_NO_TIMEOUTS=true` for initial builds.
**Warning signs:** `@monodon/rust:napi` errors, `cargo build` failures, NAPI compilation errors.

### Pitfall 6: Host `lint` target overwritten by targetDefaults

**What goes wrong:** Host's `targetDefaults.lint.command: "eslint . --max-warnings=0"` currently leaks into ALL external project `lint` targets, replacing the proxy executor with `nx:run-commands`.
**Why it happens:** The host `targetDefaults` for `lint` includes a `command` field. When `lint` targets have `undefined` for `command`, the targetDefault fills it in -- and Nx treats targets with `command` as `nx:run-commands`, overriding the proxy executor.
**How to avoid:** This is already visible in the current project graph (verified: `nx/devkit:lint` has `executor: "nx:run-commands"` instead of `@op-nx/polyrepo:run`). The dependsOn fix (explicit values on all fields that matter) should also consider that the `executor` field is already set explicitly by `createProxyTarget`, so `command` from targetDefaults may still leak. Verify after fix.
**Warning signs:** External project `lint` targets run ESLint locally instead of delegating to child repo.

## Code Examples

Verified patterns from source code inspection:

### Nx targetDefaults Merge Logic

```typescript
// Source: .repos/nx/packages/nx/src/project-graph/utils/project-configuration-utils.ts:978-988
// In mergeTargetDefaultWithTargetDefinition:
default: {
  const sourceMapKey = `targets.${targetName}.${key}`;
  if (
    targetDefinition[key] === undefined ||  // <-- THIS is why undefined leaks
    targetDefaultShouldBeApplied(sourceMapKey, sourceMap)
  ) {
    result[key] = targetDefault[key];
    sourceMap[sourceMapKey] = ['nx.json', 'nx/target-defaults'];
  }
  break;
}
```

### Nx Test Confirming Empty Array Blocks Merge

```typescript
// Source: .repos/nx/packages/nx/src/project-graph/utils/project-configuration-utils.spec.ts:2485-2523
it('should not overwrite dependsOn', () => {
  const result = mergeTargetDefaultWithTargetDefinition(
    'build',
    {
      name: 'myapp',
      root: 'apps/myapp',
      targets: {
        build: {
          executor: 'nx:run-commands',
          options: { command: 'echo', cwd: '{workspaceRoot}' },
          dependsOn: [], // explicit empty array
        },
      },
    },
    { dependsOn: ['^build'] }, // targetDefault
    sourceMap,
  );
  expect(result.dependsOn).toEqual([]); // targetDefault NOT applied
});
```

### RunCommandsOptions env Field

```typescript
// Source: node_modules/nx/src/executors/run-commands/run-commands.impl.d.ts
export interface RunCommandsOptions extends Json {
  command?: string | string[];
  cwd?: string;
  env?: Record<string, string>; // <-- env vars passed to child process
  __unparsed__: string[];
}
```

### NX_WORKSPACE_DATA_DIRECTORY Resolution

```typescript
// Source: .repos/nx/packages/nx/src/utils/cache-directory.ts:85-92
export function workspaceDataDirectoryForWorkspace(workspaceRoot: string) {
  return absolutePath(
    workspaceRoot,
    process.env.NX_WORKSPACE_DATA_DIRECTORY ?? // <-- correct env var
      process.env.NX_PROJECT_GRAPH_CACHE_DIRECTORY ?? // legacy fallback
      defaultWorkspaceDataDirectory(workspaceRoot), // .nx/workspace-data
  );
}
```

### Raw nx graph --print Output for devkit (Verified)

```json
// Source: live extraction from .repos/nx/ on 2026-03-21
{
  "build": {
    "dependsOn": ["^build", "build-base", "legacy-post-build"],
    "executor": "nx:run-commands"
  },
  "build-base": {
    "dependsOn": ["^build-base", "build-native"],
    "executor": "nx:run-commands"
  },
  "test": {
    "dependsOn": ["test-native", "build-native", "^build-native"],
    "executor": "nx:run-commands"
  },
  "lint": {
    "dependsOn": ["build-native", "^build-native"],
    "executor": "nx:run-commands"
  }
}
```

### dependsOn Entry Types in nrwl/nx (Verified)

```
Total projects: 149
String entries: caret (^build) and bare target names (build-base) -- pass through
Object entries with projects: "self": 209 -- pass through
Object entries with projects array: 4 -- namespace project names
  Example: {projects: ["devkit", "create-nx-workspace", "dotnet", "maven"], target: "build"}
  -> {projects: ["nx/devkit", "nx/create-nx-workspace", "nx/dotnet", "nx/maven"], target: "build"}
Object entries with tag selectors: {projects: ["tag:npm:public"]} -- pass through
```

## State of the Art

| Old Approach                            | Current Approach                                  | When Changed | Impact                                            |
| --------------------------------------- | ------------------------------------------------- | ------------ | ------------------------------------------------- |
| `dependsOn: undefined` on proxy targets | `dependsOn: []` or preserved value                | Phase 12     | Blocks host targetDefaults leak                   |
| No env isolation in proxy executor      | `NX_DAEMON=false` + `NX_WORKSPACE_DATA_DIRECTORY` | Phase 12     | Prevents SQLite locking between host and child Nx |

**Current behavior (bug):**

- Host `targetDefaults.test.dependsOn: ["^build"]` leaks into all ~150 `nx/*` test targets
- Host `targetDefaults.lint.command: "eslint . --max-warnings=0"` overwrites proxy executor on lint targets
- E2e tests require `--exclude-task-dependencies` workaround

## Open Questions

1. **Tag-based project selectors in dependsOn namespacing**
   - What we know: 4 entries in nrwl/nx use object-style dependsOn with explicit project arrays. 2 of those use `["tag:npm:public"]` which is a tag selector, not a project name.
   - What's unclear: Whether `"tag:npm:public"` entries need special handling or if they can just be left as-is (since tags are preserved on namespaced projects).
   - Recommendation: Detect strings starting with `"tag:"` in the projects array and skip namespacing. LOW risk -- these entries are on `@nx/nx-source` project which is not in the devkit build chain.

2. **Rust build-native caching behavior**
   - What we know: A `.node` binary for `win32-arm64-msvc` exists at `.repos/nx/packages/nx/src/native/nx.win32-arm64-msvc.node`. The `build-native` target has `cache: true` and `inputs: ["native"]`.
   - What's unclear: Whether Nx's cache will correctly detect the existing binary and skip recompilation, or if a cache miss would trigger a full Rust build.
   - Recommendation: Test empirically during implementation. If Rust compilation is triggered, investigate why cache misses and consider whether `NX_SKIP_NX_CACHE=true` or other env vars are needed. Worst case: the e2e Docker image can pre-build these.

3. **lint target executor override from host targetDefaults**
   - What we know: The host `targetDefaults.lint` has `command: "eslint . --max-warnings=0"`. This leaks into external lint targets, replacing the proxy executor with `nx:run-commands`.
   - What's unclear: Whether setting explicit `dependsOn` alone fixes the executor override, or if we also need to explicitly set other fields to block the `command` leak.
   - Recommendation: The proxy target already sets `executor: "@op-nx/polyrepo:run"` explicitly. Verify after the dependsOn fix whether `command` from targetDefaults still overwrites. If so, the `command` field may need explicit handling (but this may be a separate concern from dependsOn).

4. **preVersionCommand --exclude-task-dependencies removal**
   - What we know: `nx.json:74` has `preVersionCommand: "npx nx run-many -t build --exclude tag:polyrepo:external --exclude-task-dependencies"`. This already excludes external projects by tag AND excludes task dependencies.
   - What's unclear: Whether `--exclude-task-dependencies` can be safely removed after the fix, or if the `--exclude tag:polyrepo:external` alone is sufficient.
   - Recommendation: Research during implementation. The `--exclude` flag already filters external projects from the `run-many` target list. `--exclude-task-dependencies` would only matter if a host project's build cascades into an external build. After the fix, this cascade is still possible (and expected). Keep `--exclude-task-dependencies` unless testing proves it's unnecessary.

## Validation Architecture

### Test Framework

| Property           | Value                                       |
| ------------------ | ------------------------------------------- |
| Framework          | vitest (workspace version)                  |
| Config file        | `packages/op-nx-polyrepo/vitest.config.mts` |
| Quick run command  | `npm exec nx -- test @op-nx/polyrepo`       |
| Full suite command | `npm exec nx -- test @op-nx/polyrepo`       |

### Phase Requirements -> Test Map

| Req ID          | Behavior                                              | Test Type   | Automated Command                                                    | File Exists?                     |
| --------------- | ----------------------------------------------------- | ----------- | -------------------------------------------------------------------- | -------------------------------- |
| (no mapped IDs) | dependsOn preserved with caret syntax                 | unit        | `npm exec nx -- test @op-nx/polyrepo -- --testPathPattern transform` | Needs update (transform.spec.ts) |
| (no mapped IDs) | dependsOn set to [] when absent from raw config       | unit        | `npm exec nx -- test @op-nx/polyrepo -- --testPathPattern transform` | Needs update (transform.spec.ts) |
| (no mapped IDs) | Object dependsOn entries namespace projects array     | unit        | `npm exec nx -- test @op-nx/polyrepo -- --testPathPattern transform` | Wave 0                           |
| (no mapped IDs) | Object dependsOn with projects: "self" passes through | unit        | `npm exec nx -- test @op-nx/polyrepo -- --testPathPattern transform` | Wave 0                           |
| (no mapped IDs) | Tag selectors in projects array pass through          | unit        | `npm exec nx -- test @op-nx/polyrepo -- --testPathPattern transform` | Wave 0                           |
| (no mapped IDs) | Proxy executor passes env vars to runCommandsImpl     | unit        | `npm exec nx -- test @op-nx/polyrepo -- --testPathPattern executor`  | Wave 0                           |
| (no mapped IDs) | Windows build: nx/devkit:build succeeds via proxy     | manual-only | Manual: `npm exec nx -- run nx/devkit:build`                         | N/A                              |

### Sampling Rate

- **Per task commit:** `npm exec nx -- test @op-nx/polyrepo`
- **Per wave merge:** `npm exec nx -- test @op-nx/polyrepo`
- **Phase gate:** Full suite green + manual build verification

### Wave 0 Gaps

- [ ] Update `transform.spec.ts` "dependsOn omission" describe block -> "dependsOn preservation"
- [ ] Add test cases for object-style dependsOn with projects array namespacing
- [ ] Add test cases for projects: "self" pass-through
- [ ] Add test cases for tag selector pass-through
- [ ] Add executor.spec.ts tests for env var passing

## Sources

### Primary (HIGH confidence)

- `.repos/nx/packages/nx/src/project-graph/utils/project-configuration-utils.ts:978-988` - targetDefaults merge logic confirming `undefined` triggers default application
- `.repos/nx/packages/nx/src/project-graph/utils/project-configuration-utils.spec.ts:2485-2523` - Nx test confirming `dependsOn: []` blocks targetDefault merge
- `.repos/nx/packages/nx/src/utils/cache-directory.ts:85-92` - NX_WORKSPACE_DATA_DIRECTORY env var resolution
- `.repos/nx/packages/nx/src/executors/run-commands/running-tasks.ts:620-652` - processEnv function showing how env option is passed to child processes
- `node_modules/nx/src/executors/run-commands/run-commands.impl.d.ts` - RunCommandsOptions interface with env field
- `node_modules/nx/src/config/workspace-json-project-json.d.ts:149-173` - TargetDependencyConfig type definition
- Live `nx graph --print` output from `.repos/nx/` - Raw devkit target data with dependsOn values
- `.nx/workspace-data/project-graph.json` - Current host project graph showing targetDefaults leak

### Secondary (MEDIUM confidence)

- [Nx targetDefaults documentation](https://nx.dev/docs/reference/nx-json) - Confirms overwrite (not merge) behavior
- [GitHub Issue #10438](https://github.com/nrwl/nx/issues/10438) - Confirms project-level dependsOn replaces targetDefaults
- [Nx Environment Variables](https://nx.dev/docs/reference/environment-variables) - Documents NX_WORKSPACE_DATA_DIRECTORY, NX_DAEMON, NX_PLUGIN_NO_TIMEOUTS
- [GitHub Issue #28389](https://github.com/nrwl/nx/issues/28389) - Confirms NX_WORKSPACE_DATA_CACHE_DIRECTORY is NOT the correct env var name

### Tertiary (LOW confidence)

- [Configuration Merging and Target Defaults (DeepWiki)](https://deepwiki.com/nrwl/nx/3.3-configuration-merging-and-target-defaults) - Third-party analysis of merge behavior

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH - All libraries already in workspace, no new dependencies
- Architecture (targetDefaults isolation): HIGH - Verified by reading Nx source code and tests, confirmed by live graph inspection
- Architecture (Windows build): MEDIUM - Env var approach is verified, but actual build success depends on nrwl/nx build chain behavior which needs empirical testing
- Pitfalls: HIGH - Catalogued from real data (live dependsOn inspection of 149 projects)

**Research date:** 2026-03-21
**Valid until:** 2026-04-21 (stable -- Nx 22.x targetDefaults merge behavior is well-established)
