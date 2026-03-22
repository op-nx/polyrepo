# Architecture Research: v1.2 Static Edges, Proxy Caching, and Temp Directory Rename

**Domain:** Nx plugin for synthetic monorepos -- hardening existing features in `@op-nx/polyrepo`
**Researched:** 2026-03-22
**Confidence:** HIGH

## Existing Architecture (v1.1 baseline)

```
nx.json plugin options (PolyrepoConfig)
        |
        v
+------------------+      +---------------------+
| Config + Validate|----->| Graph Extract        |
| (schema.ts,      |      | (extract.ts)         |
|  validate.ts)    |      | nx graph --print     |
+------------------+      | + TEMP=.repos/X/.tmp |
                           +---------------------+
                                    |
                                    v
                          +---------------------+
                          | Graph Transform      |
                          | (transform.ts)       |
                          | namespace, tags,     |
                          | proxy targets:       |
                          |   cache: false       |
                          |   inputs: []         |
                          +---------------------+
                                    |
                                    v
                          +---------------------+
                          | Graph Cache          |
                          | (cache.ts)           |
                          | memory + disk,       |
                          | hash: HEAD+dirty     |
                          +---------------------+
                                    |
                                    v
                          +---------------------+
                          | detect.ts            |
                          | Cross-repo deps      |
                          | DependencyType.      |
                          |   implicit (all)     |
                          +---------------------+
                                    |
                                    v
                          +---------------------+
                          | index.ts             |
                          | createNodesV2:       |
                          |   register projects  |
                          |   namedInputs: {}    |
                          | createDependencies:  |
                          |   intra + cross-repo |
                          +---------------------+
                                    |
                                    v
                          +---------------------+
                          | run/executor.ts      |
                          | Proxy executor       |
                          | TEMP=.repos/X/.tmp   |
                          | runCommandsImpl()    |
                          +---------------------+
```

### Key Existing Behaviors Targeted by v1.2

1. **Cross-repo edges use `DependencyType.implicit`** -- All auto-detected and override edges (detect.ts line 388, 508) use implicit type with no `sourceFile`. The v1.1 decision was deliberate: static edges require `sourceFile` and Nx validates that file exists in the fileMap, but `.repos/` is gitignored so files there are absent from the fileMap.

2. **Proxy targets have `cache: false` + `inputs: []`** -- In `createProxyTarget` (transform.ts line 122-123). Every `nx run` invocation spawns a child Node.js process, loads plugins, reads graph, checks child cache, runs target. Even warm-cache runs take several seconds per target due to bootstrap overhead.

3. **Temp directories use `.tmp`** -- Both `extract.ts` (line 91-92) and `run/executor.ts` (line 41-42) create `.repos/<alias>/.tmp/` for TEMP/TMP/TMPDIR isolation. This dotfile path requires explicit `.gitignore` entries in each synced repo. Nx workspaces already gitignore `tmp/` by default.

## v1.2 Changes: System Overview

```
                         FEATURE 3: TEMP RENAME
                          .tmp -> tmp
                                    |
                          +---------------------+
                          | Graph Extract        |
                          | extract.ts           |
                          | TEMP=.repos/X/tmp    |  <-- MODIFY (2 lines)
                          +---------------------+
                                    |
                                    v
                          +---------------------+
                          | Graph Transform      |
                          | transform.ts         |
                          | proxy targets:       |
                          |   cache: true        |  <-- MODIFY (Feature 2)
                          |   inputs: [runtime]  |  <-- MODIFY (Feature 2)
                          +---------------------+
                                    |
                                    v
                          +---------------------+
                          | detect.ts            |
                          | Cross-repo deps      |
                          | Auto-detected:       |
                          |   static + sourceFile|  <-- MODIFY (Feature 1)
                          | Host-sourced:        |
                          |   static + sourceFile|  <-- MODIFY (Feature 1)
                          | Overrides:           |
                          |   implicit (no file) |  <-- UNCHANGED
                          +---------------------+
                                    |
                                    v
                          +---------------------+
                          | run/executor.ts      |
                          | TEMP=.repos/X/tmp    |  <-- MODIFY (2 lines)
                          +---------------------+
```

