# Phase 8 Context: Schema Extension and Data Extraction

**Phase:** 8 — Schema Extension and Data Extraction
**Discussed:** 2026-03-17
**Status:** Decisions locked

## Summary

Phase 8 extends the plugin config schema and extraction pipeline to produce the data structures that Phase 9's cross-repo dependency detection consumes. Four areas were discussed: override config shape, data model enrichment, host project coverage, and package.json reading strategy.

## Decisions

### 1. Override Config Shape

**Decision:** `implicitDependencies` field in plugin options, keyed by source project name, with array of target project names. Follows Nx's native `implicitDependencies` syntax.

```json
{
  "repos": { "nx": { "url": "..." }, "shared": { "url": "..." } },
  "implicitDependencies": {
    "nx/*": ["shared/*"],
    "my-app": ["nx/core", "!nx/unused"]
  }
}
```

- **Field name:** `implicitDependencies` (top-level plugin option, optional)
- **Keys:** Nx project names or minimatch globs (namespaced for external projects, e.g., `nx/*`)
- **Values:** Arrays of target project names, also supporting minimatch globs
- **Negation:** `!` prefix on target removes an auto-detected dependency (e.g., `!nx/unused`)
- **Globs:** Minimatch on both source keys and target values
- **Rationale:** Mirrors Nx's own `implicitDependencies` convention from `project.json`. Users familiar with Nx will recognize the syntax instantly. The only conceptual shift is that the source project is a key (workspace-level) rather than implicit from the file location (project-level).

### 2. Data Model Enrichment

**Decision:** Add four new fields to `TransformedNode`:

```typescript
interface TransformedNode {
  // ... existing fields ...
  packageName?: string; // npm package name from metadata.js
  dependencies?: string[]; // package names from package.json dependencies
  devDependencies?: string[]; // package names from package.json devDependencies
  peerDependencies?: string[]; // package names from package.json peerDependencies
}
```

- **`packageName`** is the single source of truth for npm-name-to-project mapping. Phase 9 builds a `Map<packageName, projectName>` by iterating all nodes once at the start of `createDependencies`.
- **Three separate dep arrays** (not flattened) preserve provenance for diagnostics and future features (peerDependencies detection is a planned differentiator per FEATURES.md).
- **Package names only** — no version ranges stored. Version conflict detection is explicitly deferred to v2+ per FEATURES.md anti-features.
- **Rationale:** Co-locating data on the node it describes gives a single source of truth. Building a lookup map from nodes is trivial (microseconds) and avoids a second data representation that must stay in sync.

### 3. Host Project Coverage

**Decision:** Hybrid approach leveraging Nx's own data where available:

| Data             | External projects                                           | Host projects                                              |
| ---------------- | ----------------------------------------------------------- | ---------------------------------------------------------- |
| **Package name** | `metadata.js.packageName` from `nx graph --print` (Phase 8) | `context.projects[name].metadata.js.packageName` (Phase 9) |
| **Dep lists**    | Read `package.json` from `.repos/<alias>/<root>/` (Phase 8) | Read `package.json` from `<root>/` (Phase 9)               |

- **Key finding:** `nx graph --print` already includes `metadata.js.packageName` in node data. We just need to extend the Zod schema to capture it — no separate package.json read needed for package names.
- **Key finding:** `nx graph --print` does NOT include `npm:` dependency edges or `externalNodes`. Dep lists must come from package.json on disk.
- **Host package names** come from `context.projects` metadata at detection time (Phase 9) — zero I/O needed, Nx already resolved them.
- **Host dep lists** are read from package.json at detection time (Phase 9) via `context.projects` root paths.
- **Rationale:** `createDependencies` has the full project list (`context.projects`) while `createNodesV2` does not. Host project data naturally belongs at detection time.

### 4. Package.json Reading Strategy

**Decision:** Read package.json in `transformGraphForRepo` during Phase 8 extraction.

- **When:** During the existing transform step, alongside node structural mapping. `workspaceRoot` parameter (currently unused `_workspaceRoot`) provides the base path.
- **Package name source:** `node.data.metadata?.js?.packageName` from graph output — not from package.json.
- **Dep list source:** `Object.keys()` of `dependencies`, `devDependencies`, `peerDependencies` from the project's `package.json` on disk.
- **No package.json:** Silent skip — fields remain `undefined`. No warning logged. These projects can still be referenced by Nx project name in `implicitDependencies` overrides.
- **Rationale:** Transform already iterates every node and has root paths. Adding package.json reading here avoids a separate pipeline stage for 5 lines of logic per node.

## Code Context

### Files to modify (Phase 8)

| File                                                 | Change                                                                                                                                                                                 |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/op-nx-polyrepo/src/lib/config/schema.ts`   | Add `implicitDependencies` to Zod config schema (optional record of string arrays with minimatch support)                                                                              |
| `packages/op-nx-polyrepo/src/lib/graph/types.ts`     | Extend `externalProjectNodeDataSchema` to capture `metadata.js.packageName`. Add `packageName`, `dependencies`, `devDependencies`, `peerDependencies` to `TransformedNode`.            |
| `packages/op-nx-polyrepo/src/lib/graph/transform.ts` | Read `metadata.js.packageName` from graph data. Read `package.json` from disk for dep lists. Populate new `TransformedNode` fields. Use `workspaceRoot` parameter (remove `_` prefix). |

### Files to modify (Phase 9, downstream)

| File                                   | Change                                                                                                                                                                                                                 |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/op-nx-polyrepo/src/index.ts` | In `createDependencies`: build package-name-to-project lookup from all nodes (external + host via `context.projects`). Scan dep lists for cross-repo matches. Process `implicitDependencies` overrides with minimatch. |

## Deferred Ideas

- **tsconfig path mappings as dependency source** — projects without package.json could still be referenced via tsconfig `paths` in their containing repo. Beyond v1.1 scope (FEATURES.md anti-feature: "TypeScript import analysis across repos").
- **Wildcard/glob support in target values was initially deferred** in FEATURES.md research but was decided to include during this discussion.
- **Dependency edge type control** — letting users specify `implicit`/`static`/`dynamic` edge type on overrides. Default to `implicit` for now, revisit if users request granularity.

---

_Context for Phase 8 — guides research and planning agents_
_Discussed: 2026-03-17_
