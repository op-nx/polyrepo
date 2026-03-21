# Phase 8: Schema Extension and Data Extraction - Research

**Researched:** 2026-03-17
**Domain:** Zod schema extension, Nx graph data enrichment, package.json dependency extraction
**Confidence:** HIGH

## Summary

Phase 8 extends the existing plugin config schema and graph extraction pipeline to produce enriched data for Phase 9's cross-repo dependency detection. Three files are modified: the config schema gains an optional `implicitDependencies` field, the graph types gain dependency-related fields on `TransformedNode`, and the transform function extracts package names from graph metadata and reads dependency lists from package.json on disk.

The codebase is well-structured for this work. The existing Zod schema (`polyrepoConfigSchema`) uses Zod 4.3.6 with `.strict()` on sub-objects, so adding a new top-level optional field is backward-compatible. The transform function already receives `workspaceRoot` (currently prefixed with `_` to suppress unused warnings) and iterates every node, making it the natural place to add package.json reading. Minimatch 10.x is already installed in the workspace.

**Primary recommendation:** Extend the three files exactly as outlined in CONTEXT.md decisions. The schema change is purely additive (optional field), the type change adds optional fields to an interface, and the transform change reads metadata that already exists in the parsed graph data plus a synchronous file read per node.

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions

1. **Override Config Shape:** `implicitDependencies` field in plugin options, keyed by source project name (or minimatch glob), with array of target project names (also supporting minimatch globs and `!` negation prefix). Follows Nx's native `implicitDependencies` syntax.

2. **Data Model Enrichment:** Add four new fields to `TransformedNode`: `packageName?: string`, `dependencies?: string[]`, `devDependencies?: string[]`, `peerDependencies?: string[]`. Package names only (no version ranges).

3. **Host Project Coverage:** Hybrid approach -- external project data populated in Phase 8 extraction pipeline; host project data populated in Phase 9 from `context.projects` metadata. Phase 8 does NOT handle host projects.

4. **Package.json Reading Strategy:** Read package.json in `transformGraphForRepo` during the existing transform step. Package name comes from `node.data.metadata?.js?.packageName` (graph output), dep lists come from `Object.keys()` of package.json dependency fields on disk. No package.json = silent skip (fields remain `undefined`).

### Claude's Discretion

No discretion areas defined -- all decisions locked.

### Deferred Ideas (OUT OF SCOPE)

- tsconfig path mappings as dependency source
- Dependency edge type control (implicit/static/dynamic) on overrides
- Wildcard/glob support in target values was initially deferred but was decided to include during discussion

</user_constraints>

<phase_requirements>

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| DETECT-05 | Plugin builds a name-to-namespaced-project lookup from package.json names and tsconfig paths, covering both host and external projects | Phase 8 populates `packageName` on every `TransformedNode` from `metadata.js.packageName` in graph output. Phase 9 builds the lookup map from these plus `context.projects` metadata for host projects. The dep list fields (`dependencies`, `devDependencies`, `peerDependencies`) enable Phase 9 to scan for cross-repo matches. |

</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| zod | 4.3.6 | Schema validation for config and graph JSON | Already used throughout codebase for all schemas |
| minimatch | 10.2.4 | Glob pattern matching for `implicitDependencies` keys/values | Already installed in workspace; standard glob library |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| node:fs (readFileSync) | built-in | Read package.json from disk during transform | Synchronous read per project node in transform loop |
| node:path (join) | built-in | Construct package.json paths from workspaceRoot + node root | Already imported in transform.ts |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `readFileSync` | `readJsonFile` from `@nx/devkit` | `readJsonFile` wraps `readFileSync` + `JSON.parse` and throws on missing file. Raw `readFileSync` + try/catch is clearer for the "silent skip on missing" behavior |
| minimatch | picomatch | minimatch is already installed; picomatch has a slightly different API. Stick with what's available |

**Installation:**
```bash
# No new packages needed -- all dependencies already installed
```

## Architecture Patterns