## Feature 1: Static Dependency Edges

### Problem Analysis

Auto-detected cross-repo edges from package.json and tsconfig path analysis are semantically static -- they derive from analyzing specific source files. Using `DependencyType.implicit` loses provenance: `nx affected` cannot trace which file created the edge. Static edges carry a `sourceFile` pointing to the declaring file.

### Nx Validation of Static Edges (verified from source)

The `validateDependency` function in `nx/src/project-graph/project-graph-builder.js` enforces:

1. **`validateStaticDependency` (line 351-357):** If `projects[source]` exists (source is an internal project, not an external npm node), then `sourceFile` MUST be provided. Error: "Source project file is required".

2. **`validateCommonDependencyRules` (line 328-335):** If `sourceFile` is provided AND `projects[source]` exists, Nx calls `getFileData()` which looks up the file in `fileMap.projectFileMap[source]` and falls back to `fileMap.nonProjectFiles`. If NOT found in either, it throws "Source file does not exist in the workspace".

### Critical Constraint: .repos/ Files Not in FileMap

The `.repos/` directory is gitignored. Nx builds its fileMap from git-tracked files. Therefore:

- Files under `.repos/<alias>/...` are NOT in `fileMap.projectFileMap` or `fileMap.nonProjectFiles`
- A `sourceFile` pointing to `.repos/repo-a/packages/app/package.json` will FAIL validation

### Solution: Bifurcated Edge Types by Source Location

**External-sourced edges (source project in `.repos/`):**

- The source project is registered as a `projects` entry (via `createNodesV2`), NOT as an `externalNode`
- `sourceFile` pointing into `.repos/` would fail `getFileData()` validation
- MUST remain `DependencyType.implicit` -- no `sourceFile` required or validated

**Host-sourced edges (source project in host workspace):**

- The source project IS a standard host project
- `sourceFile` pointing to the host's `package.json` (e.g., `packages/my-app/package.json`) IS in the fileMap
- CAN use `DependencyType.static` with `sourceFile`

**Override edges (from `implicitDependencies` config):**

- No natural source file -- these are user-configured manual wiring
- MUST remain `DependencyType.implicit`

### Component Changes for Feature 1

| Component                 | File                              | Change                                                                                  |
| ------------------------- | --------------------------------- | --------------------------------------------------------------------------------------- |
| `detect.ts`               | `lib/graph/detect.ts`             | Bifurcate `maybeEmitEdge` into two code paths based on source location                  |
| `detect.ts`               | `lib/graph/detect.ts`             | Host-sourced: emit `DependencyType.static` + `sourceFile` pointing to host package.json |
| `detect.ts`               | `lib/graph/detect.ts`             | External-sourced: keep `DependencyType.implicit` (no sourceFile)                        |
| `detect.spec.ts`          | `lib/graph/detect.spec.ts`        | Update ~30 test assertions for edge types                                               |
| `index.spec.ts`           | `src/index.spec.ts`               | Update integration assertions                                                           |
| `cross-repo-deps.spec.ts` | `e2e/src/cross-repo-deps.spec.ts` | Update 3 e2e assertions                                                                 |

### Detailed detect.ts Changes

The current `maybeEmitEdge` function (lines 351-389) emits all edges as implicit. The change needs to:

1. Determine whether the source project is a host project or an external project
2. For host-sourced edges: compute the `sourceFile` relative path to the package.json
3. Emit the appropriate edge type

