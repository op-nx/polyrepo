# Architecture Patterns

**Domain:** Nx plugin for synthetic monorepos (polyrepo graph merging)
**Researched:** 2026-03-10

## Recommended Architecture

The plugin comprises five major components organized around a central data flow: external repo configuration flows through repo assembly, into per-repo graph extraction, through graph merging, and finally into the host Nx workspace's project graph.

```
nx.json plugin options
        |
        v
+------------------+      +---------------------+
| Repo Assembler   |----->| Graph Extractor     |
| (git clone/pull) |      | (per-repo nx graph) |
+------------------+      +---------------------+
                                    |
                                    v
                          +---------------------+
                          | Graph Merger        |
                          | (namespace + merge) |
                          +---------------------+
                                    |
                                    v
                          +---------------------+
                          | createNodes +       |
                          | createDependencies  |
                          | (Nx plugin API)     |
                          +---------------------+
                                    |
                                    v
                          Host workspace project graph
```

### Component Boundaries

| Component | Responsibility | Communicates With |
|-----------|---------------|-------------------|
| **Plugin Entry** (`src/index.ts`) | Exports `createNodes`, `createDependencies`, generators, executors. Thin barrel file per feature to avoid bundling unrelated code. | Nx runtime |
| **Repo Assembler** | Clones/pulls configured repos to a local assembly directory. Manages branch/commit/tag checkout. Detects staleness. | Git CLI, filesystem |
| **Graph Extractor** | Reads each synced repo's `nx.json` and runs Nx project graph construction against it. Produces a `ProjectGraph` per repo. | `@nx/devkit` (`createProjectGraphAsync`), synced repo filesystem |
| **Graph Merger** | Namespaces external projects (prefix with repo name), resolves cross-repo dependencies from `package.json` and explicit overrides, deduplicates external nodes (npm packages). | Graph Extractor output, host workspace graph context |
| **Project Graph Plugin** (`createNodes` + `createDependencies`) | Surfaces merged projects and cross-repo dependencies to the host Nx workspace graph via the official plugin API. | Nx project graph construction pipeline |
| **Sync Generator** | Keeps derived files (e.g., tsconfig paths for cross-repo imports) in sync with the merged graph. Runs via `nx sync`. | Nx sync infrastructure, merged graph |
| **Generators** | `init` generator for first-time setup; `add-repo` generator for adding new repos to config. | `nx.json`, filesystem |
| **Executors** | Optional: `assemble` executor to trigger repo assembly as an Nx target. May not be needed if assembly is implicit during graph construction. | Repo Assembler |

### Data Flow

**Phase 1: Configuration Reading**

1. Nx loads `nx.json` and finds the `nx-openpolyrepo` plugin entry with options.
2. Options contain an array of repo definitions: `{ url, branch?, path?, prefix? }`.
3. Options also specify the assembly directory (default: `.repos/`).

**Phase 2: Repo Assembly (on demand)**

1. For each configured repo, the Repo Assembler checks if the local clone exists.
2. If missing: `git clone --depth=1 --branch <branch> <url> <assembly-dir>/<repo-name>`.
3. If present: `git fetch origin <branch> && git checkout FETCH_HEAD` (or skip if cache is fresh).
4. Assembly is **not** triggered during every graph construction -- only when explicitly invoked or when the assembly cache is stale (configurable staleness threshold).

**Phase 3: Graph Extraction**

1. For each synced repo directory, the Graph Extractor constructs a project graph.
2. **Critical constraint**: Cannot call `createProjectGraphAsync` inside `createNodes`/`createDependencies` -- this causes infinite recursion (protected by `global.NX_GRAPH_CREATION` guard).
3. **Solution**: Use a lower-level approach. Read each repo's `nx.json`, enumerate its projects by scanning `project.json`/`package.json` files per the repo's workspaces config, and parse their configuration directly. This avoids invoking the full Nx graph pipeline recursively.
4. Alternative: Run graph extraction as a **pre-step** (during assembly or via sync generator), serialize each repo's graph to a JSON cache file (`.repos/<repo-name>/.nx-graph-cache.json`), and read the cached graphs during `createNodes`.

**Phase 4: Graph Merging**

1. Each external project is namespaced: `<repo-prefix>/<original-project-name>`.
2. Project roots are remapped: `<assembly-dir>/<repo-name>/<original-root>`.
3. Targets are preserved as-is (they reference paths relative to the project root, which still works after remapping the root).
4. Cross-repo dependencies are detected by:
   a. Matching `package.json` dependency names to project names across all repos.
   b. Reading explicit dependency overrides from plugin options.
5. External nodes (npm packages) are deduplicated across repos -- same package name keeps the version from the host workspace.

