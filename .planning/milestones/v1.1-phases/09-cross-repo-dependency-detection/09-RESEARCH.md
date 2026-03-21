# Phase 9: Cross-repo Dependency Detection - Research

**Researched:** 2026-03-17
**Domain:** Nx plugin `createDependencies` — pure detection function for cross-repo edges
**Confidence:** HIGH

## Summary

Phase 9 builds a pure detection function that consumes the `PolyrepoGraphReport` produced by
Phase 8 and emits `RawProjectGraphDependency[]` representing cross-repo edges. The function
has three independent detection paths (package.json dep lists, tsconfig path aliases as lookup
map sources, and explicit config overrides) that all funnel through a single
`Map<packageNameOrAlias, namespacedProjectName>` join table. This design is already decided in
CONTEXT.md; the research role is to verify Nx type shapes, identify implementation pitfalls,
and map requirements to testable behaviors.

The code shape is well-understood from the existing codebase: `TransformedNode` already holds
`packageName`, `dependencies`, `devDependencies`, `peerDependencies` from Phase 8. The
`createDependencies` hook in `index.ts` already calls `populateGraphReport` and receives
`context.projects` and `context.workspaceRoot`. Phase 9 inserts one new pure function between
those two wires.

**Primary recommendation:** Implement as a standalone `detect.ts` module exporting
`detectCrossRepoDependencies(report, config, context)` returning `RawProjectGraphDependency[]`.
Wire it into `createDependencies` in Phase 10. Keep the pure function completely I/O-free
except for the two file reads (tsconfig files) needed to expand the lookup map.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Lookup Map Construction**
- Build a single `Map<alias, projectName>` used throughout detection
- Primary source: `packageName` from `TransformedNode` (populated by Phase 8)
- Secondary source: provider-side tsconfig path aliases — read each external repo's
  `tsconfig.base.json` (fall back to `tsconfig.json`), match path alias VALUES against known
  project roots within that repo, add `alias → namespacedProjectName` entries
- `packageName` takes precedence when both exist for the same identifier
- Host project package names: read from `context.projects[name].metadata?.js?.packageName`
  at detection time (zero I/O)

**Auto-detection: package.json**
- Scan `dependencies`, `devDependencies`, and `peerDependencies` on every `TransformedNode`
  (external projects) and every host project's package.json
- All three fields emit `DependencyType.static` edges
- `sourceFile`: host-relative path to the declaring `package.json`
- Host project dep lists: read from `context.projects[name].root + '/package.json'`
- Projects without `package.json`: silently skipped for dep-list detection; can still be
  targets via `implicitDependencies` overrides

**Auto-detection: tsconfig path mappings (DETECT-04)**
- Tsconfig path aliases from providing repos expand the lookup map (provider-side only)
- Consumer-side tsconfig paths are NOT dep declarations (deferred to v1.2)
- Tsconfig-detected edges: `DependencyType.static` with `sourceFile` pointing to the tsconfig
  file that declared the alias (e.g. `.repos/repo-b/tsconfig.base.json`)
- Host workspace tsconfig (`workspaceRoot/tsconfig.base.json`) also read to expand the lookup
  map for host-provided projects

**Detection Scope**
- Full bidirectional coverage: host→external, external→host, external→external
- All pairs scanned

**Override Processing (OVRD-01, OVRD-02)**
- `implicitDependencies` is `Record<string, string[]>` with minimatch globs on both keys and
  target values, `!` negation prefix on targets
- Explicit override edges: `DependencyType.implicit` (no `sourceFile`)
- Negation (`!target`) suppresses auto-detected edges matching that target

**Override Validation (OVRD-03)**
- Hard fail — throw, not warn
- Collect ALL unknown project references across all override entries first, then throw once
- Error message format: `Unknown projects in implicitDependencies: nx/missing-lib, shared/ghost-app`
- "Known" projects = `context.projects` (full merged graph)
- Negation overrides also hard-fail when referencing unknown projects

### Claude's Discretion

- Function signature and file layout (pure function in its own `detect.ts` or inline in `index.ts`)
- Cycle detection strategy — whether to detect, warn, or pass through to Nx
- Scoped package handling (`@org/package`) — no special handling needed, works identically as a map key
- Exact error message wording and formatting

### Deferred Ideas (OUT OF SCOPE)

