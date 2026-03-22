# Phase 6: Add e2e container - Context

**Gathered:** 2026-03-16
**Status:** Ready for planning

<domain>
## Phase Boundary

Docker container with prebaked Nx workspace and git repo to eliminate scaffold and clone overhead in e2e tests. Reduces e2e runtime from ~3 min to under 30s. Host builds + publishes the plugin; container consumes + tests.

</domain>

<decisions>
## Implementation Decisions

### Container orchestration

- Use **testcontainers** (`testcontainers` npm package) with `GenericContainer` (not `DockerComposeEnvironment`) for programmatic container lifecycle management
- testcontainers manages Docker in both local (Docker Desktop) and CI (GitHub Actions ubuntu-latest) — same code path, no environment-specific branching
- Vitest `globalSetup` starts containers, `globalTeardown` calls `.down()` — `nx run op-nx-polyrepo-e2e:e2e` stays the single entry point
- `docker-compose.e2e.yml` retained for declarative service definition (colocated in `packages/op-nx-polyrepo-e2e/`)
- Vitest on host, `container.exec()` for running commands inside the container — minimal test code change
- Container names must be explicit to prevent clashing (e.g., `op-nx-polyrepo-e2e` not `workspace`)
- In CI, set `TESTCONTAINERS_RYUK_DISABLED=true` to save ~1-3s (runner is ephemeral)

### Container lifecycle & isolation

- **Snapshot pattern** via `container.commit()` — globalSetup installs plugin into prebaked workspace, commits filesystem state as a local Docker image
- Each test file starts a **fresh container from the snapshot** (~2-4s) — full isolation between test files
- Tests within a file run sequentially against the same container
- `maxWorkers: 1` (sequential test files) for now — switch to parallel when test count grows
- Vitest `provide()`/`inject()` to share snapshot image ID, network ID, and Verdaccio port from globalSetup to test files

### Verdaccio

- Verdaccio runs as a **GenericContainer** on a shared testcontainers Network (not host-side)
- Use `hertzg/verdaccio` image (multi-arch: arm64 + amd64) instead of `verdaccio/verdaccio` (amd64 only) — avoids QEMU emulation on Snapdragon X Elite
- Host publishes to Verdaccio via `localhost:<mappedPort>` using existing `nx release` APIs (`releaseVersion()` + `releasePublish()`)
- Workspace containers install from Verdaccio via network alias `http://verdaccio:4873`

### Plugin install flow

- Keep existing `releaseVersion()` + `releasePublish()` API calls from current `start-local-registry.ts` — just change registry URL to containerized Verdaccio's mapped port
- Plugin install happens in globalSetup **before** `commit()` — snapshot already includes the installed plugin
- Prebake `git clone --depth 1` of nrwl/nx at a **pinned ref** (version tag/branch) in the Dockerfile — zero network dependency at test time

### Docker image build & CI

- **Locally:** always `docker build` from Dockerfile — Docker layer cache makes it ~1-2s when nothing changed, full rebuild only when Dockerfile/Nx version/repo ref changes
- **CI:** same `docker build` with **GHA cache backend** (`cache-from: type=gha`, `cache-to: type=gha,mode=max`) — ~10-20s on cache hit, ~60-90s on first/cold run
- **Single platform per environment** — locally builds arm64 implicitly (Docker Desktop default), CI builds amd64 explicitly. No multi-platform build needed.
- arm64-native `node:22-slim` base image — runs natively on Snapdragon X Elite via Docker Desktop
- Dockerfile, Nx version, and nrwl/nx ref are the rebuild triggers. Plugin source changes do NOT trigger rebuild (plugin is installed at runtime via Verdaccio)

### Claude's Discretion

- Dockerfile layer ordering and optimization
- testcontainers wait strategy details (health check vs log message vs port)
- Exact `commit()` options and image tagging
- globalSetup/globalTeardown implementation structure
- CI workflow file structure and step ordering
- Whether to keep `docker-compose.e2e.yml` or go pure GenericContainer (research showed GenericContainer is needed for commit(), but compose file may still be useful for documentation/manual debugging)