```typescript
// Current (v1.1)
function maybeEmitEdge(sourceName: string, depName: string): void {
  // ... lookup, cross-repo guard ...
  edges.push({
    source: sourceName,
    target: targetName,
    type: DependencyType.implicit,
  });
}

// Proposed (v1.2) -- bifurcated by source location
function maybeEmitEdge(
  sourceName: string,
  depName: string,
  sourceFile: string | undefined,
): void {
  // ... lookup, cross-repo guard ...
  const sourceRepo = projectToRepo.get(sourceName);

  if (sourceRepo === HOST_REPO_SENTINEL && sourceFile !== undefined) {
    // Host-sourced: static edge with sourceFile
    edges.push({
      source: sourceName,
      target: targetName,
      type: DependencyType.static,
      sourceFile,
    });
  } else {
    // External-sourced: implicit edge (no sourceFile)
    edges.push({
      source: sourceName,
      target: targetName,
      type: DependencyType.implicit,
    });
  }
}
```

The caller in section 3b (host project scanning, lines 409-438) already knows the package.json path. It constructs `pkgJsonPath = join(workspaceRoot, projectConfig.root, 'package.json')`. The relative sourceFile is `join(projectConfig.root, 'package.json')` with forward-slash normalization.

The caller in section 3a (external node scanning, lines 394-406) passes `undefined` for sourceFile since `.repos/` paths are not in the fileMap.

### Risk Assessment

**LOW risk.** The change is a data value change (DependencyType constant + optional field), not a control flow change. The v1.1 architecture already has separate code paths for external-sourced (section 3a) and host-sourced (section 3b) scanning. The bifurcation aligns naturally with the existing code structure.

**Caveat: tsconfig-alias-sourced edges.** The current detect.ts does not emit edges from tsconfig path alias detection with a specific sourceFile. Tsconfig aliases are expanded into the lookup map (step 1c/1d) and resolved during the same maybeEmitEdge calls. For host-sourced edges triggered via tsconfig alias (not package.json dep), the sourceFile should point to `tsconfig.base.json` or `tsconfig.json` in the project root. However, the current code does not track which lookup mechanism triggered the edge. Simplest approach: host-sourced edges from the package.json scanning path (section 3b) get the package.json as sourceFile. The tsconfig path aliases feed the lookup map but do not generate edges directly -- they make the maybeEmitEdge lookup succeed. So the sourceFile is always the package.json of the source project (where the dependency is declared).

## Feature 2: Host-Level Proxy Caching via Runtime Inputs

### Problem Analysis

Proxy targets set `cache: false` and `inputs: []`. Every invocation spawns a child Nx process (~2-5s overhead even on warm cache). With 8 proxy tasks in a dependency chain, the overhead compounds significantly.

### Solution: Runtime Input Tied to Git State

Change `createProxyTarget` (transform.ts) to set:

- `cache: true`
- `inputs: [{ runtime: "<command that outputs repo git state>" }]`

Nx executes the runtime command, hashes its stdout, and uses it as the cache key. When the child repo's git state is unchanged, the host cache hits and skips the proxy invocation entirely.

### Runtime Input Command Design

**Recommended: Compound HEAD + diff hash**

The runtime input needs to capture two things:

1. The commit SHA (changes after `polyrepo-sync`)
2. Uncommitted changes (users editing files in `.repos/<alias>/`)

Single-command approach using shell compound:

```
git -C .repos/<alias> rev-parse HEAD && git -C .repos/<alias> diff HEAD
```

Nx hashes the full stdout. When HEAD is the same and no uncommitted changes exist, the output is identical and the cache hits.

**Cross-platform verification:**

- `git -C <path>` works on Windows (Git for Windows), Linux, macOS
- Nx executes runtime inputs via the shell, so no `.cmd` shim issues
- Forward slashes in `.repos/<alias>` work on all platforms in git commands

### Component Changes for Feature 2

| Component           | File                          | Change                                                          |
| ------------------- | ----------------------------- | --------------------------------------------------------------- |
| `transform.ts`      | `lib/graph/transform.ts`      | Change `createProxyTarget`: `cache: true`, add runtime input    |
| `transform.spec.ts` | `lib/graph/transform.spec.ts` | Update test: cache false -> true, verify inputs contain runtime |