- Consumer-side tsconfig paths as dep declarations
- Extended path alias resolution for consuming repos
- Dependency edge type control per override
- Extended path alias resolution without packageName
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| DETECT-01 | Plugin auto-detects cross-repo edges from `dependencies` field | `TransformedNode.dependencies` already populated; lookup map match → emit `StaticDependency` |
| DETECT-02 | Plugin auto-detects cross-repo edges from `devDependencies` field | `TransformedNode.devDependencies` already populated; same lookup map match |
| DETECT-03 | Plugin auto-detects cross-repo edges from `peerDependencies` field | `TransformedNode.peerDependencies` already populated; same lookup map match |
| DETECT-04 | Plugin auto-detects cross-repo edges from tsconfig path mappings | Provider-side tsconfig read expands lookup map; match during dep-list scan |
| OVRD-01 | User can declare explicit cross-repo dependency edges in plugin config | `implicitDependencies` already validated in schema.ts; emit `ImplicitDependency` |
| OVRD-02 | User can negate auto-detected edges via override config | `!target` prefix suppresses edges from auto-detection output |
| OVRD-03 | Plugin fails at load time when override references unknown project | Throw with collected list; validate against `context.projects` |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@nx/devkit` | `>=20.0.0` (peer) | `DependencyType`, `RawProjectGraphDependency`, `CreateDependenciesContext` | Already the plugin's peer dependency; provides exact output types |
| `node:fs` (`readFileSync`) | Node built-in | Synchronous tsconfig file reads | Already used in `transform.ts` for package.json reads; same pattern |
| `node:path` (`join`) | Node built-in | Construct tsconfig file paths | Already imported throughout codebase |
| `zod` v4 | `^4.0.0` | Validate tsconfig JSON at file-read boundary | Project-wide Zod policy; tsconfig is an external file |
| `minimatch` | `10.2.4` | Glob matching for `implicitDependencies` keys and values | Transitive dep from `nx`; already at workspace root |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `minimatch` (named export) | 10.2.4 | `minimatch(string, pattern)` for glob matching | Override key and value matching |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `minimatch` | `micromatch` | micromatch is faster but not available as a transitive dep; minimatch is already present via nx |
| `readFileSync` | `readFile` (async) | Async adds complexity with no benefit; tsconfig reads happen once at startup |

**Installation:**

No new dependencies. All required libraries are already in the workspace (`minimatch` via nx
transitive, `node:fs`/`node:path` built-ins, `zod` already a direct dep, `@nx/devkit` already
a peer dep).

## Architecture Patterns

### Recommended Project Structure

```
src/lib/graph/
├── detect.ts          # NEW: pure detection function (Phase 9)
├── detect.spec.ts     # NEW: unit tests for detection
├── extract.ts         # existing: extracts nx graph JSON from child repo
├── cache.ts           # existing: two-layer cache for graph reports
├── transform.ts       # existing: transforms raw graph to namespaced nodes
└── types.ts           # existing: Zod schemas + TransformedNode, PolyrepoGraphReport
```

`detect.ts` is a pure function module — no top-level side effects. Called from `index.ts`'s
`createDependencies` in Phase 10.

### Pattern 1: Lookup Map Construction

**What:** Build `Map<string, string>` mapping `packageName/tsconfig-alias → namespacedProjectName`
before any edge detection runs. All three detection paths (external nodes, host nodes, override
validation) consult this single map.

**When to use:** At the start of `detectCrossRepoDependencies`, before iterating any node lists.

**Example:**
```typescript
// Source: project codebase pattern from transform.ts
function buildLookupMap(
  report: PolyrepoGraphReport,
  context: CreateDependenciesContext,
  workspaceRoot: string,
): Map<string, string> {
  const map = new Map<string, string>();

  // Primary: packageName from TransformedNode (Phase 8 populated)
  for (const [, repoReport] of Object.entries(report.repos)) {
    for (const [, node] of Object.entries(repoReport.nodes)) {
      if (node.packageName) {
        map.set(node.packageName, node.name);
      }
    }
  }

  // Secondary: tsconfig path aliases from providing repos (provider-side only)
  // ... read tsconfig.base.json or tsconfig.json from each .repos/<alias>/
  // ... parse paths entries, match alias value root against known project roots

  // Host project packageNames (zero I/O)
  for (const [projectName, projectConfig] of Object.entries(context.projects)) {
    const pkgName = projectConfig.metadata?.['js']?.['packageName'];
    if (typeof pkgName === 'string') {
      map.set(pkgName, projectName);
    }
  }

  return map;
}
```

### Pattern 2: Tsconfig Path Alias Extraction

**What:** Read `tsconfig.base.json` (fall back to `tsconfig.json`) from each external repo
root at `.repos/<alias>/`. Parse `compilerOptions.paths`. For each alias, find which project
in that repo owns the declared path root. Add `alias → namespacedProjectName` to the lookup
map only if no `packageName` entry already exists for that identifier.

**When to use:** During lookup map construction, once per external repo.

**Tsconfig Zod schema** (new, minimal):
```typescript
// Source: project Zod convention from types.ts/config/resolve.ts
const tsConfigPathsSchema = z
  .object({
    compilerOptions: z
      .object({
        paths: z.record(z.string(), z.array(z.string())).optional(),
      })
      .loose()
      .optional(),
  })
  .loose();
