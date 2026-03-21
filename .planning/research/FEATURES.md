# Feature Research

**Domain:** Nx plugin hardening -- static edges, proxy caching, temp directory conventions
**Researched:** 2026-03-22
**Milestone:** v1.2 Static edges and proxy caching
**Confidence:** HIGH

## Context

The v1.1 plugin ships cross-repo dependency auto-detection (package.json + tsconfig paths) using `DependencyType.implicit` edges, a proxy executor that shells out to child repos, and per-repo temp directories at `.repos/<alias>/.tmp/`. The v1.2 milestone hardens three specific areas:

1. **Migrate auto-detected edges from implicit to static** -- semantic correctness and provenance
2. **Enable host-level caching for proxy targets** -- eliminate child Nx bootstrap overhead on warm runs
3. **Rename `.tmp` to `tmp`** -- align with Nx default `.gitignore` convention

These are correctness and performance improvements to existing features, not new user-facing functionality.

## Feature Landscape

### Table Stakes (Users Expect These)

| Feature | Why Expected | Complexity | Dependencies on Existing |
|---------|--------------|------------|--------------------------|
| **Static dependency edges for auto-detected cross-repo deps** | Auto-detected edges come from analyzing package.json and tsconfig files -- they have a known `sourceFile`. The Nx ecosystem treats file-derived edges as `static`, not `implicit`. `implicit` is reserved for manually configured relationships with no source file provenance. Using implicit for auto-detected edges loses provenance, which Nx uses for incremental re-analysis (unchanged files skip dependency re-computation). | MEDIUM | Requires `sourceFile` on each edge. **Critical constraint:** Nx's `validateStaticDependency` requires `sourceFile` when source is an internal project. Nx's `validateCommonDependencyRules` then checks that `sourceFile` exists in either `projectFileMap` or `nonProjectFiles`. Since `.repos/` is gitignored, external project files are NOT in the file map. Only edges **from** host projects to external projects can use `static` with `sourceFile` pointing to the host's package.json/tsconfig. Edges **from** external projects to any target must remain `implicit` or use a non-project file workaround. |
| **Proxy target caching via runtime inputs** | Every proxy target invocation spawns a child Node.js process, loads Nx plugins, reads the project graph, and checks the child cache -- several seconds per target even when cached. Users running `nx test` or `nx build` on host projects that depend on external projects pay this overhead repeatedly. Caching proxy targets at the host level (skip child process entirely when inputs unchanged) is expected for any executor that supports deterministic output. | LOW | The `createProxyTarget` in `transform.ts` currently sets `cache: false` and `inputs: []`. Changing to `cache: true` with a `runtime` input that hashes the child repo's git state enables host caching. No schema changes needed -- Nx natively supports `{ "runtime": "command" }` inputs. |
| **Rename `.tmp` to `tmp` in child repo temp directories** | Nx's default `.gitignore` (from `create-nx-workspace`) includes `/tmp`. Any synced Nx workspace already gitignores `tmp/` at its root. Using `.tmp/` (current) requires explicit `.gitignore` entries in every synced repo. Using `tmp/` gets gitignore coverage for free. | LOW | Two-line change in `executor.ts` (proxy executor) and `extract.ts` (graph extraction). No behavioral change. |

### Differentiators (Competitive Advantage)

