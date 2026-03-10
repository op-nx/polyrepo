# Technology Stack

**Project:** nx-openpolyrepo
**Researched:** 2026-03-10

## Recommended Stack

### Core Framework

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| Nx | ^22.5.4 | Workspace orchestration, plugin host | Already installed; Nx 22 is the current stable line. Plugin targets Nx 22.x per project constraints. | HIGH |
| @nx/devkit | ^22.5.4 | Plugin development API (createNodesV2, createDependencies, Tree, generators) | The canonical SDK for building Nx plugins. Provides all types and utilities needed for project graph plugins, generators, and executors. | HIGH |
| @nx/plugin | ^22.5.4 | Plugin scaffolding generators and e2e testing harness | Provides `@nx/plugin:plugin`, `@nx/plugin:generator`, `@nx/plugin:executor`, and `@nx/plugin:e2e-project` generators for scaffolding plugin boilerplate. | HIGH |
| TypeScript | ~5.9.x | Language | Already in workspace. Strict mode enabled. All plugin code in TypeScript. | HIGH |
| Node.js | 24.x | Runtime | Already in workspace. Plugin runs at build-time / graph-computation time only. | HIGH |

### Nx Plugin APIs (Critical)

These are the specific `@nx/devkit` APIs the plugin must use. All are exported from `@nx/devkit`.

| API | Purpose | Why | Confidence |
|-----|---------|-----|------------|
| `createNodesV2` / `CreateNodesV2<T>` | Register external repo projects as Nx project nodes | The v2 API (current in Nx 22) lets the plugin return project configurations for each assembled repo. The glob pattern matches a marker file (e.g., `**/.openpolyrepo.json` or external repo `nx.json` files) and the handler returns `ProjectConfiguration` objects for discovered projects. In Nx 22, export both `createNodes` and `createNodesV2` with identical v2 implementations for forward compatibility with Nx 23 (where `createNodesV2` name is deprecated in favor of `createNodes` with v2 signature). | HIGH |
| `createDependencies` / `CreateDependencies<T>` | Wire cross-repo dependency edges in the project graph | Returns `CandidateDependency[]` describing edges between projects. Used for: (1) auto-detected cross-repo deps from package.json, (2) explicit manual dependency overrides from plugin config. Use `DependencyType.implicit` for cross-repo edges since they are not tied to specific source files. | HIGH |
| `createProjectGraphAsync` | Read project graph from assembled repos | Call inside each cloned repo to extract its project graph, then merge nodes and dependencies into the host workspace graph. | HIGH |
| `ProjectGraph`, `ProjectGraphProjectNode`, `ProjectGraphExternalNode` | Type definitions for graph manipulation | Core types for working with project graph nodes and dependencies. `ProjectGraphProjectNode` has `type: 'app' \| 'e2e' \| 'lib'`, `name`, and `data: ProjectConfiguration`. | HIGH |
| `DependencyType` enum | Classify dependency edges | `static`, `dynamic`, `implicit`. Cross-repo deps should use `implicit` since they are inferred from package.json or config, not from source file analysis. | HIGH |
| `validateDependency` | Validate candidate dependencies before returning | Catches invalid dependency references early. Throws if source/target projects do not exist in the graph. | HIGH |
| `Tree` | File system abstraction for generators | Used in sync generators and scaffolding generators. Provides `read`, `write`, `exists`, `delete` operations on a virtual file tree. | HIGH |
| `SyncGeneratorResult` (from `nx/src/utils/sync-generators`) | Return type for sync generators | Sync generators return `{ outOfSyncMessage?: string }` to indicate whether workspace files need updating. | HIGH |
| `workspaceRoot` | Get absolute path to workspace root | Needed for resolving paths to assembled repos relative to workspace. | HIGH |
| `readProjectConfiguration` | Read single project config from Tree | Utility for generator implementations. | HIGH |
| `joinPathFragments` | Cross-platform path joining | Normalizes path separators. Use instead of `path.join` in Nx plugin code. | HIGH |

### Git Operations

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| simple-git | ^3.32.x | All git operations (clone, pull, fetch, status, branch) | 12M+ weekly npm downloads. Full TypeScript types bundled. Promise-based async API. Wraps the system `git` binary (no native compilation needed -- critical for cross-platform ARM64/x64 support). Supports clone, pull, fetch, status, log, branch, remote operations -- everything needed for repo assembly and multi-repo git DX. | HIGH |

