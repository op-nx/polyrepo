# Project Research Summary

**Project:** @op-nx/polyrepo — v1.2 Static Edges and Proxy Caching
**Domain:** Nx plugin hardening — static dependency edges, proxy target caching, temp directory rename
**Researched:** 2026-03-22
**Confidence:** HIGH

## Executive Summary

The v1.2 milestone is a focused hardening pass on three existing features of the `@op-nx/polyrepo` Nx plugin. None of these changes require new npm dependencies or breaking changes to the public API — all required functionality exists in the current stack (Nx 22.5.4, `@nx/devkit` 22.5.4, TypeScript, Node.js 24.x). The changes are surgical: approximately 30 lines of production code across 4 files, with most of the effort landing in updating test assertions.

The central finding from research is a critical Nx constraint that shapes the entire static edge feature: Nx validates that `sourceFile` on a `DependencyType.static` edge exists in its `fileMap`, which is built only from git-tracked files. Because `.repos/` is gitignored, files under synced repos are invisible to Nx's file walker. This forces a **split strategy** — host-to-external edges become `static` (the host `package.json` is in the `fileMap`), while external-sourced edges must remain `implicit`. This is not a compromise; it is the only valid approach given Nx's validation chain, verified directly against `project-graph-builder.js` in the installed Nx 22.5.4 source.

