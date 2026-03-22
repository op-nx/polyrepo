# Phase 9: Cross-repo Dependency Detection - Context

**Gathered:** 2026-03-17
**Status:** Ready for planning

<domain>
## Phase Boundary

A pure detection function that identifies cross-repo dependency edges from package.json declarations and tsconfig path mappings, applies user overrides and negations, and handles edge cases. Output is `RawProjectGraphDependency[]`. Wiring into `createDependencies` and end-to-end validation are Phase 10.

</domain>

<decisions>
## Implementation Decisions

### Lookup Map Construction

- Build a single `Map<alias, projectName>` used throughout detection
- **Primary source:** `packageName` from `TransformedNode` (populated by Phase 8 extraction from `metadata.js.packageName`)
- **Secondary source:** Provider-side tsconfig path aliases — read each external repo's `tsconfig.base.json` (fall back to `tsconfig.json`), match path alias VALUES against known project roots within that repo, add `alias → namespacedProjectName` entries
- `packageName` takes precedence when both exist for the same identifier (tsconfig alias only fills the gap when no `packageName` exists)
- Host project package names: read from `context.projects[name].metadata?.js?.packageName` at detection time (zero I/O — Nx already resolved)

### Auto-detection: package.json

- Scan `dependencies`, `devDependencies`, and `peerDependencies` arrays on every `TransformedNode` (external projects) and every host project's package.json
- For each dep name that appears in the lookup map → emit a cross-repo edge
- All three fields emit `DependencyType.static` edges — consistent with how Nx's TypeScript plugin treats all imports equally, no distinction between dep field types
- `sourceFile`: host-relative path to the declaring `package.json` (e.g. `.repos/shared/libs/mylib/package.json`)
- Host project dep lists: read from `context.projects[name].root + '/package.json'` at detection time (same pattern as external projects in Phase 8)
- Projects without `package.json`: silently skipped for dep-list detection; can still be targets via `implicitDependencies` overrides

### Auto-detection: tsconfig path mappings (DETECT-04)

- Tsconfig path aliases from **providing repos** expand the lookup map (see "Lookup Map Construction" above)
- **Consumer-side tsconfig paths are NOT dep declarations** — `tsconfig.base.json` is repo-wide, not per-project; treating it as a dep declaration would emit edges from every project in the consuming repo (noisy, unattributable)
- Consumer dep declarations come only from package.json dep lists
- tsconfig-detected edges: `DependencyType.static` with `sourceFile` pointing to the tsconfig file that declared the alias (e.g. `.repos/repo-b/tsconfig.base.json`)
- Host workspace tsconfig (`workspaceRoot/tsconfig.base.json`) also read to expand the lookup map for host-provided projects

### Detection Scope

- Full bidirectional coverage: host→external, external→host, external→external
- All pairs scanned — this is the common case (host app depending on a library from a synced repo)
- Host project data (dep lists, tsconfig) read from disk at detection time using `context.projects` root paths and `context.workspaceRoot`

### Override Processing (OVRD-01, OVRD-02)

- Carrying forward from Phase 8: `implicitDependencies` is `Record<string, string[]>` with minimatch globs on both keys and target values, `!` negation prefix on targets
- Explicit override edges: `DependencyType.implicit` (no `sourceFile` — no file to point to)
- Negation (`!target`) suppresses auto-detected edges matching that target

### Override Validation (OVRD-03)

- Hard fail — throw, not warn
- Collect ALL unknown project references across all override entries first, then throw once with the full list (user fixes everything in one edit)
- Error message format: `Unknown projects in implicitDependencies: nx/missing-lib, shared/ghost-app`
- "Known" projects = `context.projects` (full merged graph — host projects, all namespaced external projects, any other plugin contributions)
- **Negation overrides also hard-fail** when referencing unknown projects — same strict validation, symmetric with positive references; a negation on a non-existent project is a config error

### Claude's Discretion

- Function signature and file layout (pure function in its own `detect.ts` or inline in `index.ts`)
- Cycle detection strategy — whether to detect, warn, or pass through to Nx
- Scoped package handling (`@org/package`) — no special handling needed, works identically as a map key
- Exact error message wording and formatting

</decisions>

<code_context>

## Existing Code Insights

### Reusable Assets

- `TransformedNode` (`types.ts`): already has `packageName`, `dependencies`, `devDependencies`, `peerDependencies` populated by Phase 8
- `PolyrepoGraphReport` (`types.ts`): the cached graph report — `createDependencies` calls `populateGraphReport` to get it
- `polyrepoConfigSchema` (`schema.ts`): `implicitDependencies: Record<string, string[]>` already validated at config level
- `DependencyType`, `RawProjectGraphDependency` from `@nx/devkit`: the output types for the detection function

### Established Patterns

- Silent skip on missing files: Phase 8 used `try/catch` with no-op for missing `package.json` — same pattern for missing tsconfig files
- SIFERS test pattern: no `beforeEach`/`afterEach`; typed mocks via explicit setup functions
- Zod schemas at all `JSON.parse` boundaries: tsconfig file reads need Zod validation

### Integration Points

- `createDependencies` in `index.ts` — currently emits only intra-repo edges; Phase 9's pure detection function will be called from here in Phase 10
- `populateGraphReport` already called in `createDependencies` — Phase 9's function receives the report as input
- `context.projects` and `context.workspaceRoot` available in `createDependencies` — needed for host project data reads

</code_context>

<specifics>
## Specific Ideas

- The lookup map is the single join point for all detection strategies — both `packageName` and tsconfig path aliases feed into it. This keeps the matching logic uniform regardless of how a project's identity was declared.
- The provider-side tsconfig insight: external repo-b's `tsconfig.base.json` declaring `"@acme/core": ["libs/core/src/index.ts"]` means repo-b's `libs/core` project IS the provider of `@acme/core`, even with no `package.json`. This covers internal-library enterprise setups (large Angular workspaces, Turborepo → Nx migrations, plugin family repos) without the attribution noise of consumer-side tsconfig scanning.
- Override validation collects all errors before throwing — user fixes all typos in one edit, not one at a time.

</specifics>

<deferred>
## Deferred Ideas

- **Consumer-side tsconfig paths as dep declarations** — `tsconfig.base.json` is repo-wide, not per-project; emitting edges from all projects in a repo for each path alias is too noisy. Defer to v1.2 once per-project tsconfig analysis is designed.
- **Extended path alias resolution for consuming repos** — provider-side resolution (decided: yes) handles the common case. Consumer-side root resolution adds complexity and the attribution problem remains unsolved.
- **Dependency edge type control** — letting users specify `implicit`/`static`/`dynamic` per override. Default to `implicit` for overrides, `static` for auto-detected. Revisit if users request granularity. (Carried from Phase 8.)
- **Extended path alias resolution without packageName** — projects with no `package.json` name AND no tsconfig alias in their providing repo remain invisible to detection. Could be addressed by deeper per-project tsconfig.json scanning in v1.2.

</deferred>

---

_Phase: 09-cross-repo-dependency-detection_
_Context gathered: 2026-03-17_