### Configuration Validation

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| zod | ^3.24.x | Runtime validation of plugin options from nx.json | Plugin options (repo URLs, branches, prefixes, dependency overrides) come from user-authored nx.json. Zod provides schema validation with clear error messages, TypeScript type inference from schemas, and zero dependencies. Already standard in the Nx ecosystem (Nx itself uses it internally). | MEDIUM |

### Testing

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| Vitest | ^4.0.x | Unit and integration tests | Already in workspace. Fast, native TypeScript support, Vite-powered. | HIGH |
| @nx/devkit/testing | (bundled with @nx/devkit) | `createTreeWithEmptyWorkspace()` for generator unit tests | Standard Nx testing utility. Creates a virtual Tree for testing generators without touching the real filesystem. | HIGH |
| @nx/plugin/testing | (bundled with @nx/plugin) | E2E test utilities for plugin testing | Provides `ensureNxProject`, `runNxCommand`, `runNxCommandAsync` for e2e testing the plugin in a real workspace. | MEDIUM |

### Build & Publish

| Technology | Version | Purpose | Why | Confidence |
|------------|---------|---------|-----|------------|
| @nx/js | ^22.5.4 | TypeScript compilation for plugin package | Already in workspace. Handles `tsc` build, declaration generation, and output to `dist/`. | HIGH |
| Vite | ^7.0.x | Build bundling (if needed for optimized output) | Already in workspace. May not be needed if `@nx/js` tsc output is sufficient. | LOW |

### Supporting Libraries

| Library | Version | Purpose | When to Use | Confidence |
|---------|---------|---------|-------------|------------|
| glob / fast-glob | (bundled with Nx) | File pattern matching | Nx provides glob utilities internally; no separate install needed for `createNodesV2` glob patterns. | HIGH |
| chalk | ^5.x | Colored CLI output | For multi-repo status display and error messages. Use dynamic import (ESM-only in v5). Alternatively, use Nx's built-in `output` utility from `@nx/devkit` which already handles coloring. | LOW |
| ora | ^8.x | Spinner for long-running git operations | Clone/pull operations can take time. Provides visual feedback. Optional -- could use simple console output instead. | LOW |

## Reference Plugins (Official Nx)

Three official Nx plugins validate the "external tool + cached JSON + createNodesV2" architecture. Source code available from a local clone of the `nrwl/nx` repo on this machine:

- **`@nx/gradle`** (`packages/gradle/src/plugin/`) -- Triggers on `build.gradle*`. Runs `gradlew nxProjectGraph` to get a `ProjectGraphReport` (nodes, dependencies, externalNodes). Caches to `workspaceDataDirectory` with hash-based invalidation. Uses `PluginCache` from `nx/src/utils/plugin-cache-utils`.
- **`@nx/maven`** (`packages/maven/src/plugins/`) -- Triggers on `**/pom.xml`. Spawns `mvn nx-maven-plugin:analyze` (Kotlin analyzer). Writes JSON to Nx cache dir. Uses `calculateHashesForCreateNodes` for invalidation. Shares data between `createNodes` and `createDependencies` via module-level `setCurrentMavenData()`.
- **`@nx/dotnet`** (`packages/dotnet/src/plugins/`) -- Triggers on `**/*.{csproj,fsproj,vbproj}`. Uses C# MSBuild analyzer binary. `createDependencies` reads from `readCachedAnalysisResult()` populated by `createNodes`. Maps cross-project references via `referencesByRoot` -- analogous to our cross-repo dependency detection.