### Files to Modify
```
packages/op-nx-polyrepo/src/
  lib/
    config/
      schema.ts           # Add implicitDependencies to polyrepoConfigSchema
      schema.spec.ts      # Tests for new schema field
    graph/
      types.ts            # Extend TransformedNode, refine externalProjectNodeDataSchema
      transform.ts        # Extract packageName from metadata, read package.json deps
      transform.spec.ts   # Tests for new transform behavior
```

### Pattern 1: Additive Schema Extension (Backward Compatible)
**What:** Add an optional field to the existing Zod schema so v1.0 configs (repos-only) parse without errors.
**When to use:** When extending plugin options without breaking existing users.
**Example:**
```typescript
// schema.ts -- adding optional implicitDependencies
export const polyrepoConfigSchema = z.object({
  repos: z.record(z.string().min(1), repoEntry)
    .refine(/* existing refinement */)
    .check(/* existing check */),
  implicitDependencies: z.record(
    z.string().min(1),
    z.array(z.string().min(1))
  ).optional(),
});
```

**Key detail:** The `implicitDependencies` field is `optional()`, meaning a config with only `repos` still passes validation. The `z.record(z.string().min(1), z.array(z.string().min(1)))` shape validates that keys are non-empty strings and values are arrays of non-empty strings. Glob patterns and `!` prefixes are structurally valid strings -- semantic validation (do patterns match any project?) is Phase 9's job.

### Pattern 2: Metadata Extraction from Graph Output
**What:** The `metadata` field on graph nodes is currently typed as `z.record(z.string(), z.unknown()).optional()`. To extract `metadata.js.packageName`, we refine the Zod schema for `metadata` to capture the `js.packageName` path while still accepting any other metadata.
**When to use:** When the graph JSON contains structured data in a loosely-typed field.
**Example:**
```typescript
// types.ts -- refine metadata schema to capture js.packageName
const externalProjectNodeDataSchema = z.object({
  root: z.string(),
  targets: z.record(z.string(), z.unknown()).optional(),
  tags: z.array(z.string()).optional(),
  metadata: z.object({
    js: z.object({
      packageName: z.string().optional(),
    }).optional(),
  }).passthrough().optional(),
  sourceRoot: z.string().optional(),
  projectType: z.string().optional(),
});
```

**Key detail:** `.passthrough()` ensures unknown metadata fields are preserved (not stripped). The `js.packageName` path is now type-safe, while `metadata` as a whole remains flexible. This is the Zod 4 equivalent of a partial schema with pass-through.

### Pattern 3: Synchronous File Read in Transform Loop
**What:** Read package.json from disk for each project node during the synchronous transform step.
**When to use:** When enriching transformed data with on-disk artifacts that the graph JSON doesn't include.
**Example:**
```typescript
// transform.ts -- reading package.json in the transform loop
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Inside the node iteration loop:
const repoPath = join(workspaceRoot, '.repos', repoAlias);
const projectRoot = node.data.root; // original root, not yet rewritten
const pkgJsonPath = join(repoPath, projectRoot, 'package.json');

let dependencies: string[] | undefined;
let devDependencies: string[] | undefined;
let peerDependencies: string[] | undefined;

try {
  const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));
  dependencies = pkgJson.dependencies ? Object.keys(pkgJson.dependencies) : undefined;
  devDependencies = pkgJson.devDependencies ? Object.keys(pkgJson.devDependencies) : undefined;
  peerDependencies = pkgJson.peerDependencies ? Object.keys(pkgJson.peerDependencies) : undefined;
} catch {
  // No package.json -- fields remain undefined (silent skip per decision)
}
```

**Key detail:** Use `node.data.root` (the original root from the external repo), NOT the rewritten `.repos/<alias>/...` root. The `repoPath` variable provides the base to the cloned repo directory. The path construction is: `workspaceRoot + .repos/<alias> + <original-project-root> + package.json`. Note `transformGraphForRepo` is synchronous, so `readFileSync` is appropriate.

