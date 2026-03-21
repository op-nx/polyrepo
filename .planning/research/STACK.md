# Stack Research

**Domain:** Static dependency edges, proxy target caching, and temp directory rename for Nx polyrepo plugin
**Researched:** 2026-03-22
**Confidence:** HIGH

## Verdict: No New Dependencies, But Significant Nx Internal Constraints

The v1.2 features are implementable with the existing stack. No new npm packages required. However, two of the three features involve non-trivial interaction with Nx internals that constrain the implementation approach.

**Summary of findings:**
1. **Static edges:** Partially achievable. Host-source edges can use `DependencyType.static`. External-source edges MUST remain `DependencyType.implicit` due to Nx's `fileMap` validation.
2. **Proxy caching:** Fully achievable using `{ runtime: "..." }` inputs tied to child repo git HEAD, set per-target in `createNodesV2`.
3. **Temp directory rename:** Trivial. Change `.tmp` to `tmp` in the run executor.

## Feature 1: DependencyType.implicit to DependencyType.static Migration

### The Constraint: fileMap Validation

Nx 22.x validates static dependencies through `ProjectGraphBuilder.addDependency()`, which is called automatically when merging plugin-returned dependencies into the graph (line 225 of `build-project-graph.js`). The validation chain is:

```
addDependency()
  -> validateDependency()
    -> validateStaticDependency()    // requires sourceFile for internal project nodes
    -> validateCommonDependencyRules()  // validates sourceFile exists in fileMap
```

**`validateStaticDependency` (line 351-357):**
For internal project nodes (not `ProjectGraphExternalNode`), `sourceFile` is REQUIRED. Without it, Nx throws `"Source project file is required"`.

**`validateCommonDependencyRules` (line 328-335):**
When `sourceFile` is provided, Nx looks it up in:
1. `fileMap.projectFileMap[source]` -- files belonging to the source project
2. `fileMap.nonProjectFiles` -- workspace files not assigned to any project

If not found in either, Nx throws `"Source file "${sourceFile}" does not exist in the workspace."`.

**Why this blocks external-source edges:**
- `.repos/` is in `.gitignore` (and MUST remain so)
- Nx's native Rust file walker respects `.gitignore` when collecting workspace files
- Therefore, NO files under `.repos/<alias>/` exist in the `fileMap`
- External projects (registered via `createNodesV2` with root `.repos/<alias>/...`) have EMPTY `projectFileMap` entries
- `.nxignore` CANNOT override `.gitignore` to include files (confirmed by multiple Nx GitHub issues)

### Recommended Approach: Split by Edge Direction

| Edge Direction | Current Type | v1.2 Type | sourceFile | Why |
|---------------|-------------|-----------|------------|-----|
| Host -> External | implicit | **static** | Host project's `package.json` (in fileMap) | Host files ARE in fileMap; `package.json` is where the dependency is declared |
| External -> Host | implicit | **implicit** (keep) | N/A | External project files NOT in fileMap; no valid sourceFile |
| External -> External | implicit | **implicit** (keep) | N/A | Same reason as above |

**For host-source static edges**, the `sourceFile` should be the host project's `package.json` path relative to workspace root (e.g., `packages/my-app/package.json`). This file:
- IS tracked by git (not in `.gitignore`)
- IS in `fileMap.projectFileMap[hostProjectName]`
- IS semantically correct (the dependency IS declared in that `package.json`)

**For external-source edges**, alternatives were evaluated and rejected:

