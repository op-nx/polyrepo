# nx-openpolyrepo

## What This Is

An open-source Nx plugin for synthetic monorepos. Merges project graphs from multiple repos into one unified Nx workspace, so `nx graph`, `nx affected`, `nx run-many`, and all standard Nx CLI commands work seamlessly across repo boundaries. Ships with git clone/pull assembly, two-layer graph cache, namespaced project registration, and multi-repo git DX (combined status, bulk sync). An open-source alternative to Nx Polygraph requiring no Nx Cloud or Nx Enterprise.

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

### Active

- [ ] Cross-repo dependency auto-detection from package.json
- [ ] Explicit cross-repo dependency overrides (manual wiring)
- [ ] Pin repos to specific branch, tag, or commit SHA
- [ ] Selective assembly via profiles/groups
- [ ] `init` generator for first-time setup
- [ ] `add-repo` generator for interactive repo addition

### Out of Scope

- Nx Cloud or Nx Enterprise integration -- this is explicitly a free/open-source alternative
- Task running reimplementation -- Nx handles task orchestration natively; plugin only merges graphs
- Non-Nx repo support -- requires fundamentally different project inference approach
- Cross-repo conformance rules -- enterprise-grade feature, defer to v2+
- Watch mode across repos -- high complexity, unclear value without cross-repo deps
- GUI/web dashboard -- CLI-first approach; `nx graph` provides visualization
- Mobile app -- web-first, CLI-first

## Context

Shipped v1.0 with 9,237 LOC TypeScript across 7 phases in 7 days.
Tech stack: Nx 22.x, TypeScript, Vitest, Zod, testcontainers (Docker e2e).
Plugin package: `@op-nx/polyrepo` at `packages/op-nx-polyrepo/`.
282 unit tests passing, container-based e2e in 23s warm.

Known issues:
- Cold start with daemon: first extraction after sync needs `NX_DAEMON=false`
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
| Two-layer cache (memory + disk) | Avoids re-extraction on every Nx command | [x] Good -- 4s for 150 projects |
| Strip dependsOn from proxy targets | Prevents cascading task graph across external projects | [x] Good -- avoids hasher issues |
| exec() not execFile() for child processes | .bin/* are .cmd shims on Windows | [x] Good -- cross-platform |
| Corepack detection via packageManager field | Supports pnpm/yarn managed by corepack | [x] Good -- tested with nrwl/nx |
| Zod schemas at all JSON.parse boundaries | Runtime validation with type inference | [x] Good -- 4 boundaries covered |
| SIFERS test pattern (no beforeEach/afterEach) | Typed mocks, explicit setup, better isolation | [x] Good -- 282 tests pass |
| testcontainers for e2e | Isolated Docker env, prebaked fixtures, no host pollution | [x] Good -- 23s warm |
| Sanitize stdout by slicing from first '{' | Handles unknown contamination sources in nx output | [x] Good -- robust |

---
*Last updated: 2026-03-16 after v1.0 milestone*
