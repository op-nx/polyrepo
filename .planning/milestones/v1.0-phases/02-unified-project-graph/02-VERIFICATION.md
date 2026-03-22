---
phase: 02-unified-project-graph
verified: 2026-03-12T08:20:00Z
status: passed
score: 10/10 must-haves verified
---

# Phase 2: Unified Project Graph Verification Report

**Phase Goal:** External repo projects appear in the unified Nx project graph with proper namespacing and fast cached extraction
**Verified:** 2026-03-12T08:20:00Z
**Status:** PASSED
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

All four success criteria from ROADMAP.md were verified against the actual codebase.

| #   | Truth                                                                                        | Status   | Evidence                                                                                                                                                                             |
| --- | -------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Running `nx graph` displays projects from all synced repos alongside host workspace projects | ? HUMAN  | Confirmed by user during Plan 03 Task 3 (Task 3 checkpoint: approved). 152 projects listed including all `nx/*` externals.                                                           |
| 2   | Running `nx show projects` lists external repo projects in its output                        | ? HUMAN  | Confirmed by user during Plan 03 Task 3. 152 projects including external namespaced entries.                                                                                         |
| 3   | External repo projects are prefixed with their repo name (e.g., `repo-b/my-lib`)             | VERIFIED | `transform.ts` line 66: `namespacedName = \`\${repoAlias}/\${originalName}\``. 29 tests covering namespacing in `transform.spec.ts`.                                                 |
| 4   | Graph data is extracted from cached JSON files, not recomputed on every Nx command           | VERIFIED | `cache.ts` implements two-layer cache (in-memory hash + disk JSON in `.repos/`). `populateGraphReport` returns early when `hash === currentHash`. 12 cache tests in `cache.spec.ts`. |

**Score:** 4/4 success criteria verified (2 automated, 2 human-confirmed during plan execution)

### Required Artifacts

All 10 plan-declared artifacts were verified to exist, be substantive, and be wired.

| Artifact                                                     | Status   | Evidence                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------ | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/op-nx-polyrepo/src/lib/graph/types.ts`             | VERIFIED | 49 lines. Exports `ExternalGraphJson`, `TransformedNode`, `PolyrepoGraphReport`, `ExternalProjectNode`, `ExternalDependency`, `ExternalProjectNodeData`. All interfaces match `nx graph --print` output structure.                                                                                                |
| `packages/op-nx-polyrepo/src/lib/git/normalize-url.ts`       | VERIFIED | 45 lines. Exports `normalizeGitUrl`. Handles SSH (`git@`), `ssh://`, `git://`, HTTPS protocols with hostname lowercasing and `.git` stripping. 9 tests passing.                                                                                                                                                   |
| `packages/op-nx-polyrepo/src/lib/git/detect.ts`              | VERIFIED | 213 lines. Exports `getHeadSha`, `getDirtyFiles` (added in Phase 2) alongside Phase 1 exports. Both call `execGitOutput` with correct git args.                                                                                                                                                                   |
| `packages/op-nx-polyrepo/src/lib/config/schema.ts`           | VERIFIED | 117 lines. Contains `.check()` for duplicate URL detection using `normalizeGitUrl`. Imports `normalizeGitUrl` from `../git/normalize-url`.                                                                                                                                                                        |
| `packages/op-nx-polyrepo/src/lib/executors/sync/executor.ts` | VERIFIED | Conditional dep install with lockfile hash comparison (Phase 3 enhanced). `pnpm-lock.yaml` / `yarn.lock` / default npm detection present.                                                                                                                                                                         |
| `packages/op-nx-polyrepo/src/lib/graph/extract.ts`           | VERIFIED | 76 lines. `extractGraphFromRepo` uses `exec()` (not `execFile` — Windows .cmd shim fix), 1GB LARGE_BUFFER, `NX_DAEMON=false`, `NX_VERBOSE_LOGGING=false`, `NX_PERF_LOGGING=false`, stdout JSON sanitization via `indexOf('{')`.                                                                                   |
| `packages/op-nx-polyrepo/src/lib/graph/cache.ts`             | VERIFIED | 172 lines. Exports `populateGraphReport` and `getCurrentGraphReport`. Module-level `graphReport`/`currentHash` variables. Two-layer cache: in-memory hash comparison + disk JSON at `.repos/.polyrepo-graph-cache.json`. Imports and calls `extractGraphFromRepo` and `transformGraphForRepo` in `Promise.all`.   |
| `packages/op-nx-polyrepo/src/lib/graph/transform.ts`         | VERIFIED | 116 lines. Exports `transformGraphForRepo`. Namespaces project names with `repoAlias/`, rewrites roots to `.repos/<alias>/<root>`, rewrites all targets to `@op-nx/polyrepo:run` executor with `inputs:[]` and `cache:false`, injects `polyrepo:external` and `polyrepo:<alias>` tags, prefixes dependency edges. |
| `packages/op-nx-polyrepo/src/lib/executors/run/executor.ts`  | VERIFIED | 50 lines. Imports and calls `runCommandsImpl` from `nx/src/executors/run-commands/run-commands.impl`. Constructs command with quoted nxBin path, sets `cwd` to `.repos/<repoAlias>`, passes `__unparsed__`.                                                                                                       |
| `packages/op-nx-polyrepo/src/lib/executors/run/schema.json`  | VERIFIED | Defines `repoAlias`, `originalProject`, `targetName` as required string properties.                                                                                                                                                                                                                               |
| `packages/op-nx-polyrepo/executors.json`                     | VERIFIED | Registers `run` executor at `./src/lib/executors/run/executor` with correct schema path.                                                                                                                                                                                                                          |
| `packages/op-nx-polyrepo/src/index.ts`                       | VERIFIED | 128 lines. Exports both `createNodesV2` and `createDependencies`. `createNodesV2` calls `populateGraphReport` and registers external projects keyed by `node.root`. `createDependencies` emits `DependencyType.implicit` edges guarded by `context.projects` existence check.                                     |