### Detailed transform.ts Changes

```typescript
// Current (v1.1)
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
    // ...
  };
}

// Proposed (v1.2)
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
    inputs: [
      {
        runtime: `git -C .repos/${repoAlias} rev-parse HEAD && git -C .repos/${repoAlias} diff HEAD`,
      },
    ],
    cache: true,
    // ...
  };
}
```

### Interaction with namedInputs Override

In `createNodesV2` (index.ts lines 129-135), all workspace-level named inputs are overridden to `[]` on external projects. This prevents the native task hasher from generating `ProjectFileSet` hash instructions for external projects whose files are absent from the fileMap.

With `cache: true` and explicit `inputs: [{ runtime: ... }]`, the task hasher uses ONLY the declared inputs -- it does not expand named inputs for the task itself. The `namedInputs` override on external projects is for dependency traversal (`^production` etc.), not for the project's own task inputs. These two mechanisms are orthogonal and do not conflict.

### Risk Assessment

**LOW risk** for the transform.ts change itself (3 lines). **MEDIUM risk** for behavioral correctness: the compound runtime input must reliably capture all state changes. Edge cases:

1. **Scorched earth (`rm -rf .repos/X/dist`):** Git HEAD unchanged, cache hits, but child outputs are gone. Mitigation: `polyrepo-sync` is already the recovery path (clears stale child cache via `rmSync` in `tryInstallDeps`). Documented as expected behavior.

2. **Untracked files:** `git diff HEAD` only captures tracked file changes. New untracked files (not `git add`ed) are invisible. This is acceptable because untracked files in `.repos/` are typically build artifacts, not source changes.

3. **Runtime input failure:** If git is not installed or `.repos/<alias>` does not exist, the runtime command fails. Nx treats failed runtime inputs as cache misses (re-runs the task). This is correct behavior -- the proxy executor will also handle the missing repo gracefully.

## Feature 3: Temp Directory Rename (.tmp -> tmp)

### Problem Analysis

The proxy executor and graph extraction create per-repo temp directories at `.repos/<alias>/.tmp/`. This dotfile path is not covered by the standard Nx `.gitignore` template, which includes `tmp/` but not `.tmp/`. Users must manually add `.tmp` to each synced repo's `.gitignore` to avoid noise.

### Solution: Rename to `tmp`

Change the path from `.tmp` to `tmp` in two locations:

1. `run/executor.ts` lines 41-42
2. `extract.ts` lines 91-92

### Component Changes for Feature 3

| Component          | File                                 | Change                        |
| ------------------ | ------------------------------------ | ----------------------------- |
| `extract.ts`       | `lib/graph/extract.ts`               | Lines 91-92: `.tmp` -> `tmp`  |
| `run/executor.ts`  | `lib/executors/run/executor.ts`      | Lines 41-42: `.tmp` -> `tmp`  |
| `extract.spec.ts`  | `lib/graph/extract.spec.ts`          | Update path assertions if any |
| `executor.spec.ts` | `lib/executors/run/executor.spec.ts` | Update path assertions if any |

### Detailed Changes

```typescript
// extract.ts -- Current
const repoTmpDir = normalizePath(join(repoPath, '.tmp'));
mkdirSync(join(repoPath, '.tmp'), { recursive: true });

// extract.ts -- Proposed
const repoTmpDir = normalizePath(join(repoPath, 'tmp'));
mkdirSync(join(repoPath, 'tmp'), { recursive: true });
```

```typescript
// run/executor.ts -- Current
const repoTmpDir = normalizePath(join(repoPath, '.tmp'));
mkdirSync(join(repoPath, '.tmp'), { recursive: true });

// run/executor.ts -- Proposed
const repoTmpDir = normalizePath(join(repoPath, 'tmp'));
mkdirSync(join(repoPath, 'tmp'), { recursive: true });
```

### Risk Assessment

