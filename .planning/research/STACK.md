# Stack Research

**Domain:** Cross-repo dependency detection and manual overrides for Nx polyrepo plugin
**Researched:** 2026-03-17
**Confidence:** HIGH

## Verdict: No New Dependencies Required

The v1.1 features (cross-repo dependency auto-detection from package.json, explicit dependency overrides) are fully implementable with the existing stack. No new npm packages, no version bumps, no architectural changes to the dependency tree.

**Rationale:** Both features operate on data already available in the plugin's runtime context:
- package.json files exist on disk in `.repos/<alias>/` after sync
- The graph report already contains project nodes with their root paths
- Zod already validates config; schema extension is additive
- `@nx/devkit` `DependencyType.implicit` is already used for intra-repo edges

## Existing Stack (Unchanged)

### Core Technologies

| Technology | Version | Purpose | Why Unchanged for v1.1 |
|------------|---------|---------|------------------------|
| Nx | ^22.5.4 | Plugin host, project graph | `createDependencies` already returns `RawProjectGraphDependency[]` -- cross-repo deps are additional entries in the same array |
| @nx/devkit | ^22.5.4 | Plugin API (`DependencyType.implicit`, `CreateDependencies`) | All needed types already imported and used in `index.ts` |
| TypeScript | ~5.9.x | Language | No new type requirements |
| Zod | ^4.0.0 (plugin), ^4.3.6 (workspace) | Config schema validation | Schema extension is additive -- new optional fields on `polyrepoConfigSchema` |
| Node.js | 24.x | Runtime (`fs.readFileSync`, `path.join`) | package.json reading uses built-in `node:fs` and `node:path` |

### No New Libraries Needed

The temptation to add libraries should be resisted. Here is why each potential addition is unnecessary:

| Potential Addition | Why NOT to Add |
|-------------------|----------------|
| `read-pkg` / `read-package-json` | package.json is guaranteed valid JSON (npm/pnpm enforce this). `JSON.parse(fs.readFileSync(...))` with Zod validation is sufficient and already the project's pattern. |
| `semver` | Not needed. Dependency detection matches on package name presence, not version range satisfaction. A project that declares `"@org/lib": "^1.0.0"` in dependencies depends on whatever project publishes `@org/lib` -- the version range is irrelevant for graph edges. |
| `glob` / `fast-glob` | Not needed. The plugin already knows all project roots from the graph report. Walk the known roots to find `package.json` files, no globbing required. |
| `dependency-graph` (npm) | Not needed. Nx IS the dependency graph. We produce `RawProjectGraphDependency[]` entries and Nx handles cycle detection, topological ordering, and affected calculation. |
| `simple-git` | Listed in v1.0 research but never actually added as a dependency (project uses `child_process.exec` directly). Still not needed for v1.1 -- no new git operations. |

## Integration Points for v1.1

### 1. Package.json Auto-Detection (New Module)

**Location:** `src/lib/graph/detect-dependencies.ts` (new file)
**Uses:** `node:fs` (readFileSync), `node:path` (join), `zod` (validation schema for package.json)
**Integration:** Called from `createDependencies` in `index.ts`, receives the `PolyrepoGraphReport` and workspace root