</decisions>

<specifics>
## Specific Ideas

- Research found testcontainers container naming uses `-1` suffix (`getContainer("service-1")`) — use `.withProjectName()` for deterministic names if using DockerComposeEnvironment anywhere
- `container.exec()` returns `{ output, stdout, stderr, exitCode }` — replaces current `execSync` pattern with typed results
- `container.copyContentToContainer()` can inject config files (nx.json) as string content without exec overhead
- Set `DEBUG=testcontainers,testcontainers:compose,testcontainers:exec` for debugging container issues
- Current e2e `testTimeout: 300_000` and `hookTimeout: 300_000` should be reduced significantly with container approach (target: 30s total)

</specifics>

<code_context>

## Existing Code Insights

### Reusable Assets

- `tools/scripts/start-local-registry.ts`: Verdaccio startup + nx release version/publish — adapt for containerized Verdaccio
- `tools/scripts/stop-local-registry.ts`: Teardown pattern — replace with testcontainers cleanup
- `packages/op-nx-polyrepo-e2e/vitest.config.mts`: globalSetup/globalTeardown hooks — extend with Docker lifecycle
- `packages/op-nx-polyrepo-e2e/src/op-nx-polyrepo.spec.ts`: `runNx()`, `registerPlugin()`, `createTestProject()` helpers — adapt `runNx()` to use `container.exec()`, remove `createTestProject()` (prebaked)

### Established Patterns

- Vitest `globalSetup` returns cleanup function via `global.stopLocalRegistry` — replace with testcontainers' automatic Ryuk cleanup
- `execSync` for running commands in test workspace — replace with `container.exec()` API
- `pool: 'forks'` + `maxWorkers: 1` for serial e2e execution — keep for now

### Integration Points

- `packages/op-nx-polyrepo-e2e/package.json`: `dependsOn: ["^build"]` ensures plugin is built before e2e — keep
- `vitest.config.mts` globalSetup/globalTeardown — main integration point for Docker lifecycle
- `.github/workflows/` — needs e2e job with Docker setup (buildx, GHA cache)

</code_context>

<alternatives>
## Documented Alternatives

If testcontainers has real-world issues (performance, Docker version incompatibility, Ryuk race condition on fast machines), these are validated fallback options:

### Fallback A: docker-compose + execSync

- `docker compose up -d` in globalSetup, `docker compose down` in globalTeardown
- Tests use `execSync('docker exec ...')` instead of `container.exec()`
- Zero npm dependencies, direct Docker CLI control
- Loses: auto-cleanup (Ryuk), typed API, wait strategies

### Fallback B: Hybrid per-environment

- testcontainers locally (auto-cleanup matters for developer machines)
- GitHub Actions `services:` for Verdaccio + `docker run` for workspace in CI
- Two code paths but each optimized for its environment
- Note: `services:` is designed for network services (Verdaccio fits), but `docker exec` into services containers requires discovering container ID via `docker ps`

### Fallback C: Host-side Verdaccio

- Keep current `@nx/js:verdaccio` executor on host instead of containerizing
- Workspace containers connect via `host.docker.internal:4873`
- Caveat: `host.docker.internal` needs `--add-host=host.docker.internal:host-gateway` on Linux CI runners

</alternatives>

<deferred>
## Deferred Ideas

- **Parallel test files** — increase `maxWorkers` when test file count grows to 5-10. Each file gets its own container from snapshot, naturally parallel-safe.
- **GHCR pre-built images** — push prebaked images to `ghcr.io/op-nx/polyrepo-e2e` for ~3-5s CI pull instead of ~10-20s cached build. Worth it when CI frequency increases.
- **Multi-platform builds** — build arm64+amd64 in CI when other arm64 contributors join or self-hosted arm64 runners are added.
- **Scalability test images** — separate Dockerfile/image with larger prebaked workspaces (100+ projects) for stress testing. Different image, same testcontainers pattern.

</deferred>

---

_Phase: 06-add-e2e-container_
_Context gathered: 2026-03-16_
