# Codebase Structure

**Analysis Date:** 2026-03-22

## Directory Layout

```
polyrepo/                                  # Nx workspace root (npm workspaces)
├── packages/
│   ├── op-nx-polyrepo/                    # Plugin package (@op-nx/polyrepo)
│   │   ├── src/
│   │   │   ├── index.ts                   # Nx plugin entry (createNodesV2, createDependencies)
│   │   │   ├── index.spec.ts              # Plugin entry tests
│   │   │   └── lib/
│   │   │       ├── config/                # Plugin config schema + validation
│   │   │       ├── executors/
│   │   │       │   ├── run/               # Proxy executor (delegates to child repo)
│   │   │       │   ├── status/            # Status display executor
│   │   │       │   └── sync/              # Clone/pull executor
│   │   │       ├── format/                # CLI output formatting
│   │   │       ├── git/                   # Git commands + detection
│   │   │       ├── graph/                 # Graph extraction, transform, cache, detect
│   │   │       └── testing/               # Shared test utilities (SIFERS)
│   │   ├── executors.json                 # Nx executor manifest
│   │   ├── package.json                   # Package manifest + nx targets
│   │   ├── tsconfig.json                  # TypeScript root config
│   │   ├── tsconfig.lib.json              # Build config
│   │   ├── tsconfig.spec.json             # Test config
│   │   └── vitest.config.mts              # Vitest config
│   └── op-nx-polyrepo-e2e/               # E2E test package
│       ├── src/
│       │   ├── cross-repo-deps.spec.ts    # Cross-repo dependency detection tests
│       │   ├── installed.spec.ts          # Install/sync tests
│       │   ├── polyrepo-status.spec.ts    # Status executor tests
│       │   └── setup/
│       │       ├── container.ts           # testcontainers helpers
│       │       ├── global-setup.ts        # Docker image build + Verdaccio lifecycle
│       │       └── provided-context.ts    # Vitest provide/inject typed context
│       └── docker/
│           ├── Dockerfile                 # Multi-stage: workspace + snapshot images
│           └── verdaccio.yaml             # Local registry config for e2e
├── .planning/                             # GSD planning artifacts
│   ├── codebase/                          # Codebase analysis documents (this directory)
│   ├── milestones/                        # Milestone phase plans
│   ├── todos/                             # Pending/done/resolved todos
│   └── research/                          # Research notes
├── .repos/                                # Synced external repos (gitignored)
│   └── <alias>/                           # One directory per configured repo
├── .polyrepo-ws-data/                     # Plugin workspace data (gitignored)
├── .verdaccio/                            # Verdaccio local registry config
├── .vscode/                               # Editor settings
├── .claude/                               # Claude Code commands + skills
├── nx.json                                # Nx config + plugin registration
├── package.json                           # Root workspace manifest (@op-nx/source)
├── tsconfig.base.json                     # Shared TypeScript base config
└── eslint.config.mjs                      # ESLint flat config (workspace-wide)
```

## Directory Purposes

**`packages/op-nx-polyrepo/src/lib/config/`:**

- Purpose: Plugin configuration schema, validation, and resolution
- Contains: `schema.ts` (Zod schemas, type exports, `normalizeRepos`), `validate.ts` (runtime validation + warnings), `resolve.ts` (reads nx.json directly for executor use)
- Key files: `packages/op-nx-polyrepo/src/lib/config/schema.ts`, `packages/op-nx-polyrepo/src/lib/config/validate.ts`, `packages/op-nx-polyrepo/src/lib/config/resolve.ts`

**`packages/op-nx-polyrepo/src/lib/graph/`:**

- Purpose: All external project graph logic — extraction from child repos, transformation into host namespace, caching, and cross-repo dependency detection
- Contains: `extract.ts`, `transform.ts`, `cache.ts`, `detect.ts`, `types.ts`
- Key files: `packages/op-nx-polyrepo/src/lib/graph/cache.ts` (most complex), `packages/op-nx-polyrepo/src/lib/graph/detect.ts` (cross-repo edges)