All three confirm the pattern: subprocess for discovery, JSON cache for bridge, `createNodesV2` + `createDependencies` for Nx integration.

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| Git library | simple-git | isomorphic-git | isomorphic-git is a pure JS git implementation -- slower for real operations, does not support all git features (e.g., submodules, some auth methods), and adds unnecessary complexity when the system `git` binary is guaranteed available (Nx workspaces require git). |
| Git library | simple-git | nodegit (libgit2 bindings) | Native compilation required. Breaks on ARM64 Windows. Not actively maintained. 10x more complex setup. |
| Git library | simple-git | child_process.execSync('git ...') | No TypeScript types, manual output parsing, no error handling structure. simple-git wraps this cleanly. |
| Config validation | zod | ajv (JSON Schema) | Plugin options use JSON Schema in `schema.json` for Nx generator registration, but runtime validation of nx.json plugin options benefits from zod's TypeScript inference and better error messages. |
| Config validation | zod | io-ts | Heavier, fp-ts dependency, less ergonomic API. Zod is the community standard. |
| Multi-repo tool | Custom (simple-git) | meta (npm) | meta is a standalone CLI tool with its own `.meta` config file. We need integration as an Nx plugin with config in nx.json, not a separate tool. DX patterns from meta are worth studying, but the tool itself is not embeddable. |
| Multi-repo tool | Custom (simple-git) | mu-repo | Python-based. Not embeddable in a Node.js/Nx plugin. |
| Sync mechanism | Nx sync generators | Custom file watcher | Nx sync generators are the native mechanism for keeping workspace files in sync before task execution. They integrate with `nx sync`, `nx sync:check`, and CI pipelines. No reason to build custom. |
| CLI output | @nx/devkit output utilities | ink (React for CLI) | Ink is heavy, adds React dependency, and is overkill for status display. Nx's built-in output utilities match the Nx CLI aesthetic. |

## Nx Plugin Architecture Decisions

### Plugin Entry Point Structure

The plugin package should export from its root `index.ts`:

```typescript
// Project graph plugin exports
export { createNodes, createNodesV2 } from './src/graph/create-nodes';
export { createDependencies } from './src/graph/create-dependencies';

// Generators (if any)
export { repoAssemblyGenerator } from './src/generators/assemble/generator';

// Executors (if any)
export { gitStatusExecutor } from './src/executors/git-status/executor';
```

### Plugin Registration in nx.json

```json
{
  "plugins": [
    {
      "plugin": "@nx-openpolyrepo/core",
      "options": {
        "repos": [
          {
            "url": "https://github.com/org/repo-a.git",
            "branch": "main",
            "prefix": "repo-a"
          }
        ],
        "assemblyDir": ".repos",
        "dependencyOverrides": []
      }
    }
  ]
}
```

### createNodesV2 Pattern (Nx 22 compatible)

```typescript
import { CreateNodesV2, createNodesFromFiles } from '@nx/devkit';

interface OpenPolyrepoPluginOptions {
  repos: RepoConfig[];
  assemblyDir?: string;
}

// Nx 22: export both names with v2 implementation
// Nx 23: createNodesV2 name deprecated, createNodes with v2 sig is canonical
const createNodesInternal = async (
  configFilePath: string,
  options: OpenPolyrepoPluginOptions | undefined,
  context: CreateNodesContextV2
) => {
  // Read assembled repo's project graph
  // Return ProjectConfiguration objects for each project
};

export const createNodesV2: CreateNodesV2<OpenPolyrepoPluginOptions> = [
  '**/.openpolyrepo.json',  // or assembled repo marker files
  async (configFiles, options, context) =>
    createNodesFromFiles(createNodesInternal, configFiles, options, context),
];

// Forward-compatible: same implementation under createNodes name
export const createNodes = createNodesV2;
```

### createDependencies Pattern

```typescript
import { CreateDependencies, DependencyType, validateDependency } from '@nx/devkit';

export const createDependencies: CreateDependencies<OpenPolyrepoPluginOptions> = async (
  options,
  context
) => {
  const deps: CandidateDependency[] = [];

  // 1. Auto-detect from package.json cross-references
  // 2. Apply explicit dependency overrides from options

  for (const dep of deps) {
    validateDependency(dep, context);
  }

  return deps;
};
```

### Sync Generator for Repo Assembly

```typescript
import { Tree } from '@nx/devkit';
import { SyncGeneratorResult } from 'nx/src/utils/sync-generators';

export async function assembleReposSync(tree: Tree): Promise<SyncGeneratorResult> {
  // Check if repos need clone/pull
  // Return outOfSyncMessage if repos are stale
}
```

Registered as a global sync generator:
```json
{
  "sync": {
    "globalGenerators": ["@nx-openpolyrepo/core:assemble-repos"]
  }
}
```