### Key Link Verification

| From                        | To                                                | Via                                                                                           | Status | Evidence                                                                                                            |
| --------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------- |
| `config/schema.ts`          | `git/normalize-url.ts`                            | `normalizeGitUrl` import for duplicate URL detection                                          | WIRED  | Line 3: `import { normalizeGitUrl }`. Line 62: called in `.check()`                                                 |
| `graph/cache.ts`            | `graph/extract.ts`                                | `populateGraphReport` calls `extractGraphFromRepo` per repo                                   | WIRED  | Line 6: import. Line 120: called in `Promise.all` map                                                               |
| `graph/cache.ts`            | `graph/transform.ts`                              | `populateGraphReport` calls `transformGraphForRepo` on raw JSON                               | WIRED  | Line 7: import. Line 121: called on extraction result                                                               |
| `graph/cache.ts`            | `git/detect.ts`                                   | outer cache gate uses `getHeadSha` and `getDirtyFiles`                                        | WIRED  | Line 4: import. Lines 57-58: called in `computeOuterHash`                                                           |
| `src/index.ts`              | `graph/cache.ts`                                  | `createNodesV2` calls `populateGraphReport`, `createDependencies` calls `populateGraphReport` | WIRED  | Line 11: import. Lines 34 and 104: called in both hooks                                                             |
| `executors/run/executor.ts` | `nx/src/executors/run-commands/run-commands.impl` | `runCommandsImpl` for transparent output streaming                                            | WIRED  | Line 2: import. Line 37: called with command + cwd                                                                  |
| `src/index.ts`              | `config/validate.ts`                              | `warnUnsyncedRepos` batched warning                                                           | WIRED  | Line 16: import. Line 25: called in `createNodesV2`                                                                 |
| `graph/extract.ts`          | child `nx graph --print` process                  | env option with `NX_VERBOSE_LOGGING: 'false'` (Plan 04 fix)                                   | WIRED  | Lines 33-34: `NX_VERBOSE_LOGGING: 'false'`, `NX_PERF_LOGGING: 'false'`. Line 49: `stdout.indexOf('{')` sanitization |

### Requirements Coverage