### Anti-Patterns to Avoid
- **Do NOT validate glob patterns at schema parse time:** `implicitDependencies` patterns like `nx/*` or `!nx/unused` are structurally valid strings. Checking whether they match any actual project is Phase 9's responsibility (in `createDependencies` where the full project graph is available).
- **Do NOT read package.json for the package name:** The package name comes from `node.data.metadata?.js?.packageName` which is already in the graph output. Reading package.json is only for dependency lists.
- **Do NOT handle host projects in Phase 8:** Host project data (package names, dep lists) is Phase 9's responsibility via `context.projects`.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Glob matching | Custom regex-based pattern matching | `minimatch` from npm | Edge cases with `**`, negation, brace expansion |
| JSON schema validation | Manual if/typeof checks on config shape | Zod 4 schema with `.optional()`, `.passthrough()` | Type inference, error messages, composability |
| Package.json type shape | Custom interface for partial package.json | Inline `JSON.parse` + `Object.keys()` with optional chaining | We only need dependency field keys, not full type safety on the entire package.json |

**Key insight:** The changes in this phase are small additions to existing patterns. Each modification point (schema, types, transform) already has a clear structure to extend.

## Common Pitfalls

### Pitfall 1: Breaking v1.0 Config Compatibility
**What goes wrong:** Adding a required field to the schema causes existing configs (repos-only) to fail validation.
**Why it happens:** Forgetting `.optional()` on the new field.
**How to avoid:** The `implicitDependencies` field MUST be `.optional()`. Test that a v1.0 config (repos only, no overrides) still parses successfully.
**Warning signs:** `schema.spec.ts` tests for existing valid entries start failing.

### Pitfall 2: Zod .strict() vs .passthrough() on Metadata
**What goes wrong:** Using `.strict()` on the refined metadata schema causes Zod to reject unknown metadata fields that Nx includes in graph output.
**Why it happens:** The current schema uses `z.record(z.string(), z.unknown())` which accepts anything. Replacing it with a structured object schema defaults to stripping unknown keys.
**How to avoid:** Use `.passthrough()` on the metadata object schema so unknown fields are preserved, not stripped.
**Warning signs:** `metadata` on transformed nodes loses fields that were present in the graph output.

### Pitfall 3: Wrong Path for Package.json Read
**What goes wrong:** Constructing the package.json path using the *rewritten* root (`.repos/repo-b/libs/my-lib`) instead of composing from `workspaceRoot` + `.repos/<alias>` + original `node.data.root`.
**Why it happens:** The root is rewritten early in the transform loop. If you read package.json after rewriting, the path components double up.
**How to avoid:** Read package.json BEFORE root rewriting, or use `node.data.root` (original) to construct the path independently of the rewritten `hostRoot`.
**Warning signs:** `ENOENT` errors in tests or runtime for projects that definitely have package.json files.

### Pitfall 4: PolyrepoConfig Type Drift
**What goes wrong:** After adding `implicitDependencies` to the schema, the `PolyrepoConfig` inferred type changes. Code that spreads or forwards the config object (like `hashObject(options)`) works fine, but any code that destructures specific fields may need updating.
**Why it happens:** TypeScript's structural typing means the new optional field is compatible, but explicit type annotations elsewhere might not expect it.
**How to avoid:** The `PolyrepoConfig` type is `z.infer<typeof polyrepoConfigSchema>` -- it auto-updates. Check that `validateConfig` and `normalizeRepos` still compile without errors.
**Warning signs:** TypeScript compilation errors in files that import `PolyrepoConfig`.

### Pitfall 5: Synchronous readFileSync in Async Pipeline
**What goes wrong:** Using `readFileSync` inside an `async` function that's called in `Promise.all` can block the event loop.
**Why it happens:** `transformGraphForRepo` is currently synchronous and is called inside `Promise.all` in `cache.ts`.
**How to avoid:** This is acceptable because: (1) `transformGraphForRepo` is already synchronous, (2) the `Promise.all` parallelism is across repos (typically 2-5), not across hundreds of nodes, (3) each `readFileSync` for a small package.json is sub-millisecond from SSD. If profiling shows issues, the function can be made async later. For now, keep it synchronous for simplicity.
**Warning signs:** Graph extraction time regresses noticeably (measure before/after).