```

**Path alias → project root matching:**
```typescript
// alias value example: ["libs/core/src/index.ts"]
// strip filename: "libs/core/src"
// walk up segments until matching a known project root in that repo
// e.g. node.root for repo-b/core might be ".repos/repo-b/libs/core"
// compare against ".repos/repo-b/" + pathSegments[0..n]
```

**Silent skip pattern** (consistent with Phase 8 `transform.ts`):
```typescript
try {
  const raw = JSON.parse(readFileSync(tsconfigPath, 'utf-8'));
  const result = tsConfigPathsSchema.safeParse(raw);
  if (result.success) {
    // process paths
  }
} catch {
  // missing tsconfig -- silently skip
}
```

### Pattern 3: Dep-List Edge Emission

**What:** For every consumer project (external node or host project), iterate all three dep
arrays. Look up each dep name in the lookup map. If found and the target is in a different
repo than the source, emit a `StaticDependency`.

**When to use:** After lookup map is built; the main detection loop.

**Key shape** (from verified `@nx/devkit` types):
```typescript
// StaticDependency from nx/src/project-graph/project-graph-builder.d.ts
const edge: RawProjectGraphDependency = {
  source: sourceProjectName,         // namespaced, e.g. "repo-a/my-app"
  target: targetProjectName,         // namespaced, e.g. "repo-b/my-lib"
  sourceFile: relativePathToPackageJson, // e.g. ".repos/repo-a/apps/my-app/package.json"
  type: DependencyType.static,
};

// ImplicitDependency for overrides (no sourceFile field)
const overrideEdge: RawProjectGraphDependency = {
  source: sourceProjectName,
  target: targetProjectName,
  type: DependencyType.implicit,
};
```

### Pattern 4: Override Processing

**What:** Iterate `config.implicitDependencies` entries. For each key pattern, match against
all known project names using `minimatch`. For each matched source project, iterate target
patterns. Handle `!` prefix (negation) separately from positive targets.

**Negation suppression:** Collect positive edges from auto-detection into a working set, then
remove any edge whose source+target matches a negation override.

**Minimatch usage:**
```typescript
import { minimatch } from 'minimatch';

// key matching (project name patterns)
const matchedSources = Object.keys(context.projects).filter(
  name => minimatch(name, keyPattern),
);

// target matching (strip ! prefix first)
const targetPattern = targetEntry.startsWith('!')
  ? targetEntry.slice(1)
  : targetEntry;
const isNegation = targetEntry.startsWith('!');
const matchedTargets = Object.keys(context.projects).filter(
  name => minimatch(name, targetPattern),
);
```

### Pattern 5: Override Validation

**What:** Before emitting any edges, validate that all project names referenced in
`implicitDependencies` (both positive and negation targets, after stripping `!`) exist in
`context.projects`. Collect all unknowns across all entries, then throw once.

```typescript
const unknowns: string[] = [];

for (const [keyPattern, targets] of Object.entries(implicitDeps)) {
  // Check if ANY existing project matches the key pattern
  const keyHasMatch = Object.keys(context.projects).some(
    name => minimatch(name, keyPattern),
  );

  if (!keyHasMatch) {
    unknowns.push(keyPattern);
  }

  for (const target of targets) {
    const targetPattern = target.startsWith('!') ? target.slice(1) : target;
    const targetHasMatch = Object.keys(context.projects).some(
      name => minimatch(name, targetPattern),
    );

    if (!targetHasMatch) {
      unknowns.push(targetPattern);
    }
  }
}