**`packages/op-nx-polyrepo/src/lib/executors/`:**

- Purpose: Three Nx executor implementations
- Contains: `run/executor.ts` + `run/schema.json`, `sync/executor.ts` + `sync/schema.json`, `status/executor.ts` + `status/schema.json`
- Key files: `packages/op-nx-polyrepo/src/lib/executors/sync/executor.ts` (most complex — git, install, pre-cache)

**`packages/op-nx-polyrepo/src/lib/git/`:**

- Purpose: Git subprocess wrappers and state detection
- Contains: `commands.ts` (all mutating git ops), `detect.ts` (read-only git queries), `normalize-url.ts`, `patterns.ts`

**`packages/op-nx-polyrepo/src/lib/format/`:**

- Purpose: CLI output formatting
- Contains: `table.ts` (`formatAlignedTable`)

**`packages/op-nx-polyrepo/src/lib/testing/`:**

- Purpose: Shared test-only utilities (SIFERS pattern)
- Contains: `mock-child-process.ts` (typed ChildProcess mock factory), `asserts.ts` (`assertDefined<T>`)

**`packages/op-nx-polyrepo-e2e/src/setup/`:**

- Purpose: E2E test lifecycle management — Docker image builds and container orchestration
- Contains: `global-setup.ts` (builds workspace + snapshot images, runs Verdaccio, publishes plugin), `container.ts` (start container, run nx graph, write nx.json helpers), `provided-context.ts` (typed Vitest provide/inject)

**`.repos/`:**

- Purpose: Runtime storage for cloned external repos
- Generated: Yes (by sync executor)
- Committed: No (gitignored)

**`.planning/codebase/`:**

- Purpose: GSD codebase analysis documents consumed by plan-phase and execute-phase
- Generated: Yes (by `/gsd:map-codebase`)
- Committed: Yes

## Key File Locations

**Entry Points:**

- `packages/op-nx-polyrepo/src/index.ts`: Nx plugin hooks (`createNodesV2`, `createDependencies`)
- `packages/op-nx-polyrepo/executors.json`: Executor manifest (maps executor names to implementations)

**Configuration:**

- `nx.json`: Nx config including `@op-nx/polyrepo` plugin registration with `repos` options
- `packages/op-nx-polyrepo/src/lib/config/schema.ts`: `PolyrepoConfig` Zod schema and `normalizeRepos`
- `packages/op-nx-polyrepo/package.json`: Package metadata, `nx.targets.build`, executor/type entry points

**Core Logic:**

- `packages/op-nx-polyrepo/src/lib/graph/cache.ts`: Three-layer cache + `populateGraphReport` (orchestrates extraction pipeline)
- `packages/op-nx-polyrepo/src/lib/graph/transform.ts`: `transformGraphForRepo` (namespace, proxy targets, tags)
- `packages/op-nx-polyrepo/src/lib/graph/extract.ts`: `extractGraphFromRepo` (child repo graph extraction)
- `packages/op-nx-polyrepo/src/lib/graph/detect.ts`: `detectCrossRepoDependencies`
- `packages/op-nx-polyrepo/src/lib/executors/sync/executor.ts`: `syncExecutor` (clone, pull, install, pre-cache)

**Testing:**

- `packages/op-nx-polyrepo/src/lib/testing/mock-child-process.ts`: `createMockChildProcess` factory
- `packages/op-nx-polyrepo/src/lib/testing/asserts.ts`: `assertDefined<T>`
- `packages/op-nx-polyrepo-e2e/src/setup/global-setup.ts`: Vitest globalSetup for e2e container lifecycle
- `packages/op-nx-polyrepo-e2e/docker/Dockerfile`: Multi-stage Docker image for e2e tests

**Runtime Cache Files (generated, not committed):**

