# Architecture Research: Cross-repo Dependency Detection and Manual Overrides

**Domain:** Nx plugin for synthetic monorepos -- extending v1.0 graph pipeline with cross-repo dependency edges
**Researched:** 2026-03-17
**Confidence:** HIGH

## Existing Architecture (v1.0 baseline)

Understanding the current system is essential before describing where new components integrate.

```
nx.json plugin options (PolyrepoConfig)
        |
        v
+------------------+      +---------------------+
| Config + Validate|----->| Graph Extract        |
| (schema.ts,      |      | (extract.ts)         |
|  validate.ts)    |      | nx graph --print     |
+------------------+      +---------------------+
                                    |
                                    v
                          +---------------------+
                          | Graph Transform      |
                          | (transform.ts)       |
                          | namespace, tags,     |
                          | proxy targets        |
                          +---------------------+
                                    |
                                    v
                          +---------------------+
                          | Graph Cache          |
                          | (cache.ts)           |
                          | memory + disk,       |
                          | hash invalidation    |
                          +---------------------+
                                    |
                                    v
                          +---------------------+
                          | index.ts             |
                          | createNodesV2:       |
                          |   registers projects |
                          | createDependencies:  |
                          |   intra-repo edges   |
                          +---------------------+
                                    |
                                    v
                          Host workspace project graph
```

### Key Existing Data Structures

**PolyrepoConfig** (Zod schema in `schema.ts`):
```typescript
{ repos: Record<string, string | RemoteRepoObject | LocalRepoObject> }
```

**PolyrepoGraphReport** (in `types.ts`):
```typescript
{
  repos: Record<string, {
    nodes: Record<string, TransformedNode>;
    dependencies: Array<{ source: string; target: string; type: string }>;
  }>;
}
```

**createDependencies** (in `index.ts`): Iterates `report.repos[*].dependencies` and emits `DependencyType.implicit` edges, filtering to only edges where both source and target exist in `context.projects`.

### Current Limitation