| Alternative | Why Rejected |
|-------------|-------------|
| Create tracked marker files outside `.repos/` | Files would be in `nonProjectFiles`, not in source project's `fileMap`. Validation at line 377 falls back to `nonProjectFiles`, which would work technically BUT: the file is semantically unrelated to the source project, and maintaining these files adds complexity for marginal benefit. |
| Use `.nxignore` negation to include `.repos/` files | `.nxignore` cannot override `.gitignore`. This is a known Nx limitation (GitHub issues #6821, #20945). |
| Remove `.repos/` from `.gitignore` | Would commit entire cloned repos to git. Unacceptable. |
| Inject synthetic entries into `fileMap` | No plugin API for this. The `fileMap` in `CreateDependenciesContext` is `readonly`. |

### Implementation: Nx API Surface Used

| API | From | Purpose | Confidence |
|-----|------|---------|------------|
| `DependencyType.static` | `@nx/devkit` (22.5.4) | New edge type for host-source cross-repo deps | HIGH -- verified in source |
| `DependencyType.implicit` | `@nx/devkit` (22.5.4) | Retained for external-source cross-repo deps | HIGH -- already used |
| `RawProjectGraphDependency.sourceFile` | `@nx/devkit` (22.5.4) | Optional string, path relative to workspace root | HIGH -- verified in `.d.ts` |
| `CreateDependenciesContext.fileMap` | `@nx/devkit` (22.5.4) | Used for understanding which files are available (read-only) | HIGH -- verified in `.d.ts` |

**Exact type definitions (from `project-graph-builder.d.ts`):**

```typescript
export type StaticDependency = {
  source: string;
  target: string;
  sourceFile?: string;  // MUST be present for internal project nodes
  type: typeof DependencyType.static;
};

export type ImplicitDependency = {
  source: string;
  target: string;
  type: typeof DependencyType.implicit;
};
```

### Key Detail: sourceFile Lookup Path

The validation code in `getFileData` (line 371-379) does:
```javascript
return (
  getProjectFileData(source, sourceFile, fileMap) ??
  getNonProjectFileData(sourceFile, nonProjectFiles)
);
```

Where `getProjectFileData` checks `fileMap[source]` (the source project's file array). For a host project source, `fileMap[sourceProjectName]` will contain all tracked files under the host project's root, including `package.json`. The `sourceFile` string must match exactly: it's compared via `f.file === sourceFile` where `file` is the path relative to workspace root with forward slashes.

## Feature 2: Host-Level Proxy Caching with Runtime Inputs

### How Nx Runtime Inputs Work

Runtime inputs execute a shell command and use its stdout as part of the task hash. Key characteristics:

| Property | Value | Source |
|----------|-------|--------|
| Execution directory | Workspace root (always) | GitHub issue #20949 confirms `NX_PROJECT_ROOT` not available |
| Syntax | `{ "runtime": "command" }` | Nx docs: Inputs Reference |
| Per-target | Yes, can be set in target `inputs` array | Nx docs: Configure Inputs |
| Cross-platform | Must work on Windows, macOS, Linux | Nx docs: "ensure scripts work on any platform" |
| Token interpolation | NOT supported in `runtime` value | `{projectRoot}` works in fileset inputs, not runtime commands |
| Failure behavior | Undocumented; likely fails the hash computation | LOW confidence -- not verified in source |

### Recommended Approach: Per-Target Runtime Input

Since `createProxyTarget` in `transform.ts` already knows the `repoAlias`, we can construct the runtime command at registration time:

```typescript
function createProxyTarget(
  repoAlias: string,
  originalProject: string,
  targetName: string,
  rawTargetConfig: unknown,
): TargetConfiguration {
  return {
    executor: '@op-nx/polyrepo:run',
    options: { repoAlias, originalProject, targetName },
    inputs: [
      { runtime: `git -C .repos/${repoAlias} rev-parse HEAD` }
    ],
    cache: true,  // <-- was false
    // ... rest unchanged
  };
}
```

**Why `git -C .repos/<alias> rev-parse HEAD`:**
- `git -C <path>` runs git in the specified directory -- cross-platform (Windows, macOS, Linux)
- `rev-parse HEAD` outputs the current commit SHA (40 hex chars + newline)
- Changes when the child repo is synced to a new commit
- Stable within the same commit (deterministic hash)
- Fast: ~5ms on warm git cache

**Why NOT `git -C .repos/<alias> diff --stat HEAD`:**
- Includes uncommitted changes, which makes the hash non-deterministic between runs
- Slower than `rev-parse`

**Why NOT a custom Node.js script:**
- `git rev-parse HEAD` is simpler, faster, and cross-platform
- No script file to maintain

### Outputs Configuration

For caching to be useful, the proxy target needs `outputs` defined. However, proxy targets delegate to child repos whose outputs are within `.repos/<alias>/...`. Since `.repos/` is gitignored, Nx's output caching may not correctly restore these files.

**Recommended approach:** Cache only the terminal output (Nx caches this automatically). Do NOT define `outputs` on proxy targets. This provides "replay" caching -- if the same child repo commit has been run before, Nx replays the terminal output and reports success without re-executing.

If actual file output caching is needed (e.g., `dist/` from child builds), that's a future enhancement requiring output path rewriting.

### Key Detail: Named Inputs Override Interaction

External projects currently have `namedInputs` overridden to `{ default: [], production: [], ... }` in `createNodesV2` (line 129-135 of `index.ts`). This prevents the native task hasher from expanding file-based patterns against missing fileMap entries.

With `cache: true` and explicit `inputs: [{ runtime: "..." }]`, the task hasher will:
1. NOT expand `namedInputs` (inputs array is explicit, not referencing named inputs)
2. Execute the runtime command to get the git SHA
3. Hash the SHA as part of the task's computation hash

This is compatible with the existing `namedInputs` override -- the two don't interfere.

### Cross-Platform Considerations

| OS | `git -C .repos/<alias> rev-parse HEAD` | Notes |
|----|---------------------------------------|-------|
| Windows | Works | Git for Windows supports `-C` flag. Forward slashes work in git path arguments. |
| macOS | Works | Standard git. |
| Linux | Works | Standard git. |
| CI (no `.repos/` synced) | FAILS | Runtime command will fail if `.repos/<alias>` doesn't exist. This is acceptable: proxy targets shouldn't be cached in a CI where repos aren't synced. |

**Failure handling:** When the runtime command fails (non-zero exit), Nx's behavior is undocumented. Based on the Rust native hasher implementation pattern, it likely treats the hash as non-deterministic, effectively disabling caching for that run. This is the desired behavior: if `.repos/` isn't synced, don't cache.

## Feature 3: Rename .tmp to tmp in Child Repo Temp Directories

### Current State

In `executors/run/executor.ts` (lines 41-42):
```typescript
const repoTmpDir = normalizePath(join(repoPath, '.tmp'));
mkdirSync(join(repoPath, '.tmp'), { recursive: true });
```

### Change Required

Replace `.tmp` with `tmp`:
```typescript
const repoTmpDir = normalizePath(join(repoPath, 'tmp'));
mkdirSync(join(repoPath, 'tmp'), { recursive: true });
```

### Rationale

- `.tmp` is a dotfile convention suggesting a hidden/internal directory
- `tmp` aligns with Nx's own convention (workspace root uses `tmp/` for local registry, etc.)
- `.repos/` is already gitignored, so `tmp` inside it is also gitignored transitively
- No risk of collision: the directory is inside `.repos/<alias>/` which is fully controlled by the plugin

### No Stack Impact

This is a two-line string replacement. No new dependencies, no API changes, no Nx internal interaction.

## Existing Stack (Unchanged)

### Core Technologies

| Technology | Version | Purpose | Why Unchanged for v1.2 |
|------------|---------|---------|------------------------|
| Nx | ^22.5.4 | Plugin host, project graph | `DependencyType.static`, `runtime` inputs, `cache: true` all available in 22.x |
| @nx/devkit | ^22.5.4 | Plugin API | All needed types already exported: `DependencyType`, `RawProjectGraphDependency`, `TargetConfiguration` |
| TypeScript | ~5.9.x | Language | No new type requirements |
| Zod | ^4.0.0 (plugin) | Config validation | No schema changes needed for v1.2 features |
| Node.js | 24.x | Runtime | `fs.mkdirSync`, `path.join` already used |

### No New Libraries Needed

| Potential Addition | Why NOT to Add |
|-------------------|----------------|
| `simple-git` | The runtime input uses `git rev-parse HEAD` as a shell command string. No programmatic git API needed. |
| `execa` | Runtime inputs are shell command strings executed by Nx's native hasher, not by our code. |
| Any fileMap manipulation library | The `fileMap` in `CreateDependenciesContext` is readonly. No API exists to inject synthetic entries. |
| `validateDependency` (usage) | We already guard with `context.projects[dep.source] && context.projects[dep.target]`. Adding `validateDependency` would throw on missing projects -- we want silent skip. For static edges with `sourceFile`, the validation happens automatically in `addDependency`. |

## Integration Points for v1.2

### 1. detect.ts -- Edge Type Split

**Changes in `detectCrossRepoDependencies`:**
- Add `fileMap` parameter (from `CreateDependenciesContext`) to determine which projects have files in the fileMap
- For each edge, check if the SOURCE project has a `package.json` in `fileMap.projectFileMap[sourceName]`
- If yes: emit `DependencyType.static` with `sourceFile` set to the package.json path
- If no: emit `DependencyType.implicit` (current behavior)

**The check is simple:**
```typescript
function hasPackageJsonInFileMap(
  projectName: string,
  projectRoot: string,
  fileMap: FileMap,
): string | undefined {
  const pkgJsonPath = `${projectRoot}/package.json`;
  const projectFiles = fileMap.projectFileMap[projectName] ?? [];
  const found = projectFiles.find(f => f.file === pkgJsonPath);
  return found ? pkgJsonPath : undefined;
}
```

### 2. index.ts -- Pass fileMap to Detection

**Changes in `createDependencies`:**
- Pass `context.fileMap` to `detectCrossRepoDependencies`

### 3. transform.ts -- Enable Caching on Proxy Targets

**Changes in `createProxyTarget`:**
- Change `cache: false` to `cache: true`
- Change `inputs: []` to `inputs: [{ runtime: "git -C .repos/<repoAlias> rev-parse HEAD" }]`

### 4. executors/run/executor.ts -- Rename Directory

**Changes:**
- Replace `.tmp` with `tmp` (two occurrences)

### 5. index.ts -- Intra-repo Edge Type (Bonus)

Currently, intra-repo edges (line 206-215 of `index.ts`) also use `DependencyType.implicit`. These edges come from the external repo's own graph and could potentially be upgraded. However, the same fileMap constraint applies -- external project files aren't in the fileMap. Keep as `implicit`.

## What NOT to Change

| Do Not | Why |
|--------|-----|
| Add `.repos/` negation to `.nxignore` | `.nxignore` cannot override `.gitignore`. Nx limitation. |
| Remove `.repos/` from `.gitignore` | Would commit entire cloned repos to git. |
| Try to inject files into `fileMap` | No plugin API. The context is readonly. |
| Make ALL edges static | External-source edges have no valid `sourceFile`. Validation will throw at runtime. |
| Add `outputs` to proxy targets | `.repos/` is gitignored; Nx can't reliably cache/restore files there. Terminal output replay is sufficient for v1.2. |
| Bump Nx version | 22.5.4 has all needed APIs. |
| Add runtime input with `{projectRoot}` interpolation | Token interpolation is NOT supported in `runtime` input values. Use literal paths. |

## Version Compatibility

| Package | Current | Required for v1.2 | Notes |
|---------|---------|-------------------|-------|
| @nx/devkit | ^22.5.4 | ^22.5.4 (no change) | `DependencyType.static`, `StaticDependency.sourceFile`, runtime inputs all available |
| nx | ^22.5.4 | ^22.5.4 (no change) | `ProjectGraphBuilder.addDependency` validation unchanged since Nx 17+ |
| zod | ^4.0.0 | ^4.0.0 (no change) | No schema changes |
| git | any recent | any recent | `git -C <path> rev-parse HEAD` supported since git 1.8.5 (2013) |

## Installation

```bash
# No new packages to install for v1.2
# Existing dependencies cover all requirements
```

## Sources

- Nx source code: `node_modules/nx/src/project-graph/project-graph-builder.js` lines 304-379 -- `validateDependency`, `validateStaticDependency`, `getFileData` validation chain (HIGH confidence, verified in installed v22.5.4)
- Nx source code: `node_modules/nx/src/project-graph/build-project-graph.js` line 225 -- `builder.addDependency(dep.source, dep.target, dep.type, sourceFile)` confirms automatic validation (HIGH confidence)
- Nx source code: `node_modules/nx/src/project-graph/file-map-utils.js` lines 21-39 -- `createFileMap` uses `getAllFileDataInContext` which respects `.gitignore` (HIGH confidence)
- Nx source code: `node_modules/nx/src/config/project-graph.d.ts` -- `FileMap`, `FileData`, `DependencyType` type definitions (HIGH confidence)
- Nx source code: `node_modules/nx/src/project-graph/project-graph-builder.d.ts` -- `StaticDependency`, `ImplicitDependency` type definitions with JSDoc constraints (HIGH confidence)
- [Nx StaticDependency docs](https://nx.dev/docs/reference/devkit/StaticDependency) -- "sourceFile MUST be present unless source is ProjectGraphExternalNode" (MEDIUM confidence -- docs may lag source)
- [Nx Inputs Reference](https://nx.dev/docs/reference/inputs) -- runtime input syntax `{ "runtime": "command" }` (HIGH confidence)
- [Nx GitHub Issue #20949](https://github.com/nrwl/nx/issues/20949) -- confirms NX_PROJECT_ROOT not available in runtime inputs, commands run from workspace root (MEDIUM confidence)
- [Nx GitHub Issue #6821](https://github.com/nrwl/nx/issues/6821) -- confirms `.nxignore` cannot override `.gitignore` for file inclusion (MEDIUM confidence)
- [Nx .nxignore Reference](https://nx.dev/docs/reference/nxignore) -- `.nxignore` syntax and purpose (HIGH confidence)
- [Nx Extending Project Graph](https://nx.dev/docs/extending-nx/project-graph-plugins) -- `createDependencies` plugin API (HIGH confidence)
- Runtime verification: `DependencyType` enum values `{ static: "static", dynamic: "dynamic", implicit: "implicit" }` (HIGH confidence, verified via `node -e`)
- Runtime verification: Nx version 22.5.4, @nx/devkit version 22.5.4 (HIGH confidence)

---
*Stack research for: v1.2 static edges, proxy caching, and temp directory rename*
*Researched: 2026-03-22*