**NEGLIGIBLE risk.** Two-line path rename per file. No behavioral change. The directory is created fresh with `mkdirSync({ recursive: true })` on each invocation. Old `.tmp` directories in already-synced repos become orphaned but harmless.

## New vs Modified Components Summary

| Component                 | Status | File                                 | Feature       | Lines Changed                       |
| ------------------------- | ------ | ------------------------------------ | ------------- | ----------------------------------- |
| `detect.ts`               | MODIFY | `lib/graph/detect.ts`                | Static edges  | ~20 lines (bifurcate maybeEmitEdge) |
| `detect.spec.ts`          | MODIFY | `lib/graph/detect.spec.ts`           | Static edges  | ~30 assertions                      |
| `transform.ts`            | MODIFY | `lib/graph/transform.ts`             | Proxy caching | ~5 lines (cache + inputs)           |
| `transform.spec.ts`       | MODIFY | `lib/graph/transform.spec.ts`        | Proxy caching | ~5 assertions                       |
| `extract.ts`              | MODIFY | `lib/graph/extract.ts`               | Temp rename   | 2 lines                             |
| `extract.spec.ts`         | MODIFY | `lib/graph/extract.spec.ts`          | Temp rename   | Path assertions                     |
| `run/executor.ts`         | MODIFY | `lib/executors/run/executor.ts`      | Temp rename   | 2 lines                             |
| `run/executor.spec.ts`    | MODIFY | `lib/executors/run/executor.spec.ts` | Temp rename   | Path assertions                     |
| `index.spec.ts`           | MODIFY | `src/index.spec.ts`                  | Static edges  | Edge type assertions                |
| `cross-repo-deps.spec.ts` | MODIFY | `e2e/src/cross-repo-deps.spec.ts`    | Static edges  | Edge type assertions                |

**No new files created.** All three features modify existing components only.

## Data Flow Changes

### Before (v1.1)

```
detect.ts:
  External-sourced edges -> DependencyType.implicit (no sourceFile)
  Host-sourced edges     -> DependencyType.implicit (no sourceFile)
  Override edges         -> DependencyType.implicit (no sourceFile)

transform.ts:
  Proxy targets -> cache: false, inputs: []

extract.ts + run/executor.ts:
  Temp dir -> .repos/<alias>/.tmp/
```

### After (v1.2)

```
detect.ts:
  External-sourced edges -> DependencyType.implicit (no sourceFile)  [UNCHANGED]
  Host-sourced edges     -> DependencyType.static + sourceFile       [CHANGED]
  Override edges         -> DependencyType.implicit (no sourceFile)  [UNCHANGED]

transform.ts:
  Proxy targets -> cache: true, inputs: [{ runtime: "git -C ..." }] [CHANGED]

extract.ts + run/executor.ts:
  Temp dir -> .repos/<alias>/tmp/                                    [CHANGED]
```

## Architectural Patterns

### Pattern 1: Bifurcated Edge Types by Source Location

**What:** Emit different `DependencyType` values depending on whether the source project is a host workspace project (fileMap-tracked) or an external project (.repos/, not in fileMap).

**When to use:** Any time Nx validation constraints differ based on project location. The Nx `validateStaticDependency` function requires `sourceFile` for internal projects and validates it against the fileMap. External projects under `.repos/` cannot satisfy this constraint.

**Trade-offs:**

- PRO: Host-sourced edges gain provenance (sourceFile) for `nx affected` tracing
- PRO: External-sourced edges avoid validation errors
- CON: Two edge types in the same detection function -- slightly more complex
- Mitigation: The existing code already has separate scanning loops (3a for external, 3b for host), so the bifurcation aligns naturally

### Pattern 2: Runtime Inputs for External State Tracking

**What:** Use Nx runtime inputs (`{ runtime: "command" }`) to capture external state (git HEAD + working tree diff) that the native file-based hasher cannot see.