**Phase 5: Plugin API Integration**

1. `createNodes` returns the merged project configurations keyed by a sentinel file in each synced repo (e.g., `<assembly-dir>/<repo-name>/nx.json` as the glob pattern).
2. `createDependencies` returns cross-repo dependency edges as `CandidateDependency[]` with type `implicit` (since they are not file-associated within the host workspace).

**Phase 6: Sync Generator (optional, post-graph)**

1. A global sync generator reads the merged graph and updates host workspace files:
   - `tsconfig.base.json` path mappings for cross-repo TypeScript imports.
   - `.gitignore` entries for synced repos.
2. Registered in `nx.json` under `sync.globalGenerators`.

## Reference Plugins (Official Nx)

Three official Nx plugins follow the same architectural pattern we need: trigger on config files, shell out to an external tool for project discovery, cache results, and serve via `createNodesV2` + `createDependencies`. Source code inspected from a local clone of the `nrwl/nx` repo (available on this machine).

| Plugin | Glob trigger | External tool | Cache strategy | Key files |
|--------|-------------|---------------|----------------|-----------|
| `@nx/gradle` | `build.gradle*`, `settings.gradle*` | `gradlew nxProjectGraph` (custom Gradle task) | Module-level var + disk JSON with hash invalidation | `packages/gradle/src/plugin/nodes.ts`, `utils/get-project-graph-from-gradle-plugin.ts` |
| `@nx/maven` | `**/pom.xml` | `mvn nx-maven-plugin:analyze` (Kotlin plugin) | `PluginCache` + module-level `setCurrentMavenData()` | `packages/maven/src/plugins/nodes.ts`, `maven-analyzer.ts` |
| `@nx/dotnet` | `**/*.{csproj,fsproj,vbproj}` | C# MSBuild analyzer binary | `readCachedAnalysisResult()` shared between createNodes/createDependencies | `packages/dotnet/src/plugins/create-nodes.ts`, `create-dependencies.ts` |

**Shared pattern across all three:**
1. `createNodesV2` triggers on build system config files, delegates discovery to the native tool (subprocess), caches the result
2. `createDependencies` reads from a cache populated by `createNodesV2` — never re-runs analysis
3. Both functions share data via module-level variables or a shared cache utility
4. Each uses hash-based cache invalidation (hashing config files + plugin options)

**Key difference from our plugin:** These plugins integrate *one* external build system into an Nx workspace. Our plugin integrates *N* external Nx workspaces. The pattern is the same, applied per synced repo.

**`@nx/dotnet` relevance:** .NET solutions reference projects across directories via `<ProjectReference>` in `.csproj`, analogous to cross-repo dependencies. Its `create-dependencies.ts` maps source roots to target roots using `referencesByRoot` — our cross-repo dep detection follows a similar pattern but matches on `package.json` dependency names.

**None of these are polyrepo tools**, but they validate the "external tool + cached JSON + createNodesV2" architecture as the Nx-blessed approach for integrating non-JS build systems — and by extension, external Nx workspaces.

## Patterns to Follow

### Pattern 1: Separate Entry Points Per Feature

**What:** Each plugin feature (graph plugin, generators, executors, sync generators) gets its own entry point file rather than one barrel export.
**When:** Always. Nx compiles plugin code at runtime; a single barrel file forces loading all code even when only one feature is needed.
**Example:**
```typescript
// package.json
{
  "nx-migrations": {
    "migrations": "./src/migrations.json"
  },
  "generators": "./generators.json",
  "executors": "./executors.json"
}

// src/index.ts -- graph plugin entry (registered in nx.json plugins)
export { createNodes, createDependencies } from './graph/plugin';

// src/generators/init/generator.ts -- standalone entry
// src/generators/add-repo/generator.ts -- standalone entry
// src/sync/sync-generator.ts -- standalone entry
```

### Pattern 2: Cached Graph Extraction

**What:** Serialize each external repo's project graph to a JSON file during assembly. Read cached JSON during `createNodes` instead of running full graph construction.
**When:** Always -- avoids the `createProjectGraphAsync` recursion problem and keeps graph construction fast.
**Example:**
```typescript
// During assembly (executor or pre-step)
import { execSync } from 'child_process';

function extractAndCacheGraph(repoDir: string): void {
  // Run nx graph in the synced repo as a subprocess
  const result = execSync('npx nx graph --file=.nx-graph-cache.json', {
    cwd: repoDir,
    env: { ...process.env, NX_DAEMON: 'false' },
  });
}

// During createNodes (plugin)
function readCachedGraph(repoDir: string): ProjectGraph {
  const cachePath = join(repoDir, '.nx-graph-cache.json');
  return JSON.parse(readFileSync(cachePath, 'utf-8'));
}
```