- `.repos/<alias>/.polyrepo-graph-cache.json`: Per-repo disk cache (written by `writePerRepoCache`)
- `.repos/.<alias>.lock-hash`: Lockfile hash sentinel (written by sync executor to skip unnecessary installs)
- `.repos/<alias>/.nx-graph-output.json`: Optional pre-computed graph fast path (placed by Docker image build)

## Naming Conventions

**Files:**

- Module files: `camelCase.ts` (e.g., `normalize-url.ts` uses kebab, `mockChildProcess` uses camel — kebab preferred for multi-word)
- Test files: co-located `<name>.spec.ts` next to implementation
- Executor schema: `schema.json` (always lowercase)
- Config files: `tsconfig.lib.json`, `vitest.config.mts`, `eslint.config.mjs`

**Directories:**

- Feature modules: kebab-case (`op-nx-polyrepo`, `mock-child-process`)
- Executor directories: kebab-case target name (`run`, `sync`, `status`)

**TypeScript:**

- Interfaces and types: PascalCase (`PolyrepoConfig`, `TransformedNode`, `NormalizedRepoEntry`)
- Functions: camelCase (`extractGraphFromRepo`, `transformGraphForRepo`, `populateGraphReport`)
- Constants: SCREAMING_SNAKE_CASE for module-level constants (`PROXY_EXECUTOR`, `CACHE_FILENAME`, `LARGE_BUFFER`)
- Exported Zod schemas: camelCase with `Schema` suffix (`polyrepoConfigSchema`, `externalGraphJsonSchema`)

## Where to Add New Code

**New executor:**

- Create directory: `packages/op-nx-polyrepo/src/lib/executors/<name>/`
- Implementation: `packages/op-nx-polyrepo/src/lib/executors/<name>/executor.ts`
- Schema: `packages/op-nx-polyrepo/src/lib/executors/<name>/schema.json`
- Register: add entry to `packages/op-nx-polyrepo/executors.json`
- Tests: `packages/op-nx-polyrepo/src/lib/executors/<name>/executor.spec.ts`

**New git operation:**

- Mutating ops: `packages/op-nx-polyrepo/src/lib/git/commands.ts`
- Read-only queries: `packages/op-nx-polyrepo/src/lib/git/detect.ts`

**New graph processing step:**

- Extraction changes: `packages/op-nx-polyrepo/src/lib/graph/extract.ts`
- Transformation changes: `packages/op-nx-polyrepo/src/lib/graph/transform.ts`
- Cache invalidation changes: `packages/op-nx-polyrepo/src/lib/graph/cache.ts`
- New detection algorithm: `packages/op-nx-polyrepo/src/lib/graph/detect.ts`

**New config option:**

- Add to Zod schema: `packages/op-nx-polyrepo/src/lib/config/schema.ts`
- Update `PolyrepoConfig` type (auto-inferred from Zod)
- Handle in plugin entry: `packages/op-nx-polyrepo/src/index.ts`

**New shared test utility (SIFERS):**

- Add to: `packages/op-nx-polyrepo/src/lib/testing/`
- Keep test-only (do not import from production code)

**New CLI output format:**

- Add to: `packages/op-nx-polyrepo/src/lib/format/`

## Special Directories

**`.repos/`:**

- Purpose: Runtime clones of external repos managed by `syncExecutor`
- Generated: Yes
- Committed: No — must be in `.gitignore` AND `eslint.config.mjs` ignores

**`dist/`:**

- Purpose: Build output from `@nx/js:tsc` executor
- Generated: Yes (`dist/packages/op-nx-polyrepo/`)
- Committed: No

**`packages/op-nx-polyrepo/out-tsc/`:**

- Purpose: Vitest TypeScript compilation output (type declaration maps for test runs)
- Generated: Yes
- Committed: No

**`.nx/`:**

- Purpose: Nx daemon, workspace data, task cache
- Generated: Yes
- Committed: No

**`.planning/`:**

- Purpose: GSD workflow planning artifacts (phases, milestones, todos, research, codebase docs)
- Generated: Partially (by GSD commands)
- Committed: Yes

---

_Structure analysis: 2026-03-22_
