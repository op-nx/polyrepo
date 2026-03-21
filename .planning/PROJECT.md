# nx-openpolyrepo

## What This Is

An open-source Nx plugin for synthetic monorepos. Merges project graphs from multiple repos into one unified Nx workspace with cross-repo dependency detection, so `nx graph`, `nx affected`, `nx run-many`, and all standard Nx CLI commands work seamlessly across repo boundaries. Ships with git clone/pull assembly, three-layer per-repo graph cache, namespaced project registration, cross-repo dependency auto-detection (package.json + tsconfig paths), override system with negation, daemon mode support, and multi-repo git DX (combined status, bulk sync with pre-caching).

## Core Value

`nx graph` displays projects from all synced repos with cross-repo dependency edges, and all relevant Nx CLI commands output projects from multiple repos -- making polyrepo feel like monorepo.

## Requirements

### Validated

- [x] Repo assembly via git clone/pull, configured in nx.json plugin options -- v1.0
- [x] Nx project graph plugin merges graphs from multiple Nx workspaces -- v1.0
- [x] Namespace/prefix external repo projects by repo name -- v1.0
- [x] Multi-repo git DX: combined git status across all repos -- v1.0
- [x] Multi-repo git DX: bulk sync with dry-run, per-repo warnings -- v1.0
- [x] Config validated at plugin load time with Zod schemas -- v1.0
- [x] Graph extraction cached (two-layer: memory + disk) -- v1.0
- [x] Maximum type safety: zero `as`/`any`, strict ESLint, Zod at boundaries, SIFERS -- v1.0
- [x] Container-based e2e via testcontainers -- v1.0
- [x] Pin repos to specific branch, tag, or commit SHA -- v1.0
- [x] Cross-repo dependency auto-detection from package.json (dependencies, devDependencies, peerDependencies) -- v1.1
- [x] Cross-repo dependency auto-detection from tsconfig path aliases -- v1.1
- [x] Explicit cross-repo dependency overrides with negation suppression -- v1.1
- [x] Load-time validation of override project references -- v1.1
- [x] Three-layer per-repo caching with selective invalidation and exponential backoff -- v1.1
- [x] Sync pre-caching eliminates cold-start extraction -- v1.1
- [x] Full daemon mode support (NX_DAEMON=true, false, unset) -- v1.1
- [x] targetDefaults isolation for proxy targets (dependsOn preservation) -- v1.1
- [x] Proxy executor env isolation (NX_DAEMON, NX_WORKSPACE_DATA_DIRECTORY, TEMP) -- v1.1

### Active

(None -- planning next milestone)

### Future

- [ ] Selective assembly via profiles/groups
- [ ] `init` generator for first-time setup
- [ ] `add-repo` generator for interactive repo addition
- [ ] Wildcard/glob patterns in dependency overrides
- [ ] Dependency edge type control (implicit/static/dynamic)

### Out of Scope

- Nx Cloud or Nx Enterprise integration -- this is explicitly a free/open-source alternative
- Task running reimplementation -- Nx handles task orchestration natively; plugin only merges graphs
- Non-Nx repo support -- requires fundamentally different project inference approach
- Cross-repo conformance rules -- enterprise-grade feature, defer to v2+
- Watch mode across repos -- high complexity, unclear value without cross-repo deps
- GUI/web dashboard -- CLI-first approach; `nx graph` provides visualization
- TypeScript import analysis across repos -- package.json + tsconfig paths sufficient for dependency contracts
- Lock file analysis -- lockfile formats vary; package name sufficient for graph edges
- Automatic version conflict detection -- belongs to conformance/consistency milestone (v2+)
- Runtime dependency inference -- too heuristic-heavy; manual overrides cover non-declarative relationships

## Context