### Pattern 3: Namespace Prefixing

**What:** Prefix all external repo projects with the repo name to avoid name collisions.
**When:** Always when viewing from the host workspace. Projects keep original names when working within their own repo.
**Example:**
```typescript
function namespaceProject(
  repoPrefix: string,
  projectName: string,
  config: ProjectConfiguration
): [string, ProjectConfiguration] {
  return [
    `${repoPrefix}/${projectName}`,
    {
      ...config,
      root: `${assemblyDir}/${repoPrefix}/${config.root}`,
      tags: [...(config.tags ?? []), `repo:${repoPrefix}`],
    },
  ];
}
```

### Pattern 4: Dependency Detection via Package Name Matching

**What:** Match `package.json` dependency entries against known project package names across all synced repos to auto-wire cross-repo dependency edges.
**When:** For detecting implicit cross-repo dependencies without manual configuration.
**Example:**
```typescript
function detectCrossRepoDependencies(
  allProjects: Map<string, { packageName: string; repoPrefix: string }>,
  projectDeps: Record<string, string[]>
): CandidateDependency[] {
  const packageToProject = new Map<string, string>();

  for (const [projectName, info] of allProjects) {
    packageToProject.set(info.packageName, projectName);
  }

  const dependencies: CandidateDependency[] = [];

  for (const [projectName, deps] of Object.entries(projectDeps)) {
    for (const dep of deps) {
      const target = packageToProject.get(dep);

      if (target && target !== projectName) {
        dependencies.push({
          source: projectName,
          target,
          type: DependencyType.implicit,
        });
      }
    }
  }

  return dependencies;
}
```

## Anti-Patterns to Avoid

### Anti-Pattern 1: Calling createProjectGraphAsync Inside createNodes

**What:** Attempting to construct a child workspace's project graph by calling `createProjectGraphAsync` during the host workspace's graph construction.
**Why bad:** Triggers infinite recursion. Nx guards against this with `global.NX_GRAPH_CREATION`. The call will either hang or throw.
**Instead:** Extract graphs as a pre-step (subprocess, cached JSON) or parse project configs directly from the filesystem without invoking the Nx graph pipeline.

### Anti-Pattern 2: Re-running Assembly During Every Graph Construction

**What:** Cloning or pulling repos every time `createNodes` is called.
**Why bad:** Graph construction happens frequently (every `nx` command). Git operations add seconds to every invocation. The Nx daemon caches plugin results, but cold starts would be severely impacted.
**Instead:** Assembly is an explicit step (generator, executor, or sync generator). Graph plugin reads from the synced directory assuming it exists. Staleness checks use filesystem timestamps, not git fetch.

### Anti-Pattern 3: Deep-Merging Target Configurations

**What:** Attempting to deeply merge target options when host and external repos define the same target name.
**Why bad:** Nx's own merging is shallow. Deep merging creates unpredictable behavior and diverges from Nx conventions. Overwritten targets cause silent behavior changes.
**Instead:** External repo targets are preserved as-is under namespaced project names. No target-level merging across repos.

### Anti-Pattern 4: Single Barrel File for All Plugin Features

**What:** Exporting generators, executors, graph plugin, and sync generators from one `index.ts`.
**Why bad:** Nx compiles the entire plugin at runtime. Importing git/child_process utilities when only generators are needed wastes startup time and may cause issues in constrained environments.
**Instead:** Separate entry points per feature type. The `package.json` points to different files for generators, executors, and the plugin entry.

## Component Dependency Graph (Build Order)

Build order reflects internal dependencies between components:

```
Layer 0 (no deps):
  - Config types/schemas (shared interfaces for repo definitions, plugin options)

Layer 1 (depends on Layer 0):
  - Repo Assembler (uses config types, calls git CLI)
  - Graph Extractor (uses config types, reads filesystem)

Layer 2 (depends on Layers 0-1):
  - Graph Merger (consumes Extractor output, applies namespacing)

Layer 3 (depends on Layers 0-2):
  - Project Graph Plugin (createNodes + createDependencies, orchestrates extraction + merging)
  - Sync Generator (reads merged graph, updates host files)

Layer 4 (depends on Layers 0-1):
  - Generators (init, add-repo -- configure nx.json, trigger assembly)
  - Executors (assemble -- wraps Repo Assembler as Nx target)
```

**Suggested build order for phases:**
1. Config types + Repo Assembler (foundation -- get repos cloned)
2. Graph Extractor + Graph Merger (core logic -- produce merged graph)
3. createNodes + createDependencies (integration -- surface to Nx)
4. Generators (DX -- easy setup and repo management)
5. Sync Generator (polish -- auto-sync tsconfig paths, gitignore)
6. Executors (optional -- explicit assembly target)