The detection algorithm:
1. Build a lookup map: npm package name -> namespaced Nx project name (from each repo's project nodes)
2. For each project across all repos, read its `package.json` (at `<workspaceRoot>/<project.root>/package.json`)
3. Match `dependencies`, `devDependencies`, `peerDependencies`, `optionalDependencies` keys against the lookup map
4. For each match, emit a `RawProjectGraphDependency` with `DependencyType.implicit`

**Key types already available:**
```typescript
// From @nx/devkit (already imported in index.ts)
import type { RawProjectGraphDependency } from '@nx/devkit';
import { DependencyType } from '@nx/devkit';

// From existing codebase
import type { PolyrepoGraphReport, TransformedNode } from './types';
```

**Zod schema for package.json reading (minimal, new):**
```typescript
// Only the fields we need -- not a full package.json schema
const packageJsonDepsSchema = z.object({
  name: z.string().optional(),
  dependencies: z.record(z.string(), z.string()).optional(),
  devDependencies: z.record(z.string(), z.string()).optional(),
  peerDependencies: z.record(z.string(), z.string()).optional(),
  optionalDependencies: z.record(z.string(), z.string()).optional(),
}).passthrough();
```

### 2. Explicit Dependency Overrides (Schema Extension)

**Location:** `src/lib/config/schema.ts` (extend existing)
**Uses:** `zod` (already imported)
**Integration:** Read in `createDependencies` alongside auto-detected deps

Schema addition to `polyrepoConfigSchema`:
```typescript
const dependencyOverride = z.object({
  source: z.string().min(1),  // namespaced project: "repo-a/my-app"
  target: z.string().min(1),  // namespaced project: "repo-b/shared-lib"
});

// Extended config
export const polyrepoConfigSchema = z.object({
  repos: /* existing */,
  dependencies: z.array(dependencyOverride).optional(),  // NEW
});
```

**Why `dependencies` not `dependencyOverrides`:** Shorter, matches Nx's own `graph.dependencies` naming. The "override" semantic is implicit -- explicit config always wins over auto-detection (last-write-wins or additive, design decision for implementation phase).

### 3. Graph Report Extension (Type Addition)

**Location:** `src/lib/graph/types.ts` (extend existing)

The `TransformedNode` type may need a `packageName` field to support the lookup map:
```typescript
export interface TransformedNode {
  // ... existing fields ...
  packageName?: string;  // npm package name from project's package.json
}
```

Alternatively, the package name lookup can be built lazily in the detection module without touching the existing type -- this is a design decision for implementation.

## What NOT to Change

| Do Not | Why |
|--------|-----|
| Add `simple-git` as a dependency | The project deliberately uses `child_process.exec` for git operations. v1.1 adds no new git operations. |
| Bump Nx version | ^22.5.4 has all needed APIs. No new `@nx/devkit` features required. |
| Add `validateDependency` from devkit | The existing guard `if (context.projects[dep.source] && context.projects[dep.target])` is equivalent and more explicit. `validateDependency` throws on missing projects -- we want to silently skip (degraded mode). |
| Switch from `DependencyType.implicit` to `DependencyType.static` | Cross-repo deps are not derived from static source analysis. `implicit` is semantically correct and matches how Nx treats package.json-based deps in monorepos. |
| Add a package.json parser library | Built-in `JSON.parse` + Zod is the established pattern. Adding a dependency for `JSON.parse` is over-engineering. |
| Add cycle detection | Nx handles cycles in the project graph natively. The plugin should not duplicate this logic. |

## Version Compatibility

| Package | Current | Required for v1.1 | Notes |
|---------|---------|-------------------|-------|
| @nx/devkit | ^22.5.4 | ^22.5.4 (no change) | `DependencyType`, `RawProjectGraphDependency`, `CreateDependencies` all stable since Nx 20 |
| zod | ^4.0.0 | ^4.0.0 (no change) | `.optional()`, `.passthrough()`, `z.array()` all available |
| node:fs | built-in | built-in | `readFileSync` for package.json reading |
| node:path | built-in | built-in | `join` for resolving package.json paths |

## Installation

```bash
# No new packages to install for v1.1
# Existing dependencies cover all requirements
```

## Sources

- Codebase inspection: `packages/op-nx-polyrepo/src/index.ts` -- existing `createDependencies` implementation using `DependencyType.implicit` (HIGH confidence)
- Codebase inspection: `packages/op-nx-polyrepo/src/lib/config/schema.ts` -- existing Zod schema with `.strict()` and `.refine()` (HIGH confidence)
- Codebase inspection: `packages/op-nx-polyrepo/src/lib/graph/types.ts` -- existing `PolyrepoGraphReport` and `TransformedNode` types (HIGH confidence)
- Codebase inspection: `packages/op-nx-polyrepo/package.json` -- current dependency list: `@nx/devkit >=20.0.0`, `tslib ^2.3.0`, `zod ^4.0.0` (HIGH confidence)
- Runtime verification: `DependencyType` enum values are `static`, `dynamic`, `implicit` (HIGH confidence, verified via `node -e`)
- Runtime verification: `@nx/devkit` exports no cross-workspace package.json scanning utilities (HIGH confidence, verified via `node -e`)

---
*Stack research for: v1.1 cross-repo dependency detection*
*Researched: 2026-03-17*