## Code Examples

Verified patterns from the existing codebase:

### Extending the Zod Config Schema
```typescript
// Current schema (schema.ts line 48-85):
export const polyrepoConfigSchema = z.object({
  repos: z.record(z.string().min(1), repoEntry)
    .refine(/* ... */)
    .check(/* ... */),
});

// Extended schema:
export const polyrepoConfigSchema = z.object({
  repos: z.record(z.string().min(1), repoEntry)
    .refine(/* ... */)
    .check(/* ... */),
  implicitDependencies: z.record(
    z.string().min(1),
    z.array(z.string().min(1))
  ).optional(),
});
```

### Refining the Metadata Schema in types.ts
```typescript
// Current (types.ts line 10-17):
const externalProjectNodeDataSchema = z.object({
  root: z.string(),
  targets: z.record(z.string(), z.unknown()).optional(),
  tags: z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  sourceRoot: z.string().optional(),
  projectType: z.string().optional(),
});

// Extended: structured metadata with passthrough
const metadataSchema = z.object({
  js: z.object({
    packageName: z.string().optional(),
  }).passthrough().optional(),
}).passthrough().optional();

const externalProjectNodeDataSchema = z.object({
  root: z.string(),
  targets: z.record(z.string(), z.unknown()).optional(),
  tags: z.array(z.string()).optional(),
  metadata: metadataSchema,
  sourceRoot: z.string().optional(),
  projectType: z.string().optional(),
});
```

### Extending TransformedNode Interface
```typescript
// Current (types.ts line 34-42):
export interface TransformedNode {
  name: string;
  root: string;
  projectType?: string;
  sourceRoot?: string;
  targets: Record<string, TargetConfiguration>;
  tags: string[];
  metadata?: Record<string, unknown>;
}

// Extended:
export interface TransformedNode {
  name: string;
  root: string;
  projectType?: string;
  sourceRoot?: string;
  targets: Record<string, TargetConfiguration>;
  tags: string[];
  metadata?: Record<string, unknown>;
  packageName?: string;
  dependencies?: string[];
  devDependencies?: string[];
  peerDependencies?: string[];
}
```