| Feature | Value Proposition | Complexity | Dependencies on Existing |
|---------|-------------------|------------|--------------------------|
| **Compound runtime input (HEAD + diff hash)** | A simple `git rev-parse HEAD` input only captures committed changes (post-sync). Users editing files directly in `.repos/<alias>/` (a supported workflow in synthetic monorepos) would not invalidate the cache. A compound input (`HEAD` + `git diff HEAD` hash) catches both sync changes AND uncommitted edits with ~12ms overhead per repo. | LOW | Single runtime command per proxy target. Cross-platform (Git for Windows, macOS, Linux). Nx executes runtime inputs via the shell, so no `.cmd` shim issues. |
| **Granular sourceFile per detection source** | For host-to-external static edges, point `sourceFile` to the specific package.json or tsconfig that declares the dependency (e.g., `packages/my-app/package.json`). This enables Nx's incremental re-analysis: if that file hasn't changed, Nx skips dependency re-computation for that project. | MEDIUM | Requires threading the file path through `detectCrossRepoDependencies`. For host projects, the package.json path is already computed at scan time. For tsconfig aliases, the tsconfig path is known during expansion. |
| **Mixed edge types: static for host-sourced, implicit for external-sourced** | Semantic precision without fighting Nx's validation. Host-to-external edges get full provenance (static + sourceFile). External-to-host and external-to-external edges stay implicit (no sourceFile available in file map). Override edges also stay implicit (manually configured, no source file). | MEDIUM | Requires conditional logic in `maybeEmitEdge` based on whether source is a host or external project. The `projectToRepo` map already distinguishes host (`__host__` sentinel) from external projects. |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| **Make ALL edges static (including external-sourced)** | Semantic purity -- all auto-detected edges come from analyzing files, so they should all be static. | Nx validates `sourceFile` against its file map. Files under `.repos/` are gitignored and absent from the file map. Providing a `sourceFile` that doesn't exist in the file map causes `validateCommonDependencyRules` to throw: `"Source file does not exist in the workspace."` Adding `.repos/` to the file map would require removing it from `.gitignore`, which breaks the plugin's design (synced repos are transient, not committed). | Use mixed edge types: `static` for host-sourced edges (where package.json IS in the file map), `implicit` for external-sourced edges. |
| **File-hash inputs instead of git-based runtime inputs** | Hash individual source files from `.repos/<alias>/` for precise cache keys. | Files in `.repos/` are gitignored and excluded from Nx's input hashing. Nx only hashes files tracked by git for source file inputs. Using `{ "externalDependencies": [...] }` doesn't apply to project-level files. A file glob input like `{ "input": ".repos/nx/**/*" }` would be ignored by the hasher. | Use `runtime` inputs with git commands. Git tracks the repo state comprehensively and the commands are fast (~12ms). |
| **Outputs declaration for proxy targets** | Enable Nx to restore build artifacts from cache (e.g., `.repos/nx/dist/`). | Proxy targets run child Nx, which has its own cache for build artifacts. The host doesn't need to cache the child's dist/ -- it caches the terminal output and success status. Declaring outputs would mean Nx tries to store/restore potentially gigabytes of build artifacts from all external repos. | No `outputs` declaration. The child Nx manages its own cache. Host cache stores terminal output + success flag only. |
| **Per-target runtime inputs** | Different targets might have different relevant inputs (e.g., `test` cares about test files, `build` cares about source files). | All proxy targets delegate to the same child repo. The child Nx handles target-specific caching internally. Per-target inputs at the host level would add complexity without meaningful cache precision improvement -- the child already handles this. | Use the same compound git input for all proxy targets in a repo. The child Nx provides target-level cache granularity. |
| **Clear host cache on sync** | After `polyrepo-sync`, clear host cache entries for affected repos to force rebuild. | The compound runtime input (HEAD + diff) already handles this. After sync, HEAD changes (new commit) or diff changes (working tree delta), invalidating the cache naturally. Manually clearing cache adds complexity and race conditions with concurrent runs. | Let the runtime input handle cache invalidation organically. |

## Feature Dependencies

```
Rename .tmp to tmp (independent, no deps)

Static edge migration
    |-- requires sourceFile threading in detectCrossRepoDependencies
    |-- requires host vs external source discrimination (projectToRepo map)
    |-- blocked by: Nx fileMap validation (external-sourced edges cannot be static)

Proxy target caching
    |-- requires runtime input in createProxyTarget (transform.ts)
    |-- enhanced by: compound input (HEAD + diff)
    |-- independent of: static edge migration

Static edge migration ──independent── Proxy target caching
    (no dependency between them; can be implemented in either order)

Rename .tmp to tmp ──independent── both other features
    (trivial change, can be done first as a quick win)
```