**When to use:** When the task's correctness depends on state outside the host workspace's git-tracked files. The `.repos/` directory is gitignored, so Nx's file-based hashing sees nothing there. Runtime inputs bridge this gap.

**Trade-offs:**

- PRO: Eliminates child Nx bootstrap overhead on warm runs (~2-5s per target)
- PRO: Correct invalidation on sync (new HEAD) and local edits (diff changes)
- CON: Runtime command adds ~12ms per target to hash computation
- CON: Untracked files invisible to `git diff HEAD`
- Acceptable: 12ms is negligible vs 2-5s bootstrap. Untracked files are typically build artifacts.

### Pattern 3: Convention-Based Gitignore Coverage

**What:** Use directory names that match existing `.gitignore` conventions rather than inventing new dotfile names.

**When to use:** When creating auxiliary directories in external repositories that you do not control. Nx's `create-nx-workspace` scaffold includes `tmp/` in `.gitignore`. Using `tmp/` instead of `.tmp/` gets free coverage.

**Trade-offs:**

- PRO: Zero configuration needed in synced repos
- PRO: Follows Nx conventions
- CON: `tmp/` is less visually distinctive than `.tmp/`
- Negligible: The directory is an implementation detail, not user-facing

## Anti-Patterns to Avoid

### Anti-Pattern 1: Static Edges for External-Sourced Dependencies

**What people do:** Use `DependencyType.static` with `sourceFile` pointing to `.repos/<alias>/packages/app/package.json` for all cross-repo edges.
**Why it's wrong:** Nx validates that `sourceFile` exists in `fileMap.projectFileMap` or `fileMap.nonProjectFiles`. Files under `.repos/` are gitignored and not in either map. The `validateCommonDependencyRules` function (line 329-334) will throw "Source file does not exist in the workspace".
**Do this instead:** Use `DependencyType.implicit` for external-sourced edges (source in `.repos/`). Only use `DependencyType.static` for host-sourced edges where the `sourceFile` (e.g., `packages/my-app/package.json`) is git-tracked.

### Anti-Pattern 2: File-Based Inputs for Proxy Targets

**What people do:** Set `inputs: ["{projectRoot}/**/*"]` or similar file-based patterns on proxy targets.
**Why it's wrong:** External project roots are under `.repos/`, which is gitignored. Nx's file-based input expansion uses the fileMap, which does not include gitignored files. File-based inputs would resolve to nothing, producing a constant hash that never invalidates.
**Do this instead:** Use `{ runtime: "git -C .repos/<alias> ..." }` to capture external state via git commands that operate independently of the host workspace's fileMap.

### Anti-Pattern 3: Single Runtime Input with Only HEAD SHA

**What people do:** Use `{ runtime: "git -C .repos/<alias> rev-parse HEAD" }` as the sole input.
**Why it's wrong:** This only tracks committed state. Users editing files in `.repos/<alias>/` (a common workflow in synthetic monorepos) would see stale cache hits because HEAD did not change.
**Do this instead:** Compound input: `git -C .repos/<alias> rev-parse HEAD && git -C .repos/<alias> diff HEAD`. The diff component captures uncommitted tracked-file changes.

## Dependency Graph Between Features

```
Feature 3: Temp Rename        Feature 2: Proxy Caching
(.tmp -> tmp)                  (cache: true + runtime)
  |                              |
  | independent                  | independent
  v                              v
  extract.ts                     transform.ts
  run/executor.ts                transform.spec.ts
                                   |
                                   | Feature 2 changes the inputs[]
                                   | array that Feature 1's sourceFile
                                   | does NOT interact with (inputs
                                   | are per-target, sourceFile is
                                   | per-dependency-edge)
                                   |
                              Feature 1: Static Edges
                              (implicit -> static for host-sourced)
                                   |
                                   v
                                 detect.ts
                                 detect.spec.ts
                                 index.spec.ts
                                 cross-repo-deps.spec.ts (e2e)
```

**All three features are independent.** No code-level dependency between them. They can be built in any order or in parallel. The suggested build order below is based on risk and test surface area.