if (unknowns.length > 0) {
  throw new Error(
    `Unknown projects in implicitDependencies: ${unknowns.join(', ')}`,
  );
}
```

**Note:** The locked decision says to hard-fail when any override references a project not
present in the graph. Glob patterns that match zero projects should be treated as unknown
project references.

### Anti-Patterns to Avoid

- **Consumer-side tsconfig scanning:** The `tsconfig.base.json` at the consuming repo's root is
  repo-wide — it does not identify which project depends on which alias. Only provider-side
  tsconfig files (declaring what they export via path aliases) expand the lookup map.
- **Double-path pitfall:** When constructing the tsconfig file path for a `.repos/<alias>` repo,
  use `join(workspaceRoot, '.repos', alias, 'tsconfig.base.json')` — NOT the rewritten
  `node.root` which already includes `.repos/<alias>/`.
- **Modifying `PolyrepoGraphReport`:** The detection function must not mutate the report;
  it receives it as input and produces a fresh `RawProjectGraphDependency[]`.
- **Intra-repo edge emission:** Only emit an edge when source and target are in different repos
  (or host vs. external). Intra-repo edges are already handled by `repoReport.dependencies`
  passed through `createDependencies` from Phase 1.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Glob pattern matching | Custom regex or string-split matching | `minimatch` | Edge cases in `{a,b}` brace expansion, `**` globstar, case sensitivity; minimatch handles all of them |
| tsconfig parsing | Custom regex JSON extraction | Zod + `JSON.parse` + `safeParse` | Project-wide Zod policy; tsconfig files have comments in practice but Node's `JSON.parse` is sufficient for the `paths` use case; if tsconfig has comments it will throw and the silent-skip catches it |
| Project name lookup deduplication | Manual Set operations | `Map.has()` guard before `Map.set()` | `packageName` precedence over tsconfig alias is simply "only set if key not already present" |

**Key insight:** The entire detection algorithm reduces to a lookup table join — build the map
once, iterate consumer dep lists once. No graph traversal, no recursive resolution. This
simplicity is by design.

## Common Pitfalls

### Pitfall 1: tsconfig Path Alias Value Format

**What goes wrong:** `tsconfig.base.json` path alias values are file globs, not directories:
`"@acme/core": ["libs/core/src/index.ts"]`. Naively using the value as a project root match
fails because Nx project roots are directories (`libs/core`), not files.

**Why it happens:** tsconfig `paths` values point to entry points, not project roots.

**How to avoid:** Strip the filename from the last path segment (everything after the last `/`)
and then progressively trim trailing segments until matching a known project root. Alternatively,
find the project whose `root` (after stripping the `.repos/<alias>/` prefix) is a prefix of
the path alias value.

**Warning signs:** Lookup map populated from tsconfig but no edges emitted for packages
declared via tsconfig alias.

### Pitfall 2: Cross-repo vs. Same-repo Edge Guard

**What goes wrong:** Emitting edges between two projects in the same repo (already in
`repoReport.dependencies`) or between host projects that are internal Nx deps (not cross-repo).

**Why it happens:** The lookup map contains ALL projects. If `repo-a/my-app` depends on
`@scope/my-lib` and `repo-a/my-lib` publishes `@scope/my-lib`, this is an intra-repo edge.

**How to avoid:** After looking up a dep name and finding a target project name, check whether
the source and target are in the same repo (same prefix before `/`) OR both are host projects.
Only emit when they cross a repo boundary.

**Warning signs:** Duplicate edges appearing in the graph (Nx may deduplicate but it's
confusing noise).

### Pitfall 3: minimatch Import Style

**What goes wrong:** `import minimatch from 'minimatch'` (default import) fails because
minimatch v10 is an ESM-first package with named exports only.

**Why it happens:** minimatch v10 changed its export structure; the default export is not the
main function.

**How to avoid:** Use named import: `import { minimatch } from 'minimatch'`. This is verified
from the runtime check (`Object.keys(m)` includes `'minimatch'` as a named export).

**Warning signs:** TypeScript error `Module has no default export` or runtime
`TypeError: minimatch is not a function`.

### Pitfall 4: Negation Scope — Remove from Auto-detected, Not Override List

**What goes wrong:** Treating negation as "don't add this edge" during the override loop,
which misses suppressing auto-detected edges that were already accumulated.

**Why it happens:** Natural implementation instinct is to check negation during processing,
but the semantics are "suppress from final output regardless of source."

**How to avoid:** Complete auto-detection first, then apply negation overrides as a filter
pass on the accumulated edge list. Use a `Set<string>` of `"source:target"` keys for
O(1) suppression lookup.

### Pitfall 5: Override Validation — Glob Patterns with Zero Matches

**What goes wrong:** A key pattern like `"nx/non-existent-*"` matches zero projects but
passes naive validation (because it's syntactically valid as a glob).

**Why it happens:** Pattern validity is conflated with pattern utility.

**How to avoid:** The CONTEXT.md decision is clear: "unknown projects" means patterns that
match zero projects in `context.projects`. Run `Object.keys(context.projects).some(name => minimatch(name, pattern))`
and fail if no match.

### Pitfall 6: Host Project package.json Read — Path Construction

**What goes wrong:** `context.projects[name].root` may be `"."` for the workspace root
project, producing `join(workspaceRoot, '.', 'package.json')` which is correct, but other
relative roots like `"apps/my-app"` need `join(workspaceRoot, root, 'package.json')`.

**Why it happens:** `context.projects` contains raw project configurations where `root` is
always relative to `workspaceRoot`.

**How to avoid:** Always `join(workspaceRoot, projectConfig.root, 'package.json')`. Same
silent-skip `try/catch` as Phase 8's `transform.ts`.

## Code Examples

Verified patterns from official sources and existing codebase:

### RawProjectGraphDependency Type (verified from nx source)

```typescript
// Source: node_modules/nx/src/project-graph/project-graph-builder.d.ts
// StaticDependency — for package.json and tsconfig-detected edges
type StaticDependency = {
  source: string;
  target: string;
  sourceFile?: string; // relative from workspace root
  type: typeof DependencyType.static; // 'static'
};

