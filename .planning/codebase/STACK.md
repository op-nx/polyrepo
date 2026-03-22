# Technology Stack

**Analysis Date:** 2026-03-22

## Languages

**Primary:**

- TypeScript 5.9.x - All source code in `packages/op-nx-polyrepo/src/` and `packages/op-nx-polyrepo-e2e/src/`

**Secondary:**

- JavaScript (ESM) - Config files: `eslint.config.mjs`, `vitest.workspace.ts`
- Shell - `scripts/rebase-format.sh`
- Dockerfile - `packages/op-nx-polyrepo-e2e/docker/Dockerfile`
- YAML - Verdaccio configs at `.verdaccio/config.yml` and `packages/op-nx-polyrepo-e2e/docker/verdaccio.yaml`

## Runtime

**Environment:**

- Node.js 22 (pinned in e2e Docker image: `node:22-slim` in `packages/op-nx-polyrepo-e2e/docker/Dockerfile`)
- No `.nvmrc` or `.node-version` file; version implied by Docker base image

**Package Manager:**

- npm (workspace root uses npm workspaces)
- Lockfile: `package-lock.json` (lockfileVersion 3) — present and committed
- External repos may use pnpm, yarn, or npm; sync executor detects and invokes the correct one including corepack-managed variants

## Frameworks

**Core:**

- Nx 22.5.x - Monorepo toolchain and task orchestration. Plugin `@op-nx/polyrepo` is registered as an Nx plugin in `nx.json`

**Testing:**

- Vitest 4.x — unit test runner for `packages/op-nx-polyrepo/` with config at `packages/op-nx-polyrepo/vitest.config.mts`
- Vitest 4.x — e2e test runner for `packages/op-nx-polyrepo-e2e/` with config at `packages/op-nx-polyrepo-e2e/vitest.config.mts`
- Coverage: `@vitest/coverage-v8` (v8 provider)

**Build:**

- `@nx/js:tsc` executor — compiles the plugin package via TypeScript compiler; configured in `packages/op-nx-polyrepo/package.json` (`nx.targets.build`)
- esbuild 0.25.x — available as `@nx/esbuild` plugin devDependency, not currently the active build executor for the plugin
- SWC (`@swc/core`, `@swc-node/register`) — available for transpilation

**Linting/Formatting:**

- ESLint 9.x (flat config) — configured at `eslint.config.mjs`
- typescript-eslint 8.x — strict + stylistic type-checked rulesets
- Prettier 3.6.x — code formatting
- `@vitest/eslint-plugin` — Vitest-specific lint rules
- `@eslint-community/eslint-plugin-eslint-comments` — eslint-disable comment hygiene

## Key Dependencies

**Critical:**

- `@nx/devkit` >=20.0.0 — peer dependency of the plugin; provides `CreateNodesV2`, `CreateDependencies`, `logger`, `hashArray`, `hashObject`, `readJsonFile`, `writeJsonFile` APIs used throughout `packages/op-nx-polyrepo/src/`
- `zod` ^4.0.0 (plugin runtime peer) / ^4.3.6 (workspace) — schema validation for plugin config (`packages/op-nx-polyrepo/src/lib/config/schema.ts`) and graph JSON parsing (`packages/op-nx-polyrepo/src/lib/graph/types.ts`)
- `minimatch` ^10.0.0 — plugin runtime dependency; used for glob matching in cross-repo dependency detection
- `tslib` ^2.3.0 — TypeScript runtime helpers

**Infrastructure:**

- `testcontainers` ^11.12.0 — orchestrates Docker containers in e2e tests; used in `packages/op-nx-polyrepo-e2e/src/setup/global-setup.ts`
- `verdaccio` ^6.0.5 — local npm registry for e2e plugin publishing; runs as a Docker container (`hertzg/verdaccio` image) during e2e setup
- `create-nx-workspace` ^22.5.4 — used in e2e Dockerfile to scaffold a fresh Nx workspace inside the container

**Internal:**

- `nx/src/devkit-internals` (`hashObject`) — internal Nx API used in `packages/op-nx-polyrepo/src/index.ts` and `packages/op-nx-polyrepo/src/lib/executors/sync/executor.ts`; fragile across Nx major versions
- `nx/src/executors/run-commands/run-commands.impl` — internal Nx API used in the run proxy executor (`packages/op-nx-polyrepo/src/lib/executors/run/executor.ts`); fragile across Nx major versions

## Configuration

**Environment:**

- No `.env` files present
- Runtime behavior controlled by Nx env vars: `NX_DAEMON`, `NX_NO_CLOUD`, `NX_VERBOSE_LOGGING`, `NX_PERF_LOGGING`, `NX_PLUGIN_NO_TIMEOUTS`
- e2e tests set env vars `npm_config_registry`, `npm_config_userconfig` temporarily during plugin publish phase

**Build:**

- `tsconfig.base.json` — workspace-wide compiler options (strict, ES2022, nodenext modules, `noUncheckedIndexedAccess`, `noPropertyAccessFromIndexSignature`)
- `packages/op-nx-polyrepo/tsconfig.lib.json` — plugin library build config
- `packages/op-nx-polyrepo/tsconfig.spec.json` — plugin unit test config
- `packages/op-nx-polyrepo-e2e/tsconfig.spec.json` — e2e test config
- `nx.json` — Nx plugins, target defaults, release config
- `.verdaccio/config.yml` — local registry for `nx local-registry` target (port 4873)

**TypeScript Module Resolution:**

- `"module": "nodenext"` and `"moduleResolution": "nodenext"` — ESM-first
- Custom condition `"@op-nx/source"` in `tsconfig.base.json` allows in-source TypeScript imports to resolve before the compiled `.js` output during development

## Platform Requirements

**Development:**

- Windows 11 (arm64 / x86_64) or Linux/macOS
- Docker Desktop required for e2e tests (testcontainers + Verdaccio container)
- Git must be installed and on PATH (plugin shells out to `git` via `execFile`)
- Node.js 22 recommended (matches Docker base image)
- npm workspace support

**Production:**

- Published to npm as `@op-nx/polyrepo`
- Consumed as an Nx plugin installed in any Nx workspace (Node.js >=20 required per `@nx/devkit` peer dep)
- Output: `dist/packages/op-nx-polyrepo/` (built by `@nx/js:tsc`)

---

_Stack analysis: 2026-03-22_