## Suggested Build Order

```
Phase 1: Temp directory rename (.tmp -> tmp)
  - 2-line change in extract.ts
  - 2-line change in run/executor.ts
  - Update test assertions
  - RISK: negligible
  - SIZE: ~30 minutes
  Rationale: Smallest, safest, clears the deck

Phase 2: Proxy caching (cache: true + runtime inputs)
  - ~5-line change in createProxyTarget (transform.ts)
  - Update transform.spec.ts assertions
  - Manual validation: run nx with warm cache, verify skip
  - RISK: low (behavioral change -- verify cache invalidation)
  - SIZE: ~1-2 hours
  Rationale: Medium risk, but self-contained in one function

Phase 3: Static dependency edges
  - ~20-line change in detect.ts (bifurcate maybeEmitEdge)
  - ~30 assertion updates in detect.spec.ts
  - Update index.spec.ts assertions
  - Update cross-repo-deps.spec.ts (e2e)
  - RISK: low (data value change, but large test surface)
  - SIZE: ~2-3 hours
  Rationale: Largest test surface, benefits from phases 1-2 being committed
```

**Phase ordering rationale:**

- Phase 1 first because it is trivial and unblocks a consistent naming convention before phases 2-3 touch the same files
- Phase 2 before phase 3 because proxy caching is isolated to `transform.ts` with no downstream test coupling, while static edges touch detect.ts + index.ts + e2e
- Phase 3 last because it has the widest blast radius (~30+ test assertions) and benefits from the other changes being stable

## Scaling Considerations

| Scale             | Architecture Impact                                                                                 |
| ----------------- | --------------------------------------------------------------------------------------------------- |
| 1-3 synced repos  | All features work as designed. Runtime input overhead is ~12ms \* number of targets                 |
| 5-10 synced repos | Runtime inputs scale linearly. ~50-100ms total for hash computation. Still negligible vs build time |
| 20+ synced repos  | Each repo's runtime input is independent. No cross-repo hash computation. Linear scaling holds      |

### First Bottleneck: Runtime Input Execution

At large scale, the compound `git rev-parse HEAD && git diff HEAD` command runs per-target (not per-repo). With 20 repos averaging 7.5 targets each = 150 runtime commands during hash computation. At ~12ms each, that is ~1.8s total. This is still much faster than the ~5s \* 150 = 750s of child Nx bootstraps without caching.

**Future optimization (not needed for v1.2):** Deduplicate runtime commands per-repo. All targets in the same repo share the same git state. Nx does not natively deduplicate runtime inputs, but the runtime command output is identical for all targets in the same repo, so Nx's internal runtime cache (keyed by command string) handles this automatically.

## Sources

- Nx project-graph-builder.js source (node_modules/nx/src/project-graph/project-graph-builder.js) -- `validateStaticDependency`, `validateCommonDependencyRules`, `getFileData` implementation verified at lines 304-379
- Nx project-graph-builder.d.ts (node_modules/nx/src/project-graph/project-graph-builder.d.ts) -- `StaticDependency` type: "sourceFile MUST be present unless the source is the name of a ProjectGraphExternalNode"
- Nx build-project-graph.js (node_modules/nx/src/project-graph/build-project-graph.js) -- line 225 confirms `addDependency` is called with sourceFile from createDependencies return
- [Inputs and Named Inputs | Nx](https://nx.dev/docs/reference/inputs) -- runtime input format and execution semantics
- [Configure Inputs for Task Caching | Nx](https://nx.dev/docs/guides/tasks--caching/configure-inputs) -- runtime input documentation
- Existing v1.1 source code in `packages/op-nx-polyrepo/src/` -- baseline architecture, current implementations
- Todo files in `.planning/todos/pending/` -- feature specifications and design decisions

---

_Architecture research for: v1.2 static edges, proxy caching, and temp directory rename_
_Researched: 2026-03-22_
