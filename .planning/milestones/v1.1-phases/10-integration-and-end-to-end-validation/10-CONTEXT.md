# Phase 10: Integration and End-to-End Validation - Context

**Gathered:** 2026-03-18
**Status:** Ready for planning

<domain>
## Phase Boundary

Wire `detectCrossRepoDependencies` into `createDependencies` and validate that cross-repo dependency edges are observable in `nx graph` via e2e tests (testcontainers). Covers DETECT-06. DETECT-07 (`nx affected` cross-repo) is deferred to a future milestone (see Deferred Ideas).

</domain>

<decisions>
## Implementation Decisions

### E2e Fixture Topology

- **Reuse the existing nx monorepo** as the external repo for cross-repo dep testing — no new fixture repo needed
- The host workspace's root `package.json` already contains `@nx/*` dependencies/devDependencies — these are the cross-repo dep targets. No manual dependency injection needed in test setup.
- The root workspace project (e.g., `@workspace/source`) is the dependency source; namespaced nx projects (e.g., `nx/devkit`) are the targets
- **E2e coverage includes auto-detection, overrides, AND negation suppression** — three separate test scenarios with different `nx.json` plugin configurations
- Override test: configure `implicitDependencies` with an explicit edge between two projects, assert it appears in the graph
- Negation test: configure `implicitDependencies` with a `!` negation on an auto-detected edge, assert it is absent from the graph

### Graph Verification Method

- Use `nx graph --print` to dump the full project graph as JSON to stdout inside the container
- Parse the JSON and assert specific edge objects: check `dependencies[sourceProject]` contains an entry with the expected `target` project name AND the correct `type` (`static` for auto-detected, `implicit` for overrides)
- Always pass `NX_DAEMON=false` when running graph commands in the container to avoid flaky daemon-not-ready failures on cold starts

### DETECT-07 Scoping

- **DETECT-07 (`nx affected` cross-repo) is deferred** to a future milestone
- **Root cause:** Nx's `calculateFileChanges()` filters files through `.gitignore` before any file-to-project mapping — `.repos/` is gitignored, so both `--files` and `--base/--head` are blind to synced repo changes. No plugin hook exists to inject touched files or projects into the affected computation.
- **What works:** Cross-repo edge traversal is correct — if Nx knows a project changed, it follows the edges. The gap is in the initial "which files changed" step.
- **Future solution:** A `polyrepo-affected` executor that runs `git -C .repos/<alias> diff --name-only`, maps changed files to namespaced projects, and delegates to `nx run-many --projects=<list>`. This belongs in a later milestone bundled with polyrepo CLI adoption research and `.gitignore` surface area audit.
- DETECT-07 stays in REQUIREMENTS.md as a future requirement, not a Phase 10 deliverable

### Error Handling in createDependencies

- **Separate error paths** for extraction vs. detection:
  - `populateGraphReport` failures: caught, return empty array (existing silent degradation pattern)
  - `detectCrossRepoDependencies` errors: **not caught** — let validation errors (OVRD-03: unknown projects in overrides) propagate to Nx so users see a clear error message
- No additional defensive catch around `detectCrossRepoDependencies` — internal errors (file reads, tsconfig parsing) are already handled with try/catch + continue inside the function itself
- The only throw path is OVRD-03 validation (`detect.ts:337`), which is intentionally loud per Phase 9 success criteria #5

### Claude's Discretion

- Graph verification method specifics (which `nx graph` subcommand/flags to use for JSON output)
- Test file organization (new spec file vs. extending existing `op-nx-polyrepo.spec.ts`)
- Which specific `@nx/*` packages to use as assertion targets in auto-detection tests
- Exact container setup sequence for override/negation test scenarios (how to reconfigure `nx.json` between tests)
- Edge deduplication strategy when intra-repo edges overlap with cross-repo edges

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets

- `detectCrossRepoDependencies` (`graph/detect.ts`): Pure function, fully unit-tested in Phase 9. Takes `(report, config, context)`, returns `RawProjectGraphDependency[]`. Ready to wire.
- `populateGraphReport` (`graph/cache.ts`): Two-layer cache (memory + disk). Already called in `createDependencies`. Returns the `PolyrepoGraphReport` needed by the detection function.
- `validateConfig` (`config/validate.ts`): Parses and validates `PolyrepoConfig` including `implicitDependencies`. Already called in `createDependencies`.
- Testcontainers global setup (`e2e/src/setup/global-setup.ts`): Builds Docker image, starts Verdaccio, publishes plugin, commits snapshot. Injects `snapshotImage` via Vitest `provide()`.

### Established Patterns

- E2e tests use `container.exec(['npx', 'nx', ...])` to run Nx commands inside Docker
- `DependencyType.static` for auto-detected edges, `DependencyType.implicit` for overrides (Phase 9)
- SIFERS test pattern: no `beforeEach`/`afterEach`; typed mocks via explicit setup functions
- Silent skip on missing files: `try/catch` with `continue` for missing `package.json` / tsconfig


### Integration Points

- `createDependencies` in `index.ts:89-116`: The wiring point. Currently iterates `repoReport.dependencies` for intra-repo edges. Phase 10 adds a `detectCrossRepoDependencies` call after extraction, merging its output into the returned array.
- `context.projects` available in `createDependencies`: The merged project graph — all host + external projects. Passed to the detection function.
- E2e snapshot image: Tests spin up containers from the committed snapshot. Each test can modify `nx.json` inside the container to configure different plugin options.

</code_context>

<specifics>
## Specific Ideas

- The host workspace's existing `@nx/*` devDependencies are the natural test fixture — the plugin should detect edges from the host workspace project to the corresponding namespaced nx projects (e.g., `nx/devkit`) without any test-specific modifications.
- For override/negation tests, modify `nx.json` inside the container between test cases using `container.exec(['sh', '-c', 'echo ... > nx.json'])` to swap plugin configurations.
- Research finding documented in `research-detect-07.md`: Nx's `.gitignore` filtering in `calculateFileChanges()` is the blocker for cross-repo `nx affected`. The reverse-dep traversal itself works correctly once a starting project is identified.

</specifics>

<deferred>
## Deferred Ideas

- **Cross-repo `nx affected` support (DETECT-07)** — Requires a `polyrepo-affected` executor that constructs touched-project lists from `git -C .repos/<alias> diff`. Deferred to a future milestone bundled with:
  - Research into adopting existing polyrepo CLIs (meta, git-subrepo, etc.) for Git DX instead of custom commands
  - Audit of which Nx APIs/commands are affected by `.gitignore` filtering (affected, caching, hashing, watch mode)
  - Potential redesign of the synthetic monorepo file/folder/configuration structure based on research findings
- **Consumer-side tsconfig path resolution for cross-repo detection** — Carried from Phase 9; deferred to v1.2+
- **Dependency edge type control on overrides** — Carried from Phase 8/9; default `implicit` for overrides, `static` for auto-detected

</deferred>

---

*Phase: 10-integration-and-end-to-end-validation*
*Context gathered: 2026-03-18*