// ImplicitDependency — for manual override edges
type ImplicitDependency = {
  source: string;
  target: string;
  // NO sourceFile field
  type: typeof DependencyType.implicit; // 'implicit'
};

type RawProjectGraphDependency = ImplicitDependency | StaticDependency | DynamicDependency;
```

### DependencyType Values (verified at runtime)

```typescript
// Source: runtime check against @nx/devkit
DependencyType.static   === 'static'
DependencyType.implicit === 'implicit'
DependencyType.dynamic  === 'dynamic'
```

### minimatch Named Import (verified at runtime)

```typescript
// Source: minimatch v10.2.4 package in workspace node_modules
import { minimatch } from 'minimatch';

minimatch('repo-a/my-app', 'repo-a/*') // true
minimatch('repo-b/my-lib', 'repo-a/*') // false
minimatch('nx/missing', 'nx/missing')  // true (exact match also works)
```

### Tsconfig paths Zod Schema

```typescript
// Pattern: same as existing resolve.ts loose schema pattern
const tsConfigPathsSchema = z
  .object({
    compilerOptions: z
      .object({
        paths: z.record(z.string(), z.array(z.string())).optional(),
      })
      .loose()
      .optional(),
  })
  .loose();

// Graceful fallback (no throw on missing tsconfig)
try {
  const raw = JSON.parse(readFileSync(tsConfigPath, 'utf-8'));
  const result = tsConfigPathsSchema.safeParse(raw);
  if (result.success && result.data.compilerOptions?.paths) {
    // process paths
  }
} catch {
  // Missing file or JSON parse error -- silently skip
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `z.object().passthrough()` | `z.object().loose()` | Phase 8 | `passthrough()` was deprecated in Zod v4; `.loose()` is the correct equivalent |
| Manual dep array loops | Dep arrays pre-populated on `TransformedNode` | Phase 8 | No per-node file reads in detect.ts for external nodes |
| `import minimatch from 'minimatch'` | `import { minimatch } from 'minimatch'` | minimatch v10 | Default export removed; named export only |

**Deprecated/outdated:**
- `z.passthrough()`: Replaced by `.loose()` in Zod v4 (already corrected in Phase 8 — `types.ts` uses `.loose()`)

## Open Questions

1. **Tsconfig path alias → project root matching algorithm**
   - What we know: values are like `["libs/core/src/index.ts"]`; project roots are like `libs/core`
   - What's unclear: exact string manipulation to strip filename and match progressively shorter
     path prefixes against project roots
   - Recommendation: implement as "strip everything from the last `/` onward, then check if
     any `TransformedNode.root` (minus the `.repos/<alias>/` prefix) equals or is a prefix of
     the result; walk up one more segment if no match." Claude has discretion on exact algorithm.

2. **Cycle detection**
   - What we know: CONTEXT.md leaves this to Claude's discretion
   - What's unclear: whether Nx's own graph builder detects cycles or silently drops them
   - Recommendation: pass through to Nx (no cycle detection in Phase 9). Nx's graph
     infrastructure handles circular dependency warnings in the visualization layer. Adding cycle
     detection adds complexity with no user-visible benefit at this phase.

3. **Deduplication of edges emitted by multiple detection paths**
   - What we know: the same edge could be detected via package.json AND tsconfig alias
   - What's unclear: whether Nx deduplicates `RawProjectGraphDependency` entries by source+target
   - Recommendation: deduplicate in the detection function using a `Set<string>` of
     `"source::target"` keys before adding to the output array. This is safe and prevents
     noise regardless of Nx behavior.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest (configured in `packages/op-nx-polyrepo/vitest.config.mts`) |
| Config file | `packages/op-nx-polyrepo/vitest.config.mts` |
| Quick run command | `pnpm nx test @op-nx/polyrepo --output-style=static` |
| Full suite command | `pnpm nx test @op-nx/polyrepo --output-style=static` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DETECT-01 | Emits `static` edge when consumer's `dependencies` contains a packageName from lookup map | unit | `pnpm nx test @op-nx/polyrepo --output-style=static` | Wave 0 |
| DETECT-02 | Emits `static` edge when consumer's `devDependencies` contains a lookup map entry | unit | `pnpm nx test @op-nx/polyrepo --output-style=static` | Wave 0 |
| DETECT-03 | Emits `static` edge when consumer's `peerDependencies` contains a lookup map entry | unit | `pnpm nx test @op-nx/polyrepo --output-style=static` | Wave 0 |
| DETECT-04 | tsconfig path alias in providing repo expands lookup map; detected as cross-repo edge | unit | `pnpm nx test @op-nx/polyrepo --output-style=static` | Wave 0 |
| OVRD-01 | Explicit `implicitDependencies` entries emit `implicit` edges for matched project pairs | unit | `pnpm nx test @op-nx/polyrepo --output-style=static` | Wave 0 |
| OVRD-02 | `!target` negation in `implicitDependencies` suppresses auto-detected edges | unit | `pnpm nx test @op-nx/polyrepo --output-style=static` | Wave 0 |
| OVRD-03 | Throw with all unknown project names when override references non-existent project | unit | `pnpm nx test @op-nx/polyrepo --output-style=static` | Wave 0 |

### Sampling Rate

- **Per task commit:** `pnpm nx test @op-nx/polyrepo --output-style=static`
- **Per wave merge:** `pnpm nx test @op-nx/polyrepo --output-style=static`
- **Phase gate:** Full suite green + `pnpm nx build @op-nx/polyrepo --output-style=static` before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] `packages/op-nx-polyrepo/src/lib/graph/detect.spec.ts` — covers all DETECT-* and OVRD-* requirements (new file)
- [ ] `packages/op-nx-polyrepo/src/lib/graph/detect.ts` — the module under test (new file)

