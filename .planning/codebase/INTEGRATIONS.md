# External Integrations

**Analysis Date:** 2026-03-22

## APIs & External Services

**Git Hosting:**

- GitHub (and any valid git remote) — the plugin clones and syncs external repositories
  - SDK/Client: Node.js built-in `child_process.execFile('git', ...)` — no HTTP SDK; all git operations go through the `git` CLI binary
  - Auth: ambient git credential helpers (SSH keys, HTTPS credential store) on the host machine; no env var injection by the plugin
  - Implementation: `packages/op-nx-polyrepo/src/lib/git/commands.ts`

**Nx Graph API:**

- Child Nx workspace CLI — `nx graph --print` spawned as a subprocess in each synced repo
  - Client: `child_process.exec(nxBin + " graph --print", ...)` — see `packages/op-nx-polyrepo/src/lib/graph/extract.ts`
  - Auth: None (local process)
  - Note: `NX_NO_CLOUD=true` and `NX_DAEMON=false` are injected into the subprocess environment to prevent cloud telemetry and daemon startup

**npm Registry (e2e only):**

- Verdaccio local registry — used during e2e test setup to publish the plugin tarball
  - Client: npm CLI + `nx/release` programmatic API (`releaseVersion`, `releasePublish`)
  - Auth: hardcoded e2e token `secretVerdaccioToken` written to a temporary `.npmrc.e2e` file
  - Implementation: `packages/op-nx-polyrepo-e2e/src/setup/global-setup.ts`
  - Registry URL: `http://localhost:4873` (host) / `http://host.docker.internal:4873` (container)

## Data Storage

**Databases:**

- None

**File Storage:**

- Local filesystem only
  - Synced repos stored in `.repos/<alias>/` relative to workspace root
  - Per-repo graph cache at `.repos/<alias>/.polyrepo-graph-cache.json`
  - Per-repo lockfile hash at `.repos/.<alias>.lock-hash`
  - Pre-computed graph JSON at `.repos/<alias>/.nx-graph-output.json` (populated by e2e Dockerfile; read as fast path by `packages/op-nx-polyrepo/src/lib/graph/extract.ts`)
  - Old monolithic cache (migration artifact) at `.repos/.polyrepo-graph-cache.json` — cleaned up on first run

**Caching:**

- Two-layer in-process + disk cache; no external cache service
  - Layer 0: Module-level in-memory `Map` in `packages/op-nx-polyrepo/src/lib/graph/cache.ts` (persists for lifetime of Nx daemon worker process)
  - Layer 1: Per-repo JSON files at `.repos/<alias>/.polyrepo-graph-cache.json`
  - Cache key: `hashArray([reposConfigHash, alias, headSha, dirtyFiles])` — see `computeRepoHash` in `packages/op-nx-polyrepo/src/lib/graph/cache.ts`

## Authentication & Identity

**Auth Provider:**

- None — no user authentication system
- Git credentials: delegated entirely to the host OS git credential store / SSH agent; the plugin passes no credentials
- Nx Cloud: explicitly disabled in subprocess invocations via `NX_NO_CLOUD=true`

## Monitoring & Observability

**Error Tracking:**

- None — no external error tracking service

**Logs:**

- `logger` from `@nx/devkit` — all user-facing messages use `logger.info`, `logger.warn`, `logger.error`
- No structured logging or log shipping

## CI/CD & Deployment

**Hosting:**

- npm registry — published as `@op-nx/polyrepo` via `nx-release-publish` executor (`@nx/js:release-publish`)
- Output directory: `dist/packages/op-nx-polyrepo/`
- Release config in `packages/op-nx-polyrepo/package.json` (`nx.release`): `currentVersionResolver: "git-tag"`, `fallbackCurrentVersionResolver: "disk"`

**CI Pipeline:**

- No `.github/` directory — no GitHub Actions workflows detected
- Local CI command: `npm run ci` (runs `nx format:check && nx run-many -t build,test,lint,typecheck,e2e --exclude tag:polyrepo:external`)

## Environment Configuration

**Required env vars:**

- None required for normal plugin operation
- Optional Nx behavior vars:
  - `NX_DAEMON` — set `false` to disable daemon (useful for debugging graph extraction)
  - `NX_PLUGIN_NO_TIMEOUTS` — set `true` to disable plugin execution timeouts during slow graph extraction

**Secrets location:**

- No secrets managed by this codebase
- Git credentials: host OS credential store
- e2e registry token: ephemeral, hardcoded test value written to `.npmrc.e2e` and deleted after use

## Webhooks & Callbacks

**Incoming:**

- None

**Outgoing:**

- None — the plugin is purely local; it spawns child processes but makes no HTTP calls at runtime

## Docker (e2e only)

**Images used:**

- `node:22-slim` — base image for both `nx-prep` and `workspace` build stages (`packages/op-nx-polyrepo-e2e/docker/Dockerfile`)
- `hertzg/verdaccio` — Verdaccio container started by testcontainers in `packages/op-nx-polyrepo-e2e/src/setup/global-setup.ts`

**Container orchestration:**

- `testcontainers` library (`GenericContainer`, `GenericContainer.fromDockerfile`) manages Docker lifecycle
- BuildKit is enabled (`withBuildkit()`) for layer caching
- The snapshot image (`op-nx-e2e-snapshot`) is content-addressed via `PLUGIN_HASH` build arg (sha256 of published tarball) to achieve cache hits when plugin source is unchanged

---

_Integration audit: 2026-03-22_