### Reading Package.json in Transform
```typescript
// In transformGraphForRepo, inside the node iteration loop:
// Extract package name from graph metadata
const packageName = node.data.metadata?.js?.packageName;

// Read dependency lists from package.json on disk
const repoBasePath = join(workspaceRoot, '.repos', repoAlias);
const pkgJsonPath = join(repoBasePath, node.data.root, 'package.json');
let dependencies: string[] | undefined;
let devDependencies: string[] | undefined;
let peerDependencies: string[] | undefined;

try {
  const raw = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));

  if (raw.dependencies && typeof raw.dependencies === 'object') {
    dependencies = Object.keys(raw.dependencies);
  }

  if (raw.devDependencies && typeof raw.devDependencies === 'object') {
    devDependencies = Object.keys(raw.devDependencies);
  }

  if (raw.peerDependencies && typeof raw.peerDependencies === 'object') {
    peerDependencies = Object.keys(raw.peerDependencies);
  }
} catch {
  // No package.json or parse error -- silent skip
}

nodes[namespacedName] = {
  name: namespacedName,
  root: hostRoot,
  // ... existing fields ...
  packageName: typeof packageName === 'string' ? packageName : undefined,
  dependencies,
  devDependencies,
  peerDependencies,
};
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Zod 3 `.passthrough()` | Zod 4 `.passthrough()` | Zod 4.x (2025) | Same API name, works identically. Zod 4's `.passthrough()` on object schemas preserves unrecognized keys |
| Manual `z.record` for loose metadata | Structured `z.object().passthrough()` for typed extraction | This phase | Enables type-safe access to `metadata.js.packageName` while preserving arbitrary metadata |

**Deprecated/outdated:**
- None relevant. Zod 4 and minimatch 10 are both current.

## Open Questions

1. **Does `metadata.js.packageName` always exist in `nx graph --print` output?**
   - What we know: CONTEXT.md states this was verified. The field comes from Nx's JS plugin which resolves it from the project's package.json during graph construction.
   - What's unclear: Projects without a package.json (e.g., pure configuration projects) will have `undefined` here.
   - Recommendation: Handle gracefully -- `packageName` remains `undefined` for such projects. They can still be referenced by Nx project name in `implicitDependencies`.

2. **Should `implicitDependencies` validation reject empty objects/arrays?**
   - What we know: The schema uses `z.record(z.string().min(1), z.array(z.string().min(1)))`. An empty record `{}` is valid. An empty array `[]` for a key is valid.
   - What's unclear: Is `implicitDependencies: {}` meaningfully different from omitting the field? Is `"my-app": []` meaningful?
   - Recommendation: Allow both. Empty record = no overrides = same as omitting. Empty array for a key = no targets for that source = harmless no-op. Simpler schema, fewer edge cases.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.0.0 |
| Config file | `packages/op-nx-polyrepo/vitest.config.mts` |
| Quick run command | `npm exec nx test @op-nx/polyrepo --output-style=static` |
| Full suite command | `npm exec nx test @op-nx/polyrepo --output-style=static` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DETECT-05 (schema) | v1.0 config parses through v1.1 schema without errors | unit | `npm exec nx test @op-nx/polyrepo --output-style=static -- --testPathPattern schema.spec` | Exists, needs new tests |
| DETECT-05 (schema) | `implicitDependencies` field validated by Zod at load time | unit | `npm exec nx test @op-nx/polyrepo --output-style=static -- --testPathPattern schema.spec` | Exists, needs new tests |
| DETECT-05 (types) | `metadata.js.packageName` captured by refined Zod schema | unit | `npm exec nx test @op-nx/polyrepo --output-style=static -- --testPathPattern transform.spec` | Exists, needs new tests |
| DETECT-05 (transform) | `packageName` extracted from graph metadata onto TransformedNode | unit | `npm exec nx test @op-nx/polyrepo --output-style=static -- --testPathPattern transform.spec` | Exists, needs new tests |
| DETECT-05 (transform) | `dependencies`/`devDependencies`/`peerDependencies` read from package.json on disk | unit | `npm exec nx test @op-nx/polyrepo --output-style=static -- --testPathPattern transform.spec` | Exists, needs new tests |
| DETECT-05 (transform) | Missing package.json results in undefined dep fields (silent skip) | unit | `npm exec nx test @op-nx/polyrepo --output-style=static -- --testPathPattern transform.spec` | Exists, needs new tests |

### Sampling Rate
- **Per task commit:** `npm exec nx test @op-nx/polyrepo --output-style=static`
- **Per wave merge:** `npm exec nx test @op-nx/polyrepo --output-style=static`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps
None -- existing test infrastructure covers all phase requirements. Both `schema.spec.ts` and `transform.spec.ts` exist with established patterns for adding new test cases. The transform spec will need `vi.mock('node:fs')` for `readFileSync` to test package.json reading without touching the filesystem.

## Sources

### Primary (HIGH confidence)
- Codebase inspection: `schema.ts`, `types.ts`, `transform.ts`, `cache.ts`, `index.ts` -- current implementation verified
- Codebase inspection: `schema.spec.ts`, `transform.spec.ts`, `index.spec.ts` -- existing test patterns verified
- Runtime verification: Zod 4.3.6, minimatch 10.2.4, Vitest 4.0.0 -- versions confirmed via `node -e`

### Secondary (MEDIUM confidence)
- CONTEXT.md decisions on `metadata.js.packageName` existing in `nx graph --print` output -- stated as verified during discussion

### Tertiary (LOW confidence)
- None

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - all libraries already installed and used in codebase
- Architecture: HIGH - extending existing patterns with minimal new code
- Pitfalls: HIGH - identified from direct codebase analysis of existing patterns

**Research date:** 2026-03-17
**Valid until:** 2026-04-17 (stable -- no external dependencies changing)