Shipped v1.1 with 13,760 LOC TypeScript (plugin) + 623 LOC (e2e) across 13 phases in 12 days.
Tech stack: Nx 22.x, TypeScript, Vitest, Zod, testcontainers (Docker e2e), minimatch.
Plugin package: `@op-nx/polyrepo` at `packages/op-nx-polyrepo/`.
361 unit tests passing, 8 container-based e2e tests (cross-repo deps, daemon modes).

Known issues:
- DETECT-07 deferral: `nx affected` edge traversal works but `.repos/` gitignored blocks `calculateFileChanges()` — future `polyrepo-affected` executor needed
- Pop-over cmd windows on Windows: Nx `runCommandsImpl` spawns without `windowsHide`
- Scaling: ~4s for 150 projects from cached graph; may need optimization for 500+ project workspaces

## Constraints

- **Nx plugin architecture**: Must integrate as a standard Nx plugin registered in `nx.json`
- **Open source**: MIT or similar permissive license
- **Cross-platform**: Must work on Windows, macOS, and Linux
- **Self-hosted cache**: No dependency on Nx Cloud; works with any self-hosted remote cache
- **Nx version**: Built against Nx 22.x (currently 22.5.4)

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Git clone/pull for repo assembly | Cross-platform, portable, full control over branch/commit | [x] Good -- shipped v1.0 |
| Config in nx.json plugin options | Nx-native approach, repos configured where plugins are | [x] Good -- shipped v1.0 |
| Namespace external projects by repo name | Avoids collisions when repos have same project names | [x] Good -- shipped v1.0 |
| Shell out to `nx graph --print` for extraction | Each repo is a full Nx workspace with own plugins | [x] Good -- correct approach |
| Three-layer per-repo cache (memory + disk + extraction) | Avoids re-extraction; selective invalidation per repo | [x] Good -- v1.1 upgrade from monolithic |
| exec() not execFile() for child processes | .bin/* are .cmd shims on Windows | [x] Good -- cross-platform |
| Corepack detection via packageManager field | Supports pnpm/yarn managed by corepack | [x] Good -- tested with nrwl/nx |
| Zod schemas at all JSON.parse boundaries | Runtime validation with type inference | [x] Good -- 4+ boundaries covered |
| SIFERS test pattern (no beforeEach/afterEach) | Typed mocks, explicit setup, better isolation | [x] Good -- 361 tests pass |
| testcontainers for e2e | Isolated Docker env, prebaked fixtures, no host pollution | [x] Good -- 8 e2e tests |
| Sanitize stdout by slicing from first '{' | Handles unknown contamination sources in nx output | [x] Good -- robust |
| DependencyType.implicit for cross-repo edges | Static requires sourceFile in fileMap; .repos/ gitignored prevents this | [x] Good -- v1.1 |
| External packageName wins on lookup map collision | External cross-repo edges resolve to correct external project | [x] Good -- v1.1 |
| __host__ sentinel for host project repo alias | Uniform cross-repo guard logic | [x] Good -- v1.1 |
| Negation as post-filter (not inline skip) | Clean separation: auto-detect accumulates, then negation filters | [x] Good -- v1.1 |
| Per-repo hash: hashArray([reposConfigHash, alias, headSha, dirtyFiles]) | Lockfile hash unnecessary; repo state + config sufficient | [x] Good -- v1.1 |
| Backoff formula min(2000*2^(n-1), 30000)ms | Prevents extraction storms on persistent failures | [x] Good -- v1.1 |
| ensureTargetDefaultsShield auto-injected by createNodesV2 | Prevents host targetDefaults from leaking into proxy targets | [x] Good -- v1.1 |
| rewriteDependsOn preserves external dependsOn | Proxy targets maintain correct task ordering from external repo | [x] Good -- v1.1 |
| Proxy executor env isolation (TEMP, NX_DAEMON, NX_WORKSPACE_DATA_DIRECTORY) | Prevents SQLite WAL lock contention between host and child Nx | [x] Good -- v1.1 |

---
*Last updated: 2026-03-21 after v1.1 milestone*