Today, `createDependencies` only emits **intra-repo** edges (dependencies extracted from each child repo's own graph). If repo-a's project depends on a package published by repo-b, that cross-repo edge does not exist because each repo's `nx graph --print` only knows about its own projects.

## New Components for v1.1

### System Overview with New Components

```
nx.json plugin options (PolyrepoConfig v1.1)
        |                          |
        v                          v
+------------------+      +-----------------------+
| Config + Validate|      | NEW: dependencyOverrides
| (schema.ts v1.1) |      |   from config schema  |
+--------+---------+      +-----------+-----------+
         |                            |
         v                            |
+---------------------+               |
| Graph Extract       |               |
| (extract.ts)        |               |
| + NEW: package.json |               |
|   name extraction   |               |
+---------------------+               |
         |                            |
         v                            |
+---------------------+               |
| Graph Transform     |               |
| (transform.ts)      |               |
| + NEW: packageName  |               |
|   on TransformedNode|               |
+---------------------+               |
         |                            |
         v                            |
+---------------------+               |
| Graph Cache         |               |
| (cache.ts)          |               |
| unchanged           |               |
+---------------------+               |
         |                            |
         v                            v
+-----------------------------------------------+
| NEW: detect.ts (cross-repo dep detection)     |
| - Build package-name-to-project lookup        |
| - Read each project's package.json deps       |
| - Match against lookup for auto-detection     |
| - Merge with explicit overrides from config   |
| - Emit RawProjectGraphDependency[] edges      |
+-----------------------------------------------+
         |
         v
+---------------------+
| index.ts            |
| createNodesV2:      |
|   unchanged         |
| createDependencies: |
|   intra-repo edges  |
|   + cross-repo edges|  <-- NEW
|   + override edges  |  <-- NEW
+---------------------+
         |
         v
Host workspace project graph
```

### New vs Modified Components

| Component | Status | File | Change Description |
|-----------|--------|------|--------------------|
| `schema.ts` | **MODIFY** | `lib/config/schema.ts` | Add `dependencyOverrides` field to `polyrepoConfigSchema` |
| `types.ts` | **MODIFY** | `lib/graph/types.ts` | Add `packageName` to `TransformedNode`, add `packageNames` to repo report |
| `extract.ts` | **MODIFY** | `lib/graph/extract.ts` | Extract `package.json` `name` field per project during graph extraction |
| `transform.ts` | **MODIFY** | `lib/graph/transform.ts` | Pass through `packageName` on `TransformedNode` |
| `detect.ts` | **NEW** | `lib/graph/detect-cross-deps.ts` | Cross-repo dependency detection logic (auto + overrides) |
| `index.ts` | **MODIFY** | `src/index.ts` | Wire `detect-cross-deps` into `createDependencies` |
| `cache.ts` | **NO CHANGE** | `lib/graph/cache.ts` | Hash invalidation already covers config changes |

## Detailed Component Design

### 1. Config Schema Extension (`schema.ts`)

Add an optional `dependencyOverrides` field for explicit manual wiring:

```typescript
const dependencyOverride = z.object({
  source: z.string().min(1),  // namespaced project: "repo-a/my-app"
  target: z.string().min(1),  // namespaced project: "repo-b/shared-lib"
});

export const polyrepoConfigSchema = z.object({
  repos: z.record(/* ... existing ... */),
  dependencyOverrides: z.array(dependencyOverride).optional(),
});
```

**Config in nx.json would look like:**
```json
{
  "plugins": [{
    "plugin": "@op-nx/polyrepo",
    "options": {
      "repos": {
        "frontend": "git@github.com:org/frontend.git",
        "backend": "git@github.com:org/backend.git",
        "shared": "git@github.com:org/shared.git"
      },
      "dependencyOverrides": [
        { "source": "frontend/web-app", "target": "shared/api-types" },
        { "source": "backend/api", "target": "shared/api-types" }
      ]
    }
  }]
}
```

**Why this shape:**
- Uses namespaced project names (`repo/project`) consistent with how projects appear in the host graph.
- Array of explicit edges, not a map, because a single source can have multiple override targets.
- No `type` field -- overrides are always `DependencyType.implicit` (same as existing intra-repo edges, consistent with cross-repo semantics where no source file exists in the host workspace).

### 2. Package Name Extraction (`extract.ts` + `types.ts`)

**Problem:** The current `ExternalGraphJson` schema captures nodes from `nx graph --print`, but Nx's graph output does not include `package.json` `name` fields. We need package names to match against other repos' dependency lists.

**Solution:** Extend the extraction to also read each project's `package.json` and capture the `name` field.

Two approaches, recommend approach A:

**Approach A -- Post-extraction filesystem read (recommended):**
After `extractGraphFromRepo` returns the graph JSON, read `package.json` for each project node using the project's `root` path. This keeps `extract.ts` focused on graph extraction and adds a thin layer for package name lookup.

```typescript
// New function in extract.ts or a new file
async function readPackageNames(
  repoPath: string,
  nodes: Record<string, ExternalProjectNode>,
): Promise<Record<string, string>> {
  // Returns: { originalProjectName: packageJsonName }
  const result: Record<string, string> = {};

  for (const [name, node] of Object.entries(nodes)) {
    const pkgPath = join(repoPath, node.data.root, 'package.json');

    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));

      if (typeof pkg.name === 'string') {
        result[name] = pkg.name;
      }
    } catch {
      // No package.json or invalid -- skip (not all projects are npm packages)
    }
  }

  return result;
}
```

**Why not Approach B (modify the nx graph --print subprocess):** The `nx graph --print` output format is controlled by Nx, not by us. We cannot add fields to it. Shelling out a second command just for package names is wasteful when the files are on disk.

### 3. TransformedNode Extension (`types.ts`)

```typescript
export interface TransformedNode {
  name: string;
  root: string;
  projectType?: string;
  sourceRoot?: string;
  targets: Record<string, TargetConfiguration>;
  tags: string[];
  metadata?: Record<string, unknown>;
  packageName?: string;  // NEW: npm package name from package.json
}
```

The `PolyrepoGraphReport` type gains a package name map per repo:

```typescript
export interface PolyrepoGraphReport {
  repos: Record<string, {
    nodes: Record<string, TransformedNode>;
    dependencies: Array<{ source: string; target: string; type: string }>;
    packageNames: Record<string, string>;  // NEW: namespacedProject -> npmPackageName
  }>;
}
```

### 4. Cross-repo Dependency Detection (`detect-cross-deps.ts`) -- NEW FILE

This is the core new logic. It is a pure function with no side effects, making it easily testable with SIFERS.

```typescript
import type { RawProjectGraphDependency } from '@nx/devkit';
import { DependencyType } from '@nx/devkit';
import type { PolyrepoGraphReport } from './types';
import type { PolyrepoConfig } from '../config/schema';

interface CrossDepDetectionContext {
  /** All projects currently in the host graph (for existence checks) */
  projectNames: Set<string>;
}

/**
 * Detect cross-repo dependencies by matching npm package names
 * against dependency declarations in each project's package.json.
 *
 * Also merges explicit dependency overrides from config.
 */
export function detectCrossRepoDependencies(
  report: PolyrepoGraphReport,
  config: PolyrepoConfig,
  context: CrossDepDetectionContext,
): RawProjectGraphDependency[] {
  const dependencies: RawProjectGraphDependency[] = [];

  // Step 1: Build reverse lookup: npmPackageName -> namespacedProjectName
  const packageToProject = new Map<string, string>();

  for (const [, repoData] of Object.entries(report.repos)) {
    for (const [namespacedName, npmName] of Object.entries(repoData.packageNames)) {
      packageToProject.set(npmName, namespacedName);
    }
  }

  // Step 2: For each project, check if its package.json deps reference
  // a package name that maps to a project in another repo
  for (const [, repoData] of Object.entries(report.repos)) {
    for (const [namespacedName, node] of Object.entries(repoData.nodes)) {
      // node.packageDependencies would be read during extraction
      // Match against packageToProject lookup
      // Only emit if source and target are in DIFFERENT repos
      // Only emit if both exist in context.projectNames
    }
  }

  // Step 3: Merge explicit overrides
  for (const override of config.dependencyOverrides ?? []) {
    if (context.projectNames.has(override.source) && context.projectNames.has(override.target)) {
      dependencies.push({
        source: override.source,
        target: override.target,
        type: DependencyType.implicit,
      });
    }
  }

  return dependencies;
}
```

**Key design decisions:**
- **Pure function:** Takes report + config + context, returns edges. No module-level state. No filesystem access.
- **Same-repo edges excluded:** Cross-repo detection only matches dependencies where source and target are in different repos. Intra-repo edges are already handled by the existing `createDependencies` loop.
- **Overrides are additive:** They do not replace auto-detected edges. They add edges that auto-detection cannot find (e.g., non-npm dependencies like shared proto files, API contracts).
- **Existence guard:** Same pattern as existing code -- only emit edges where both projects exist in the host graph.

### 5. Integration into `createDependencies` (`index.ts`)

The existing `createDependencies` function gains one additional call:

```typescript
export const createDependencies: CreateDependencies<PolyrepoConfig> = async (
  options, context,
) => {
  const dependencies: RawProjectGraphDependency[] = [];

  let report: PolyrepoGraphReport | undefined;

  try {
    const config = validateConfig(options);
    const optionsHash = hashObject(options ?? {});
    report = await populateGraphReport(config, context.workspaceRoot, optionsHash);
  } catch {
    return dependencies;
  }

  // EXISTING: intra-repo edges
  for (const [, repoReport] of Object.entries(report.repos)) {
    for (const dep of repoReport.dependencies) {
      if (context.projects[dep.source] && context.projects[dep.target]) {
        dependencies.push({
          source: dep.source,
          target: dep.target,
          type: DependencyType.implicit,
        });
      }
    }
  }

  // NEW: cross-repo edges (auto-detected + overrides)
  const config = validateConfig(options);
  const crossRepoDeps = detectCrossRepoDependencies(
    report,
    config,
    { projectNames: new Set(Object.keys(context.projects)) },
  );
  dependencies.push(...crossRepoDeps);

  return dependencies;
};
```

### 6. Package.json Dependency Reading

To auto-detect cross-repo deps, we need each project's npm dependency list. Two options:

**Option A -- Read during extraction (in cache pipeline, recommended):**
Add package.json dependency reading alongside package name reading in the cache pipeline. This means the data is cached and does not require filesystem reads during `createDependencies`.

The `PolyrepoGraphReport` per-repo object would store:
```typescript
{
  nodes: Record<string, TransformedNode>;
  dependencies: Array<{ source: string; target: string; type: string }>;
  packageNames: Record<string, string>;           // NEW
  packageDependencies: Record<string, string[]>;   // NEW: namespacedProject -> [npmPackageName, ...]
}
```

**Option B -- Read during createDependencies (lazy):**
Read package.json files on-the-fly during `createDependencies`. Simpler but slower (filesystem reads on every uncached invocation) and breaks the pattern of keeping all IO in the cache pipeline.

**Recommendation:** Option A. It follows the existing pattern where all IO happens during `populateGraphReport` and the rest is pure transformation.

## Data Flow Summary

```
[Extraction Phase - in populateGraphReport]
  For each synced repo:
    1. extractGraphFromRepo(repoPath) -> ExternalGraphJson
    2. readPackageNames(repoPath, graph.nodes) -> Record<string, string>
    3. readPackageDependencies(repoPath, graph.nodes) -> Record<string, string[]>
    4. transformGraphForRepo(alias, graph, workspaceRoot) -> { nodes, dependencies }
    5. Attach packageNames + packageDependencies to report

[Dependency Phase - in createDependencies]
  1. populateGraphReport() -> PolyrepoGraphReport (from cache, fast)
  2. Emit intra-repo edges (existing loop)
  3. detectCrossRepoDependencies(report, config, context) -> cross-repo edges
     a. Build packageName -> namespacedProject lookup (all repos)
     b. For each project, match its packageDependencies against lookup
     c. Filter: different repos only, both exist in host graph
     d. Merge explicit overrides from config
  4. Return all edges
```

## Architectural Patterns

### Pattern 1: Package Name as Cross-repo Join Key

**What:** Use npm package names (from `package.json` `name` field) as the key to join dependencies across repos. If repo-a's project declares `"@org/shared-utils": "^1.0"` in its `package.json` and repo-b has a project whose `package.json` `name` is `"@org/shared-utils"`, emit an implicit dependency edge.

**When to use:** Always for auto-detection. This is the natural join key because npm packages are how JavaScript projects declare dependencies.

**Trade-offs:**
- PRO: Works without any user configuration
- PRO: Mirrors how Nx itself detects dependencies within a monorepo
- CON: Only works for projects that publish npm packages (not all projects have package.json)
- CON: Does not detect non-npm relationships (gRPC proto imports, shared API types via codegen)
- Mitigation: The `dependencyOverrides` feature covers the CON cases

### Pattern 2: Additive Override Merging

**What:** Explicit `dependencyOverrides` are additive -- they add edges that auto-detection does not find. They never remove auto-detected edges.

**When to use:** Always. If users need to suppress an auto-detected edge, they should fix the underlying package.json rather than adding a negation mechanism.

**Trade-offs:**
- PRO: Simple mental model -- overrides only add
- PRO: Auto-detected edges are always truthful (package.json is source of truth)
- CON: No way to suppress false positives from auto-detection
- Mitigation: False positives should be rare (requires exact package name match). If needed, a future `ignoreDependencies` field could be added.

### Pattern 3: Pure Detection Function

**What:** `detectCrossRepoDependencies` is a pure function: input data in, edges out. No filesystem reads, no module state, no side effects.

**When to use:** For all new dependency logic. Follows the existing SIFERS test pattern where test setup is explicit.

**Trade-offs:**
- PRO: Trivially testable with SIFERS
- PRO: No mocking filesystem or module state
- CON: Requires all data to be pre-loaded (package names, package deps)
- Mitigation: Data loading happens in the cache pipeline, which already handles IO

## Anti-Patterns to Avoid

### Anti-Pattern 1: Reading package.json in createDependencies

**What people do:** Open and parse package.json files inside `createDependencies` for each project.
**Why it's wrong:** `createDependencies` should be fast. Filesystem reads here bypass the cache layer and run on every uncached Nx command. The existing architecture puts all IO in `populateGraphReport`.
**Do this instead:** Read package names and dependency lists during the extraction phase in `cache.ts`, store them in the `PolyrepoGraphReport`, and use them as pure data in `createDependencies`.

### Anti-Pattern 2: Using DependencyType.static for Cross-repo Edges

**What people do:** Use `DependencyType.static` with a `sourceFile` pointing to the package.json.
**Why it's wrong:** Static dependencies are associated with a specific source file and are cached by Nx's file change tracking. Cross-repo package.json files are in `.repos/`, which is gitignored. Nx's file watcher will not track changes to these files. Using `static` would cause stale edges.
**Do this instead:** Use `DependencyType.implicit`. Implicit dependencies have no source file association and are recomputed every time `createDependencies` runs (which is correct -- they should be re-evaluated when the graph report changes).

### Anti-Pattern 3: Overrides That Reference Non-namespaced Project Names

**What people do:** Allow overrides like `{ source: "my-app", target: "shared-lib" }` without repo prefix.
**Why it's wrong:** Without namespacing, project name collisions across repos are ambiguous. "my-app" could exist in three repos.
**Do this instead:** Require fully namespaced names: `{ source: "frontend/my-app", target: "shared/shared-lib" }`. Validate that both names follow the `repo/project` pattern in the Zod schema.

### Anti-Pattern 4: Separate Cache for Cross-repo Dependencies

**What people do:** Create a new cache file or module-level variable for cross-repo dependency data.
**Why it's wrong:** The existing two-layer cache (`cache.ts`) already handles invalidation correctly. The hash includes plugin options (so adding `dependencyOverrides` changes the hash) and each repo's git state (so package.json changes trigger re-extraction).
**Do this instead:** Extend the existing `PolyrepoGraphReport` to include package name/dependency data. The existing cache handles the rest.

## Integration Points

### Internal Boundaries

| Boundary | Communication | Change for v1.1 |
|----------|---------------|-----------------|
| `schema.ts` -> `validate.ts` | Zod parse at plugin load | `dependencyOverrides` flows through existing validation |
| `cache.ts` -> `extract.ts` | `extractGraphFromRepo()` call | Add `readPackageNames()` + `readPackageDependencies()` calls |
| `cache.ts` -> `transform.ts` | `transformGraphForRepo()` call | `packageName` attached to each `TransformedNode` |
| `cache.ts` -> `types.ts` | `PolyrepoGraphReport` shape | Add `packageNames` + `packageDependencies` fields |
| `index.ts` -> `detect-cross-deps.ts` | NEW: `detectCrossRepoDependencies()` call | New integration point in `createDependencies` |
| `index.ts` -> `cache.ts` | `populateGraphReport()` | Unchanged -- report now contains richer data |

### Nx Plugin API Surface

| API | Usage in v1.1 |
|-----|---------------|
| `CreateDependencies<PolyrepoConfig>` | Return type unchanged; more edges returned |
| `RawProjectGraphDependency` | Used for both intra-repo and cross-repo edges |
| `DependencyType.implicit` | All cross-repo edges use implicit type |
| `CreateDependenciesContext.projects` | Existence check for both auto-detected and override edges |

## Suggested Build Order

The build order follows data flow dependencies. Each layer builds on the previous.

```
Phase 1: Schema extension
  - Add dependencyOverrides to polyrepoConfigSchema
  - Add Zod validation (source/target format, existence checks deferred to runtime)
  - Unit tests for new schema fields
  Depends on: nothing new

Phase 2: Package name/dependency extraction
  - Add packageName to TransformedNode
  - Add readPackageNames() function
  - Add readPackageDependencies() function
  - Extend PolyrepoGraphReport type with packageNames + packageDependencies
  - Wire into cache.ts extraction pipeline
  - Unit tests for package reading + transform passthrough
  Depends on: Phase 1 (for types), existing extract.ts + transform.ts

Phase 3: Cross-repo dependency detection
  - Create detect-cross-deps.ts (pure function)
  - Build package-to-project lookup from report
  - Match dependencies cross-repo
  - Merge explicit overrides
  - Unit tests for detection logic (SIFERS, no mocks needed)
  Depends on: Phase 2 (for report shape with package data)

Phase 4: Integration into createDependencies
  - Wire detectCrossRepoDependencies into index.ts createDependencies
  - Integration tests verifying end-to-end edge emission
  - Update existing createDependencies tests
  Depends on: Phase 3

Phase 5: E2E validation
  - Extend testcontainers e2e to verify cross-repo edges appear in nx graph
  - Test override edges
  - Test package.json auto-detection
  Depends on: Phase 4
```

**Phase ordering rationale:**
- Schema first because it defines the config contract that all other components depend on.
- Package extraction second because the detection function needs this data.
- Detection logic third as a pure function -- easiest to test in isolation before wiring.
- Integration fourth -- once the detection function works, wiring is mechanical.
- E2E last as a full-stack validation of all prior phases.

## Sources

- [Extending the Project Graph | Nx](https://nx.dev/docs/extending-nx/project-graph-plugins) -- createDependencies API, DependencyType, CreateDependenciesContext
- [Dependency Management Strategies | Nx](https://nx.dev/docs/concepts/decisions/dependency-management) -- per-project package.json patterns
- [@nx/dotnet source](https://github.com/nrwl/nx/tree/master/packages/dotnet) -- cross-project dependency mapping pattern via `referencesByRoot`
- [@nx/gradle source](https://github.com/nrwl/nx/tree/master/packages/gradle) -- module-level cache + shared report pattern
- Existing v1.0 source code in `packages/op-nx-polyrepo/src/` -- baseline architecture, patterns, conventions

---
*Architecture research for: v1.1 cross-repo dependency detection and manual overrides*
*Researched: 2026-03-17*