### Dependency Notes

- **Static edge migration requires sourceFile threading:** The current `maybeEmitEdge` function emits edges without `sourceFile`. For static edges, `sourceFile` is mandatory for internal project sources. This requires passing the file path through the detection pipeline.
- **Static edge migration is constrained by Nx validation:** Only edges where the source is a host project (and the package.json/tsconfig is in the file map) can be static. This is an architectural constraint from Nx, not a bug.
- **Proxy caching is completely independent:** It only touches `createProxyTarget` in `transform.ts`. No interaction with dependency detection.
- **`.tmp` rename is a trivial standalone change:** Two files, two lines each. No interaction with other features.

## MVP Definition

### v1.2 Scope (This Milestone)

- [x] **Rename `.tmp` to `tmp`** -- lowest risk, quick win, frees up gitignore headroom
- [x] **Enable proxy caching with compound runtime input** -- highest user impact (eliminates seconds of overhead per proxy target)
- [x] **Migrate host-sourced auto-detected edges to static** -- semantic correctness for edges where sourceFile is available
- [x] **Keep external-sourced edges as implicit** -- respect Nx's fileMap validation constraint
- [x] **Keep override edges as implicit** -- overrides are manually configured, no sourceFile

### Defer to Future

- [ ] **Per-target cache tuning** -- only if users report cache hit rate issues with the compound input
- [ ] **Nx upstream: fileMap for gitignored paths** -- would enable static edges for all auto-detected edges, but requires Nx core changes
- [ ] **Wildcard/glob overrides** -- already in PROJECT.md future section, independent of this milestone

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Proxy target caching (runtime inputs) | HIGH | LOW | P1 |
| Static edges for host-sourced deps | MEDIUM | MEDIUM | P2 |
| Rename `.tmp` to `tmp` | LOW | LOW | P1 |

**Priority key:**
- P1: Do first -- proxy caching has highest impact-to-effort ratio; `.tmp` rename is trivial
- P2: Do second -- static edges improve correctness but require careful validation testing

## Technical Details

### Static vs Implicit Dependencies in Nx

**Confirmed from Nx 22.5.4 source code** (HIGH confidence -- verified against `node_modules/nx/src/project-graph/project-graph-builder.js`):

The `validateDependency` function is called on every dependency returned from `createDependencies` (via `builder.addDependency` in `build-project-graph.js` line 224-225). Validation rules:

1. **`validateStaticDependency`**: If `source` is an internal project (`projects[d.source]` exists) AND `sourceFile` is missing, throws `"Source project file is required"`.
2. **`validateCommonDependencyRules`**: If `sourceFile` is present and `source` is an internal project, calls `getFileData` which checks the file exists in `projectFileMap[source]` or `nonProjectFiles`. Throws `"Source file does not exist in the workspace"` if not found.
3. **`validateImplicitDependency`**: If `source` is an external node (`externalNodes[d.source]`), throws `"External projects can't have implicit dependencies"`.

**Implication for this plugin:**

External projects registered by `createNodesV2` are in `projects` (internal nodes), not `externalNodes` (npm packages). So:
- Static edges FROM external projects require `sourceFile` (rule 1)
- That `sourceFile` must exist in the file map (rule 2)
- `.repos/` files are gitignored, NOT in the file map
- Therefore: static edges FROM external projects will fail validation

The solution: **mixed edge types**. Host-sourced edges use `static` + `sourceFile`. External-sourced edges remain `implicit`.

### Runtime Inputs for Proxy Caching

**Confirmed from Nx documentation** (HIGH confidence):

Runtime inputs use the format `{ "runtime": "command" }`. Nx executes the command via the shell, captures stdout, and includes it in the task hash. Cross-platform considerations:

- Commands must work on Windows, macOS, and Linux
- Avoid `.sh` or `.bat` files
- `git -C .repos/<alias> rev-parse HEAD` works cross-platform (Git for Windows supports `-C`)

**Compound input approach:**

```typescript
inputs: [
  { runtime: `git -C .repos/${repoAlias} rev-parse HEAD` },
  { runtime: `git -C .repos/${repoAlias} diff HEAD` },
]
```

Two separate runtime inputs rather than piped commands. Each contributes independently to the hash. HEAD catches sync changes; diff catches uncommitted edits.

**Alternative: single piped command:**

```typescript
inputs: [
  { runtime: `git -C .repos/${repoAlias} rev-parse HEAD && git -C .repos/${repoAlias} diff HEAD` },
]
```

Both approaches are valid. The two-input approach is more readable; the single-command approach reduces shell invocations. Both produce the same cache invalidation behavior.

**Performance:** `git rev-parse HEAD` is ~2ms. `git diff HEAD` is ~10ms for a 150-project repo. Total overhead: ~12ms per repo, executed once per task hash computation.

### Temp Directory Convention

**Confirmed from Nx ecosystem** (HIGH confidence):

- `create-nx-workspace` generates `.gitignore` with `/tmp` entry
- The Nx repo itself uses `tmp` (without leading slash) in its `.gitignore`
- Plugin e2e tests conventionally use `tmp/nx-e2e` inside the workspace
- `tmp/` is the standard convention; `.tmp/` requires explicit gitignore entries

The rename from `.tmp` to `tmp` aligns with Nx conventions and removes the need for explicit `.gitignore` entries in synced repos.

## Competitor Feature Analysis

| Feature | Nx Native (monorepo) | Turborepo | Rush | Our Approach |
|---------|---------------------|-----------|------|--------------|
| Dependency type precision | Static + implicit + dynamic with sourceFile provenance | Single edge type | Graph-based with phantom deps | Mixed static/implicit based on file map availability |
| Task caching with external inputs | Runtime inputs, env vars, file hashes | File hash + env fingerprint | Build cache with content hash | Runtime inputs with git HEAD + diff |
| Temp directory convention | `tmp/` in default .gitignore | N/A (no plugin temp dirs) | `.rush/temp/` | Migrating from `.tmp/` to `tmp/` |

## Sources

- [Nx: StaticDependency type](https://nx.dev/docs/reference/devkit/StaticDependency) -- sourceFile requirement, validation rules
- [Nx: ImplicitDependency type](https://nx.dev/docs/reference/devkit/ImplicitDependency) -- no sourceFile, "connection without explicit reference"
- [Nx: DependencyType enum](https://nx.dev/nx-api/devkit/documents/DependencyType) -- static, dynamic, implicit values
- [Nx: Configure Inputs for Task Caching](https://nx.dev/docs/guides/tasks--caching/configure-inputs) -- runtime inputs syntax, cross-platform guidance
- [Nx: Inputs and Named Inputs reference](https://nx.dev/docs/reference/inputs) -- runtime input format, hash computation
- [Nx: How Caching Works](https://nx.dev/docs/concepts/how-caching-works) -- computation hash components, cache restore behavior
- [Nx: Extending the Project Graph](https://nx.dev/docs/extending-nx/project-graph-plugins) -- createDependencies, validateDependency
- [Nx Plugin E2E tmp directory discussion](https://github.com/nrwl/nx/discussions/33823) -- tmp directory inside vs outside workspace
- [Nx default .gitignore](https://github.com/nrwl/nx/blob/master/.gitignore) -- `tmp` convention
- Verified against local `node_modules/nx/src/project-graph/project-graph-builder.js` -- validateDependency, validateStaticDependency, validateCommonDependencyRules implementations
- Verified against local `node_modules/nx/src/project-graph/build-project-graph.js` -- builder.addDependency called on every plugin-returned dependency (line 224-225)

---
*Feature research for v1.2: Static edges, proxy caching, and temp directory rename*
*Researched: 2026-03-22*