*(Existing test infrastructure — vitest config, `assertDefined`, SIFERS pattern, Zod mocking
patterns — fully covers everything else. No new config or shared fixture files needed.)*

## Sources

### Primary (HIGH confidence)

- Existing codebase (`types.ts`, `transform.ts`, `index.ts`, `schema.ts`) — verified directly
- `node_modules/nx/src/project-graph/project-graph-builder.d.ts` — `StaticDependency`,
  `ImplicitDependency`, `RawProjectGraphDependency` shapes verified
- Runtime check of `@nx/devkit` exports — `DependencyType` values confirmed as `'static'`,
  `'implicit'`, `'dynamic'`
- Runtime check of `minimatch` v10.2.4 — named export `{ minimatch }` confirmed, glob matching
  verified

### Secondary (MEDIUM confidence)

- `.claude/skills/type-safety/SKILL.md` and `rules/sifers-pattern.md` — SIFERS pattern,
  banned constructs, Zod conventions (project-specific, verified against existing test files)
- `packages/op-nx-polyrepo/vitest.config.mts` — test framework configuration verified

### Tertiary (LOW confidence)

None — all findings verified from primary sources.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all libraries verified at runtime from workspace node_modules
- Architecture: HIGH — pattern is direct extension of Phase 8's established transform.ts approach
- Nx type shapes: HIGH — verified from .d.ts files in installed nx package
- Pitfalls: HIGH — derived from existing code patterns and verified runtime behavior
- minimatch API: HIGH — verified from runtime import

**Research date:** 2026-03-17
**Valid until:** 2026-04-17 (stable Nx + Zod ecosystem; minimatch v10 API stable)