## Nx Plugin API Surface Area Needed

| API | From | Purpose |
|-----|------|---------|
| `CreateNodes` (v2 shape) | `@nx/devkit` | Register external projects in host graph |
| `CreateDependencies` | `@nx/devkit` | Register cross-repo dependency edges |
| `CreateDependenciesContext` | `@nx/devkit` | Access existing graph nodes, workspace config |
| `ProjectConfiguration` | `@nx/devkit` | Type for project definitions returned by createNodes |
| `DependencyType` | `@nx/devkit` | Classify dependencies (implicit for cross-repo) |
| `Tree` | `@nx/devkit` | Filesystem abstraction for generators |
| `readJson` / `writeJson` | `@nx/devkit` | Read/write nx.json and tsconfig in generators |
| `generateFiles` | `@nx/devkit` | Template file generation in generators |
| `SyncGeneratorResult` | `@nx/devkit` | Return type for sync generators |
| `formatFiles` | `@nx/devkit` | Format generated files with Prettier |
| `readProjectsConfigurationFromProjectGraph` | `@nx/devkit` | Extract project configs from cached graph (if used) |

## Scalability Considerations

| Concern | 2-3 repos | 10-20 repos | 50+ repos |
|---------|-----------|-------------|-----------|
| Assembly time | Seconds (shallow clone) | 30-60s first run, fast after | Minutes first run; parallel clone needed |
| Graph construction | Negligible overhead | Hundreds of projects; cached JSON essential | Thousands of projects; lazy loading by repo needed |
| Namespace collisions | Unlikely | Possible with common names | Prefix strategy is critical |
| Staleness detection | Manual is fine | Needs auto-check on `nx sync` | Needs background refresh or CI-triggered assembly |
| Disk usage | < 100 MB | 1-5 GB | 10+ GB; sparse checkout / shallow clone mandatory |

## Directory Layout (Recommended)

```
packages/nx-openpolyrepo/
  package.json              # Plugin package with generators/executors/nx-migrations
  generators.json           # Generator registry
  executors.json            # Executor registry
  src/
    index.ts                # Graph plugin entry: exports createNodes, createDependencies
    graph/
      plugin.ts             # createNodes + createDependencies implementation
      extractor.ts          # Graph extraction from synced repos
      merger.ts             # Graph merging + namespacing logic
      types.ts              # RepoConfig, MergedProject, etc.
    assembly/
      assembler.ts          # Git clone/pull operations
      staleness.ts          # Cache freshness detection
    generators/
      init/
        generator.ts        # First-time setup: add plugin to nx.json
        schema.json
        schema.d.ts
      add-repo/
        generator.ts        # Add a new repo to plugin config
        schema.json
        schema.d.ts
    executors/
      assemble/
        executor.ts         # Explicit assembly as Nx target
        schema.json
        schema.d.ts
    sync/
      sync-generator.ts     # Keep tsconfig paths, gitignore in sync
    utils/
      git.ts                # Git CLI wrapper (cross-platform)
      config.ts             # Plugin options parsing + validation
```

## Sources

- [Extending the Project Graph | Nx](https://nx.dev/docs/extending-nx/project-graph-plugins)
- [CreateNodes Compatibility | Nx](https://nx.dev/docs/extending-nx/createnodes-compatibility)
- [Sync Generators | Nx](https://nx.dev/docs/concepts/sync-generators)
- [Create a Sync Generator | Nx](https://nx.dev/docs/extending-nx/create-sync-generator)
- [createProjectGraphAsync | Nx](https://nx.dev/docs/reference/devkit/createProjectGraphAsync)
- [Nx Enterprise - Polygraph | Nx](https://nx.dev/docs/enterprise/polygraph)
- [10 Tips for Successful Nx Plugin Architecture](https://smartsdlc.dev/blog/10-tips-for-successful-nx-plugin-architecture/)
- [meta - tool for turning many repos into a meta repo](https://github.com/mateodelnorte/meta)
- [Integrate a New Tool with a Tooling Plugin | Nx](https://nx.dev/docs/extending-nx/tooling-plugin)
- [ProjectGraph | Nx](https://nx.dev/docs/reference/devkit/ProjectGraph)
- [@nx/gradle source](https://github.com/nrwl/nx/tree/master/packages/gradle) -- createNodesV2 + cached Gradle project graph report pattern
- [@nx/maven source](https://github.com/nrwl/nx/tree/master/packages/maven) -- Kotlin analyzer subprocess + PluginCache pattern
- [@nx/dotnet source](https://github.com/nrwl/nx/tree/master/packages/dotnet) -- C# MSBuild analyzer + cross-project dependency mapping