| Requirement | Source Plans        | Description                                                                 | Status    | Evidence                                                                                                                                                                                                                                                                                     |
| ----------- | ------------------- | --------------------------------------------------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GRPH-01     | 02-03, 02-04        | Projects from synced repos appear in `nx graph` visualization               | SATISFIED | `createNodesV2` registers external projects as Nx project entries via `populateGraphReport`. Human-confirmed: 152 projects in `nx graph` visualization during Plan 03 Task 3.                                                                                                                |
| GRPH-02     | 02-03, 02-04        | Projects from synced repos appear in `nx show projects` output              | SATISFIED | Same mechanism as GRPH-01 — `createNodesV2` makes projects visible to all Nx CLI commands. Human-confirmed: 152 projects in `nx show projects` output. Plan 04 stdout fix unblocked this.                                                                                                    |
| GRPH-03     | 02-01, 02-02, 02-03 | External repo projects namespaced with repo prefix                          | SATISFIED | `transform.ts` applies `repoAlias/` prefix to all project names (line 66), roots (line 67), and dependency edges (line 107-109). 29 transform tests cover all namespacing cases.                                                                                                             |
| GRPH-04     | 02-01, 02-02, 02-03 | Graph extraction uses cached JSON files, not recomputed on every Nx command | SATISFIED | Two-layer cache in `cache.ts`: (1) in-memory module-level variable checked first (lines 84-87), (2) disk cache at `.repos/.polyrepo-graph-cache.json` for cold start (lines 89-101). Cache survives `nx reset` because `.repos/` is not wiped. 12 cache tests confirm invalidation behavior. |

All 4 GRPH requirements are fully satisfied. No orphaned requirements found — all Phase 2 requirements (GRPH-01 through GRPH-04) were claimed by plans 02-01 through 02-04.

### Anti-Patterns Found

None detected. Scan of all phase 02 source files found:

- No TODO/FIXME/XXX/HACK/PLACEHOLDER comments in implementation files
- No stub return values (`return null`, `return {}`, `return []`)
- No console.log-only implementations
- All handlers and callbacks perform real work

### Human Verification Required

The following behaviors were verified by the user during Plan 03 Task 3 (human-verify checkpoint) and are documented as confirmed:

**1. nx graph visualization**

- Test: Run `npm exec nx graph` after syncing repos
- Expected: External projects appear in browser visualization with dependency edges
- Result: CONFIRMED — user approved Task 3 checkpoint

**2. nx show projects CLI output**

- Test: Run `npm exec nx show projects` after syncing repos
- Expected: External repo projects appear with `<alias>/<project-name>` format
- Result: CONFIRMED — 152 projects listed including all `nx/*` externals

**3. Proxy target execution**

- Test: Run `npm exec nx run nx/devkit:build`
- Expected: Command proxies to child repo and streams build output
- Result: CONFIRMED — `nx/devkit` built with 7 deps during Task 3 verification

## Summary

Phase 2 goal is fully achieved. All four plans delivered their artifacts:

- **Plan 02-01**: Foundational types (`graph/types.ts`), git utilities (`getHeadSha`, `getDirtyFiles`, `normalizeGitUrl`), duplicate URL detection in config schema, dep install in sync executor.
- **Plan 02-02**: Graph extraction pipeline (`extract.ts`, `cache.ts`, `transform.ts`) with two-layer cache, namespace prefixing, proxy target rewriting, and auto-tag injection.
- **Plan 02-03**: Run executor (`executors/run/executor.ts`), `createNodesV2` extension registering external projects, `createDependencies` emitting implicit dependency edges.
- **Plan 02-04** (gap closure): `NX_VERBOSE_LOGGING`/`NX_PERF_LOGGING` env suppression and stdout JSON sanitization in `extract.ts` to fix silent parse failure when running under verbose Nx daemon.

All 277 unit tests pass. Build succeeds. The ROADMAP.md progress counter (`3/4`) is cosmetically stale — Plan 04 was completed but the roadmap marker was not updated. This does not affect the codebase: the code is correct and complete.

---

_Verified: 2026-03-12T08:20:00Z_
_Verifier: Claude (gsd-verifier)_