## What NOT to Use

| Technology | Why Not |
|------------|---------|
| nodegit / libgit2 bindings | Native compilation. Breaks cross-platform (especially ARM64 Windows). Not actively maintained. |
| isomorphic-git | Pure JS git is slower and incomplete. System git is guaranteed in Nx workspaces. |
| ink / blessed / terminal-kit | Overkill TUI frameworks for v1. Nx CLI output utilities are sufficient. |
| Nx Cloud / Enterprise APIs | Explicitly out of scope. This is a free/open-source alternative. |
| Custom CLI entry point (e.g., standalone bin) | Must integrate as a standard Nx plugin. No custom CLI that bypasses Nx. |
| Nx v1 plugin API (processProjectGraph, projectFilePatterns) | Deprecated since Nx 19. Removed type definitions in Nx 22. Use createNodesV2 + createDependencies. |
| winston / pino / bunyan | Logging frameworks are unnecessary. Plugin runs in Nx's process; use `console.warn`/`console.error` and `@nx/devkit` output utilities. |

## Installation

```bash
# Core (move to dependencies when publishing)
npm install simple-git zod

# Already installed (devDependencies)
# @nx/devkit @nx/plugin @nx/js typescript vitest
```

## Development Environment

```bash
# Disable Nx Daemon during plugin development (caches plugin code)
export NX_DAEMON=false

# Run plugin e2e tests
npx nx e2e openpolyrepo-e2e

# Visualize project graph (verify plugin integration)
npx nx graph
```

## Version Compatibility Matrix

| Nx Version | createNodes API | createDependencies | Sync Generators | Status |
|------------|-----------------|-------------------|-----------------|--------|
| 22.x (target) | Export both `createNodes` and `createNodesV2` with v2 signature | Supported | Supported (since 19.6) | Current stable |
| 23.x (future) | `createNodesV2` name deprecated; use `createNodes` with v2 signature | Supported | Supported | Planned migration path |

## Sources

- [Extending the Project Graph - Nx Docs](https://nx.dev/docs/extending-nx/project-graph-plugins) -- HIGH confidence
- [CreateNodes API Compatibility - Nx Docs](https://nx.dev/docs/extending-nx/createnodes-compatibility) -- HIGH confidence
- [ProjectGraph API Reference - Nx Docs](https://nx.dev/docs/reference/devkit/ProjectGraph) -- HIGH confidence
- [@nx/devkit Overview - Nx Docs](https://nx.dev/docs/reference/devkit) -- HIGH confidence
- [Create a Sync Generator - Nx Docs](https://nx.dev/docs/extending-nx/create-sync-generator) -- HIGH confidence
- [Sync Generators Concept - Nx Docs](https://nx.dev/docs/concepts/sync-generators) -- HIGH confidence
- [simple-git - npm](https://www.npmjs.com/package/simple-git) -- HIGH confidence (12M+ weekly downloads, 3.8K GitHub stars)
- [simple-git - GitHub](https://github.com/steveukx/git-js) -- HIGH confidence
- [10 Tips for Successful Nx Plugin Architecture](https://smartsdlc.dev/blog/10-tips-for-successful-nx-plugin-architecture/) -- MEDIUM confidence
- [@nx/plugin Generators - Nx Docs](https://nx.dev/docs/reference/plugin/generators) -- HIGH confidence
- [Nx Cloud Introducing Polygraph](https://nx.dev/blog/nx-cloud-introducing-polygraph) -- HIGH confidence (context on what Polygraph does)
- [meta - GitHub](https://github.com/mateodelnorte/meta) -- MEDIUM confidence (DX pattern reference)
- [@nx/gradle source](https://github.com/nrwl/nx/tree/master/packages/gradle) -- HIGH confidence (official Nx plugin, same createNodesV2 pattern)
- [@nx/maven source](https://github.com/nrwl/nx/tree/master/packages/maven) -- HIGH confidence (official Nx plugin, subprocess + cache pattern)
- [@nx/dotnet source](https://github.com/nrwl/nx/tree/master/packages/dotnet) -- HIGH confidence (official Nx plugin, cross-project dependency mapping)

---

*Stack research: 2026-03-10*