The proxy caching feature carries one significant known risk: an open Nx bug ([nrwl/nx#30170](https://github.com/nrwl/nx/issues/30170)) where the Nx daemon caches runtime input command results across invocations, meaning a `git rev-parse HEAD` input may not re-execute after `polyrepo-sync`. The recommended mitigation is to have the sync executor call `nx reset` post-sync and to document `NX_DAEMON=false` as a correctness workaround. The runtime command design must also use `git describe --always --dirty` instead of a compound `&&` command to avoid cross-platform line-ending hash divergence between Windows and Linux CI.

## Key Findings

### Recommended Stack

No stack changes for v1.2. All three features are implementable with the existing dependency set. `DependencyType.static` with `sourceFile`, runtime inputs (`{ runtime: "..." }`), and `cache: true` are all available in `@nx/devkit` 22.5.4. The `git -C <path>` pattern has worked cross-platform since Git 1.8.5 (2013).

**Core technologies (unchanged for v1.2):**
- `@nx/devkit` ^22.5.4: Plugin API — `DependencyType`, `RawProjectGraphDependency`, `TargetConfiguration` all export the required types; no version bump needed
- `nx` ^22.5.4: Plugin host — `validateStaticDependency` and `addDependency` validation chain verified directly in installed source
- TypeScript ~5.9.x: Language — no new type requirements
- Node.js 24.x: Runtime — `fs.mkdirSync`, `path.join` already in use throughout the plugin
- Git (any recent): Cross-platform dep state hashing — `git -C <path>` is the correct cross-platform approach; no Node.js git library needed

### Expected Features

The v1.2 scope is correctness and performance improvements, not new user-facing functionality.

**Must have (table stakes for v1.2):**
- Static dependency edges for host-sourced cross-repo deps — auto-detected edges that derive from `package.json` files should carry provenance; `implicit` loses the source file reference needed by `nx affected`
- Proxy target caching via runtime inputs — eliminating 2-5s child Nx bootstrap overhead per proxy target on warm runs is the highest impact change relative to implementation effort
- Rename `.tmp` to `tmp` in child repo temp directories — Nx's default `.gitignore` scaffold covers `tmp/` but not `.tmp/`; the rename removes a manual `.gitignore` configuration burden from every synced repo

**Should have (differentiators within v1.2):**
- Compound git state input capturing both committed and uncommitted changes — `git describe --always --dirty` catches sync changes (new HEAD) and local edits (dirty suffix) in a single cross-platform command, preventing stale cache hits for users editing files directly in `.repos/<alias>/`
- Granular `sourceFile` per detection source — pointing to the specific `package.json` enables Nx's incremental re-analysis to skip dependency recomputation for unchanged files

**Defer to future:**
- Per-target cache tuning — only warranted if users report cache hit rate issues with the compound input
- `outputs` declaration on proxy targets — requires non-trivial output path rewriting; child Nx manages its own build artifact cache independently
- Static edges for external-sourced dependencies — blocked by Nx `fileMap` constraint until Nx core supports gitignored path inclusion

### Architecture Approach

All three features modify existing components only — no new files are created. The existing code already has separate scanning paths for external-sourced (section 3a) and host-sourced (section 3b) dependency detection in `detect.ts`, so the edge type bifurcation aligns naturally with the current structure. The proxy caching change is isolated to a single function (`createProxyTarget` in `transform.ts`). The temp directory rename is a two-line string replacement in each of two files.

**Components modified:**
1. `lib/graph/detect.ts` — bifurcate `maybeEmitEdge` to emit `DependencyType.static` + `sourceFile` for host-sourced edges, keep `DependencyType.implicit` for external-sourced and override edges (~20 lines changed)
2. `lib/graph/transform.ts` — change `createProxyTarget` to set `cache: true` and `inputs: [{ runtime: "git -C .repos/<alias> describe --always --dirty" }]` (~5 lines changed)
3. `lib/graph/extract.ts` — replace `.tmp` with `tmp` (2 lines)
4. `lib/executors/run/executor.ts` — replace `.tmp` with `tmp` (2 lines)
5. Test files (`detect.spec.ts`, `transform.spec.ts`, `extract.spec.ts`, `executor.spec.ts`, `index.spec.ts`, `cross-repo-deps.spec.ts`) — update assertions; ~30 for edge types, ~5 for transform, path assertions for temp rename

### Critical Pitfalls

1. **Static edges throw on missing `sourceFile` for internal nodes** — `validateStaticDependency` in Nx 22.5.4 throws `"Source project file is required"` when `sourceFile` is absent and the source project exists in `context.projects`. This crashes ALL Nx commands, not just the graph. Prevention: every `static` edge must include `sourceFile`; external-sourced edges must remain `implicit`. Verify by calling `validateDependency` from `@nx/devkit` in unit tests on every emitted edge.

2. **Synthetic `sourceFile` pointing into `.repos/` crashes task hashing** — `validateCommonDependencyRules` validates that `sourceFile` exists in `projectFileMap` or `nonProjectFiles`. Files under `.repos/` are gitignored and absent from both. The crash happens during task hashing (not graph construction), making it harder to catch in unit tests alone. Prevention: only use `DependencyType.static` for edges where the source is a host project with a git-tracked `package.json`; validate with both `nx graph` and `nx affected` during testing.

3. **Nx daemon caches runtime input results — input may not re-execute after sync** — open bug [nrwl/nx#30170](https://github.com/nrwl/nx/issues/30170), confirmed in Nx 20.0.3+ through December 2025. The daemon does not re-execute runtime commands on subsequent invocations within the same daemon session. Prevention: have `polyrepo-sync` executor call `nx reset` post-sync to restart the daemon; document `NX_DAEMON=false` as a correctness workaround.

4. **Compound `&&` runtime command produces platform-dependent line endings** — `git diff HEAD` output uses `\r\n` on Windows, `\n` on Linux, producing different hashes for the same repo state and breaking remote cache sharing. Prevention: use `git -C .repos/<alias> describe --always --dirty` — a single cross-platform command producing a short, consistent output line that changes on both new commits and dirty working tree state.

5. **Failed runtime command produces constant hash — permanent cache hit** — if the runtime command fails (repo not synced, git not found), stdout is empty or deterministic error text, producing a constant hash that causes the proxy target to permanently cache as "success". Prevention: add a shell fallback producing a unique-per-invocation value on failure, or conditionally set `cache: false` for unsynced repos by checking `.repos/<alias>/.git` existence in `createNodesV2`.

## Implications for Roadmap

All three features are independent — no code-level dependency between them. The suggested ordering is risk-based, not dependency-based. They can be built in any order or in parallel across branches.

### Phase 1: Temp Directory Rename

**Rationale:** Smallest change, negligible risk, sets a consistent naming convention before the other phases touch the same source files. `mkdirSync({ recursive: true })` ensures the directory is created fresh on each invocation — no migration of existing directories is required. Old `.tmp` directories in already-synced repos become orphaned but are harmless since `.repos/` is gitignored.
**Delivers:** Zero-configuration `.gitignore` coverage for the plugin's temp directories in every synced repo that uses the standard Nx workspace scaffold
**Addresses:** Temp directory convention feature (table stakes for v1.2)
**Avoids:** No significant pitfalls; verify that `create-nx-workspace` scaffold includes `tmp` in `.gitignore` before merging
**Effort:** ~30 minutes (4 line changes across 2 files + path assertion updates in tests)

### Phase 2: Proxy Target Caching

**Rationale:** Highest user impact relative to implementation effort — eliminates 2-5s child Nx bootstrap overhead per proxy target on warm runs. Isolated to a single function in `transform.ts` with no downstream test coupling, making it the safest behavioral change to ship next. Must be validated with the Nx daemon both on and off before proceeding to static edges.
**Delivers:** Host-level cache hits for proxy targets when the child repo's git state is unchanged; removes compounding bootstrap overhead for dependency chains involving multiple proxy targets
**Uses:** Nx runtime inputs API (`{ runtime: "..." }`), `cache: true` on `TargetConfiguration`
**Implements:** `createProxyTarget` in `lib/graph/transform.ts` — 3-5 line production change plus test assertion updates
**Avoids:** Use `git describe --always --dirty` (not compound `&&` command) to prevent cross-platform hash divergence (Pitfall 4); implement a failure fallback to prevent permanent cache hits on unsynced repos (Pitfall 5); document `nx reset` post-sync to work around the Nx daemon caching bug (Pitfall 3)
**Effort:** 1-2 hours including cross-platform validation on Windows and Linux CI

### Phase 3: Static Dependency Edges

**Rationale:** Largest test surface (~30+ assertion updates across unit, integration, and e2e tests), requires the most careful validation (both `nx graph` and `nx affected`/`nx build` must be exercised — the two crash modes are triggered by different code paths). Benefits from phases 1 and 2 being committed and stable before touching `detect.ts`.
**Delivers:** Provenance on host-to-external dependency edges; `nx affected` can now trace which specific `package.json` change triggered which cross-repo dependency recomputation
**Implements:** Bifurcated `maybeEmitEdge` in `lib/graph/detect.ts`; host-sourced edges become `static` with `sourceFile` pointing to the host `package.json`, external-sourced and override edges remain `implicit`
**Avoids:** Do NOT emit `static` edges for external-sourced deps — `.repos/` paths fail `validateCommonDependencyRules` during task hashing (Pitfall 2); call `validateDependency` from `@nx/devkit` in unit tests to catch fileMap violations before they reach the native hasher (Pitfall 1); validate with `nx affected` in addition to `nx graph`, since the graph construction and task hashing crashes have different trigger conditions (Pitfalls 1 and 2)
**Effort:** 2-3 hours including test updates and e2e validation

### Phase Ordering Rationale

- Phase 1 first because it is trivially safe, removes a naming inconsistency, and avoids the situation where phases 2-3 introduce test churn alongside renaming noise in the same commits
- Phase 2 before phase 3 because proxy caching is isolated to a single function with no downstream test coupling, while static edges have the widest blast radius across the test suite
- Phase 3 last because it has the most complex validation requirements (two distinct crash modes in different subsystems) and the most test assertions to update; a stable Phase 2 baseline makes regression isolation straightforward

### Research Flags

Phases requiring careful cross-environment validation during implementation:
- **Phase 2 (Proxy Caching):** The Nx daemon runtime input caching bug ([nrwl/nx#30170](https://github.com/nrwl/nx/issues/30170)) is an active open issue. Must validate with `NX_DAEMON=false` first, then `NX_DAEMON=true`, to distinguish expected behavior from daemon cache staleness. Runtime command cross-platform behavior must also be verified in CI (Linux) given the Windows-first development environment.
- **Phase 3 (Static Edges):** Two distinct crash modes with different trigger conditions (graph construction vs. task hashing). Unit tests catching Pitfall 1 will not catch Pitfall 2. Integration or e2e testing with `nx affected` is required — cannot rely on unit test coverage alone.

Phases with standard, well-understood patterns (skip deeper research):
- **Phase 1 (Temp Rename):** Two-line string replacement per file, no API interaction, no behavioral change. Standard practice with negligible risk.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All APIs verified against installed Nx 22.5.4 source in `node_modules`. `DependencyType`, `StaticDependency`, runtime input shapes all confirmed. Runtime verification: `DependencyType` enum values confirmed via `node -e`. |
| Features | HIGH | Feature boundaries are precise. The fileMap constraint is a hard Nx implementation fact verified line-by-line in the installed source — it is not an interpretation or inference. The split strategy is the only valid approach. |
| Architecture | HIGH | All changes are modifications to existing components following established patterns. No new abstractions required. Implementation pattern for static edges confirmed against Nx's own `explicit-package-json-dependencies.js` as a reference implementation. |
| Pitfalls | HIGH | Critical pitfalls verified against Nx 22.5.4 source code (validation chain confirmed at specific line numbers). Daemon caching bug confirmed from open GitHub issue active through December 2025. Cross-platform behavior inferred from Nx docs, Git for Windows documentation, and the existing `git -C` usage pattern in the codebase. |

**Overall confidence:** HIGH

### Gaps to Address

- **Daemon runtime input caching mitigation requires sync executor change:** The recommended mitigation (`nx reset` post-sync) needs implementation in the sync executor, not just in the proxy target. This is a new behavior for the sync executor that was not part of the original feature scope. Validate that calling `nx reset` from within an executor is safe and does not cause re-entrance or daemon restart issues.

- **`git describe --always --dirty` on shallow clones:** CI environments commonly use `git clone --depth=1`. `git describe` on a shallow clone with no tags may produce unexpected or verbose output rather than the expected short tag-relative form. Verify behavior on a shallow clone and determine whether a fallback to `git rev-parse HEAD` is needed for CI contexts.

- **Untracked files in `.repos/<alias>/`:** Neither `git describe --dirty` nor `git diff HEAD` captures untracked (never-`git add`ed) files. Users adding new source files without staging them would see stale cache hits. This is documented as an acceptable limitation for v1.2 — caching is keyed to committed and staged changes only. Should be noted in documentation.

## Sources

### Primary (HIGH confidence)
- `node_modules/nx/src/project-graph/project-graph-builder.js` — `validateStaticDependency`, `validateCommonDependencyRules`, `getFileData`, `getNonProjectFileData` implementations verified at lines 304-379 in Nx 22.5.4
- `node_modules/nx/src/project-graph/build-project-graph.js` — `builder.addDependency(dep.source, dep.target, dep.type, sourceFile)` call confirmed at line 225
- `node_modules/nx/src/project-graph/file-map-utils.js` — `createFileMap` uses `getAllFileDataInContext` which respects `.gitignore` (lines 21-39)
- `node_modules/nx/src/config/project-graph.d.ts` — `FileMap`, `FileData`, `DependencyType` type definitions
- `node_modules/nx/src/project-graph/project-graph-builder.d.ts` — `StaticDependency`, `ImplicitDependency` type definitions with JSDoc constraints
- `node_modules/nx/src/plugins/js/project-graph/build-dependencies/explicit-package-json-dependencies.js` — Nx's own static edge pattern using `sourceFile: packageJsonPath` as the reference implementation
- `node_modules/nx/src/config/workspace-json-project-json.d.ts` — `InputDefinition` type includes `{ runtime: string }` shape
- `packages/op-nx-polyrepo/src/lib/graph/detect.ts` — current edge emission using `DependencyType.implicit` with explicit comment about `.repos/` fileMap exclusion
- `packages/op-nx-polyrepo/src/lib/graph/transform.ts` — `createProxyTarget` sets `cache: false, inputs: []`
- `packages/op-nx-polyrepo/src/lib/executors/run/executor.ts` — proxy executor uses `.tmp` for temp isolation; env does NOT spread `process.env`
- `packages/op-nx-polyrepo/src/lib/graph/extract.ts` — graph extraction uses `.tmp` for temp isolation; env DOES spread `process.env`
- `packages/op-nx-polyrepo/src/index.ts` — `externalNamedInputs` override prevents file-based pattern expansion but NOT `sourceFile` resolution in dependency edges
- [Nx Inputs Reference](https://nx.dev/docs/reference/inputs) — runtime input format, hash computation semantics
- [Configure Inputs for Task Caching](https://nx.dev/docs/guides/tasks--caching/configure-inputs) — runtime input documentation, cross-platform guidance
- [Nx Extending the Project Graph](https://nx.dev/docs/extending-nx/project-graph-plugins) — `createDependencies` plugin API

### Secondary (MEDIUM confidence)
- [nrwl/nx#30170](https://github.com/nrwl/nx/issues/30170) — "Runtime cache input simply does not work" (OPEN, Nx 20.0.3+, last confirmed December 2025)
- [nrwl/nx#20949](https://github.com/nrwl/nx/issues/20949) — confirms `NX_PROJECT_ROOT` not available in runtime inputs; commands execute from workspace root
- [nrwl/nx#6821](https://github.com/nrwl/nx/issues/6821) — confirms `.nxignore` cannot override `.gitignore` for file inclusion
- [Nx StaticDependency docs](https://nx.dev/docs/reference/devkit/StaticDependency) — `sourceFile` requirement documentation
- [Nx .nxignore Reference](https://nx.dev/docs/reference/nxignore) — `.nxignore` syntax and scope

### Tertiary (LOW confidence)
- Nx failure behavior for failed runtime input commands — undocumented; assumed to produce constant hash based on Rust hasher implementation patterns; needs empirical validation during Phase 2
- `git describe --always --dirty` output format on shallow clones — not explicitly tested; the `--always` flag should ensure output even without tags, but the tag-relative portion may be absent or inconsistent

---
*Research completed: 2026-03-22*
*Ready for roadmap: yes*
