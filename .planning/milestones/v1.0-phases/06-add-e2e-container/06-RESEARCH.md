# Phase 6: Add e2e container - Research

**Researched:** 2026-03-16
**Domain:** Docker container orchestration for e2e testing (testcontainers + Verdaccio + Vitest)
**Confidence:** HIGH

## Summary

This phase replaces the current host-based e2e test flow (create-nx-workspace + git clone at test time) with a Docker-based approach where the Nx workspace and git repo are prebaked into a Docker image. The testcontainers npm package (v11.12.0) provides a mature, typed API for programmatic container lifecycle management from Node.js, including `container.exec()` for running commands inside containers and `container.commit()` for snapshotting container state as a new image.

The architecture is: Vitest globalSetup starts a testcontainers Network, launches a `hertzg/verdaccio` container on that network, publishes the plugin via existing `nx release` APIs to the containerized Verdaccio, starts a prebaked workspace container, installs the plugin from Verdaccio, commits the container state as a snapshot image, then each test file starts a fresh container from that snapshot. Vitest 4.x `provide()`/`inject()` passes the snapshot image ID and network metadata from globalSetup to test files.

**Primary recommendation:** Use `testcontainers` v11.x with `GenericContainer`, Vitest 4.x `provide()`/`inject()` for cross-thread data sharing, and `hertzg/verdaccio` for multi-arch registry. Build the Dockerfile with `node:22-slim` base, prebake `create-nx-workspace` output and `git clone --depth 1` of nrwl/nx as cached layers.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- Use **testcontainers** (`testcontainers` npm package) with `GenericContainer` (not `DockerComposeEnvironment`) for programmatic container lifecycle management
- testcontainers manages Docker in both local (Docker Desktop) and CI (GitHub Actions ubuntu-latest) -- same code path, no environment-specific branching
- Vitest `globalSetup` starts containers, `globalTeardown` calls `.down()` -- `nx run op-nx-polyrepo-e2e:e2e` stays the single entry point
- `docker-compose.e2e.yml` retained for declarative service definition (colocated in `packages/op-nx-polyrepo-e2e/`)
- Vitest on host, `container.exec()` for running commands inside the container -- minimal test code change
- Container names must be explicit to prevent clashing (e.g., `op-nx-polyrepo-e2e` not `workspace`)
- In CI, set `TESTCONTAINERS_RYUK_DISABLED=true` to save ~1-3s (runner is ephemeral)
- **Snapshot pattern** via `container.commit()` -- globalSetup installs plugin into prebaked workspace, commits filesystem state as a local Docker image
- Each test file starts a **fresh container from the snapshot** (~2-4s) -- full isolation between test files
- Tests within a file run sequentially against the same container
- `maxWorkers: 1` (sequential test files) for now
- Vitest `provide()`/`inject()` to share snapshot image ID, network ID, and Verdaccio port from globalSetup to test files
- Verdaccio runs as a **GenericContainer** on a shared testcontainers Network (not host-side)
- Use `hertzg/verdaccio` image (multi-arch: arm64 + amd64) instead of `verdaccio/verdaccio` (amd64 only)
- Host publishes to Verdaccio via `localhost:<mappedPort>` using existing `nx release` APIs (`releaseVersion()` + `releasePublish()`)
- Workspace containers install from Verdaccio via network alias `http://verdaccio:4873`
- Keep existing `releaseVersion()` + `releasePublish()` API calls from current `start-local-registry.ts`
- Plugin install happens in globalSetup **before** `commit()` -- snapshot already includes the installed plugin
- Prebake `git clone --depth 1` of nrwl/nx at a **pinned ref** in the Dockerfile
- **Locally:** always `docker build` from Dockerfile -- Docker layer cache makes it ~1-2s when nothing changed
- **CI:** same `docker build` with **GHA cache backend** (`cache-from: type=gha`, `cache-to: type=gha,mode=max`)
- **Single platform per environment** -- locally builds arm64 implicitly, CI builds amd64 explicitly
- arm64-native `node:22-slim` base image
- Dockerfile, Nx version, and nrwl/nx ref are the rebuild triggers. Plugin source changes do NOT trigger rebuild

### Claude's Discretion
- Dockerfile layer ordering and optimization
- testcontainers wait strategy details (health check vs log message vs port)
- Exact `commit()` options and image tagging
- globalSetup/globalTeardown implementation structure
- CI workflow file structure and step ordering
- Whether to keep `docker-compose.e2e.yml` or go pure GenericContainer

### Deferred Ideas (OUT OF SCOPE)
- Parallel test files (increase `maxWorkers` later)
- GHCR pre-built images
- Multi-platform builds
- Scalability test images
</user_constraints>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| testcontainers | ^11.12.0 | Container lifecycle management | De facto standard for container-based testing in Node.js; typed API, auto-cleanup via Ryuk, cross-platform |
| vitest | ^4.0.0 (4.0.18 installed) | Test runner | Already in use; provides globalSetup with `provide()`/`inject()` for cross-thread data |
| Docker (engine) | 20.10+ | Container runtime | Docker Desktop on local (Snapdragon X Elite arm64), standard ubuntu-latest in CI |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| hertzg/verdaccio | latest | Multi-arch npm registry container | arm64 + amd64 support; drop-in replacement for `verdaccio/verdaccio` |
| node:22-slim | LTS | Base Docker image for workspace container | Prebaked with create-nx-workspace output |
| nx/release | 22.5.4 | `releaseVersion()` + `releasePublish()` APIs | Already used in current e2e; publishes plugin to Verdaccio |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| testcontainers | docker-compose CLI + execSync | Loses typed API, auto-cleanup, wait strategies; zero npm deps |
| hertzg/verdaccio | verdaccio/verdaccio | amd64 only -- requires QEMU emulation on Snapdragon X Elite |
| container.commit() | Docker volumes / bind mounts | Loses snapshot isolation; filesystem I/O slower with bind mounts on Windows |

**Installation:**
```bash
npm install -D testcontainers
```

Note: `testcontainers` has no peer dependencies. It bundles `dockerode` for Docker API communication.

## Architecture Patterns

### Recommended Project Structure
```
packages/op-nx-polyrepo-e2e/
  docker/
    Dockerfile                  # Prebaked workspace image
    .dockerignore               # Exclude node_modules, etc.
  src/
    setup/
      global-setup.ts           # testcontainers lifecycle + provide()
      global-teardown.ts        # cleanup (or inline teardown in setup)
      container-helpers.ts      # Shared helpers: startWorkspace(), exec wrappers
      provided-context.ts       # ProvidedContext type declaration
    op-nx-polyrepo.spec.ts      # Refactored test using inject() + container.exec()
  vitest.config.mts             # Updated globalSetup/globalTeardown paths
  package.json
```

### Pattern 1: testcontainers Network + GenericContainer
**What:** Create a shared Docker network, attach Verdaccio and workspace containers to it, use network aliases for inter-container DNS resolution.
**When to use:** Always -- this is the core orchestration pattern.
**Example:**
```typescript
// Source: https://node.testcontainers.org/features/networking/
import { GenericContainer, Network } from 'testcontainers';

const network = await new Network().start();

const verdaccio = await new GenericContainer('hertzg/verdaccio')
  .withNetwork(network)
  .withNetworkAliases('verdaccio')
  .withExposedPorts(4873)
  .start();

// Host publishes to Verdaccio via mapped port
const registryUrl = `http://localhost:${verdaccio.getMappedPort(4873)}`;

const workspace = await new GenericContainer('op-nx-e2e-workspace')
  .withNetwork(network)
  .withCommand(['sleep', 'infinity'])
  .start();

// Inside container, Verdaccio is reachable at http://verdaccio:4873
```

### Pattern 2: Snapshot via container.commit()
**What:** After installing the plugin into the prebaked workspace, commit the container filesystem as a new Docker image. Each test file starts a fresh container from this snapshot.
**When to use:** globalSetup -- once per test run.
**Example:**
```typescript
// Source: https://node.testcontainers.org/features/containers/
// Install plugin into workspace
await workspace.exec(['npm', 'install', '-D', '@op-nx/polyrepo@e2e', '--registry', 'http://verdaccio:4873']);

// Commit snapshot
const snapshotImageId = await workspace.commit({
  repo: 'op-nx-e2e-snapshot',
  tag: 'latest',
  deleteOnExit: true,  // Ryuk cleans up the image
});

// In test files, start fresh containers from snapshot:
const testContainer = await new GenericContainer(snapshotImageId)
  .withNetwork(network)
  .withCommand(['sleep', 'infinity'])
  .start();
```

### Pattern 3: Vitest provide()/inject() for Cross-Thread Data
**What:** globalSetup runs in a separate thread from test workers. Use Vitest's `provide()` to pass snapshot image ID and network metadata.
**When to use:** Always -- required to share testcontainers state with test files.
**Example:**
```typescript
// Source: https://vitest.dev/config/globalsetup.html
// global-setup.ts
import type { TestProject } from 'vitest/node';

export default async function setup(project: TestProject) {
  // ... start containers, create snapshot ...
  project.provide('snapshotImage', snapshotImageId);
  project.provide('networkId', network.getId());

  return async function teardown() {
    await workspace.stop();
    await verdaccio.stop();
    await network.stop();
  };
}

// Type declaration (must be in a .d.ts or augmentation)
declare module 'vitest' {
  export interface ProvidedContext {
    snapshotImage: string;
    networkId: string;
  }
}
```

```typescript
// In test file
import { inject } from 'vitest';

const snapshotImage = inject('snapshotImage');
```

### Pattern 4: container.exec() Replacing execSync
**What:** Replace host-side `execSync('npx nx ...')` with `container.exec(['npx', 'nx', ...])`.
**When to use:** Every test assertion that runs Nx commands.
**Example:**
```typescript
// Source: https://node.testcontainers.org/features/containers/
const { stdout, exitCode } = await container.exec(
  ['npx', 'nx', 'polyrepo-status'],
  { workingDir: '/workspace' }
);

expect(exitCode).toBe(0);
expect(stdout).toContain('[not synced]');
```

### Anti-Patterns to Avoid
- **Bind mounts for workspace:** All filesystem I/O should stay on container's overlay2/ext4. Bind mounts are slower and break on Windows with path translation issues.
- **Sharing containers across test files:** Each test file gets its own container from snapshot for isolation. Never reuse a started container across files.
- **Using container hostnames for inter-container communication:** Use `withNetworkAliases()` instead -- hostnames are not DNS-resolvable across containers.
- **Hardcoding mapped ports:** Always use `container.getMappedPort(4873)` -- testcontainers assigns random host ports.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Container lifecycle | Manual `docker run`/`docker stop` scripts | testcontainers GenericContainer | Auto-cleanup (Ryuk), wait strategies, typed exec API, port mapping |
| Container-to-container networking | Manual `docker network create` + IP addresses | testcontainers Network + network aliases | DNS resolution via aliases, automatic cleanup |
| Cross-thread data passing | `global` variables, temp files, env vars | Vitest `provide()`/`inject()` | Type-safe, serialization-safe, designed for globalSetup-to-test communication |
| Wait for container readiness | `sleep` / polling loops | testcontainers wait strategies | Built-in log, port, HTTP health check strategies |
| Registry setup/teardown | Shell scripts for Verdaccio lifecycle | testcontainers GenericContainer for hertzg/verdaccio | Same lifecycle management as workspace container |

**Key insight:** testcontainers abstracts Docker CLI complexity into a typed Node.js API. The auto-cleanup via Ryuk prevents orphaned containers even when tests crash.

## Common Pitfalls

### Pitfall 1: Ryuk Container Conflicts on Windows
**What goes wrong:** Ryuk (testcontainers' cleanup daemon) may fail to start or conflict with existing Ryuk instances, especially on Docker Desktop for Windows.
**Why it happens:** Ryuk runs as a privileged container that monitors and cleans up other containers. Docker Desktop socket permissions differ across OS.
**How to avoid:** testcontainers handles this automatically. If issues arise, set `TESTCONTAINERS_RYUK_DISABLED=true` (already planned for CI). Locally, Ryuk should work with Docker Desktop defaults.
**Warning signs:** Timeout errors during container startup mentioning "ryuk" or "reaper".

### Pitfall 2: Network Not Available After commit()
**What goes wrong:** The committed snapshot image does not inherit network configuration. Starting a container from the snapshot without re-attaching to the network means it cannot reach Verdaccio.
**Why it happens:** `commit()` captures filesystem state, not runtime configuration (network, ports, env vars).
**How to avoid:** When starting a container from the snapshot in test files, always re-attach `.withNetwork(network)` and set any needed environment variables.
**Warning signs:** `ECONNREFUSED` when tests try to reach Verdaccio from snapshot containers.

### Pitfall 3: Vitest provide() Only Accepts Serializable Data
**What goes wrong:** Attempting to pass testcontainers objects (StartedGenericContainer, Network) via `provide()` fails.
**Why it happens:** `provide()` uses structured clone -- only serializable primitives, arrays, and plain objects work.
**How to avoid:** Pass string IDs (image name, network ID/name), not object references. Reconstruct testcontainers references in test files using the IDs.
**Warning signs:** Serialization errors in globalSetup, or `undefined` values when using `inject()`.

### Pitfall 4: create-nx-workspace Needs npm Registry During Docker Build
**What goes wrong:** `create-nx-workspace` downloads packages from the npm registry. If the Dockerfile runs this without a registry, the build fails.
**Why it happens:** The prebake layer runs during `docker build`, which has full network access.
**How to avoid:** This is fine -- `docker build` has network access by default. The constraint "no network dependency" applies only to test execution time, not image build time.
**Warning signs:** None if network is available during build.

### Pitfall 5: NX_DAEMON Must Be Disabled Inside Container
**What goes wrong:** Nx daemon starts inside the container and holds file locks, preventing clean container stop. Or daemon timeout causes test failures.
**Why it happens:** Container lifecycle is controlled externally; daemon assumes long-lived process.
**How to avoid:** Set `ENV NX_DAEMON=false` in the Dockerfile and pass it to `container.exec()` calls.
**Warning signs:** Hung container stop, timeout errors in exec calls.

### Pitfall 6: npm Registry URL Configuration Inside Container
**What goes wrong:** `npm install @op-nx/polyrepo@e2e` inside the container uses the default npm registry instead of the containerized Verdaccio.
**Why it happens:** The container's npm config points to `registry.npmjs.org` by default.
**How to avoid:** Either set `npm config set registry http://verdaccio:4873` in the container before install, or use `--registry http://verdaccio:4873` flag.
**Warning signs:** 404 errors for `@op-nx/polyrepo@0.0.0-e2e`.

### Pitfall 7: Snapshot Image Reconstruction in Test Files
**What goes wrong:** Test files need to start containers from the committed snapshot, but `GenericContainer` needs an image name, not an image ID hash.
**Why it happens:** `commit()` returns an image ID. `GenericContainer` accepts image names/IDs.
**How to avoid:** Use the repo:tag format from `commit({ repo: 'name', tag: 'tag' })` -- e.g., `new GenericContainer('op-nx-e2e-snapshot:latest')`. Alternatively, pass the returned image ID directly.
**Warning signs:** `ImageNotFound` errors in test files.

## Code Examples

### Dockerfile for Prebaked Workspace

```dockerfile
# Source: Project-specific design based on CONTEXT.md decisions
FROM node:22-slim AS base

# Install git (needed for nrwl/nx clone and Nx operations)
RUN apt-get update && apt-get install -y --no-install-recommends git && \
    rm -rf /var/lib/apt/lists/*

# Disable Nx daemon inside container
ENV NX_DAEMON=false

# Prebake create-nx-workspace output
# This layer rebuilds only when Nx version changes
ARG NX_VERSION=22.5.4
RUN npx --yes create-nx-workspace@${NX_VERSION} workspace \
    --preset=apps --ci=skip --interactive=false --nxCloud=skip \
    && mv workspace /workspace

# Prebake git clone of nrwl/nx at pinned ref
# This layer rebuilds only when NX_REF changes
ARG NX_REF=master
RUN git clone --depth 1 --branch ${NX_REF} https://github.com/nrwl/nx.git /repos/nx

WORKDIR /workspace

# Keep container alive for exec commands
CMD ["sleep", "infinity"]
```

### Global Setup with testcontainers

```typescript
// Source: https://node.testcontainers.org/features/containers/
//         https://vitest.dev/config/globalsetup.html
import type { TestProject } from 'vitest/node';
import { GenericContainer, Network } from 'testcontainers';
import { releaseVersion, releasePublish } from 'nx/release';

export default async function setup(project: TestProject) {
  // 1. Build the prebaked image (uses Docker layer cache)
  // Could use GenericContainer.fromDockerfile() or shell out to docker build

  // 2. Create shared network
  const network = await new Network().start();

  // 3. Start Verdaccio
  const verdaccio = await new GenericContainer('hertzg/verdaccio')
    .withNetwork(network)
    .withNetworkAliases('verdaccio')
    .withExposedPorts(4873)
    .withName('op-nx-polyrepo-e2e-verdaccio')
    .start();

  const registryPort = verdaccio.getMappedPort(4873);
  const registryUrl = `http://localhost:${registryPort}`;

  // 4. Publish plugin to Verdaccio (on host)
  process.env['npm_config_registry'] = registryUrl;

  await releaseVersion({
    specifier: '0.0.0-e2e',
    stageChanges: false,
    gitCommit: false,
    gitTag: false,
    firstRelease: true,
    versionActionsOptionsOverrides: { skipLockFileUpdate: true },
  });

  await releasePublish({ tag: 'e2e', firstRelease: true });

  // 5. Start workspace container + install plugin
  const workspace = await new GenericContainer('op-nx-e2e-workspace:latest')
    .withNetwork(network)
    .withName('op-nx-polyrepo-e2e-workspace')
    .start();

  await workspace.exec([
    'npm', 'install', '-D', '@op-nx/polyrepo@e2e',
    '--registry', 'http://verdaccio:4873',
  ], { workingDir: '/workspace' });

  // 6. Commit snapshot
  const snapshotImage = await workspace.commit({
    repo: 'op-nx-e2e-snapshot',
    tag: 'latest',
    deleteOnExit: true,
  });

  // 7. Provide to test files
  project.provide('snapshotImage', snapshotImage);
  project.provide('networkName', network.getName());

  // Stop the setup workspace (tests use snapshot)
  await workspace.stop();

  return async function teardown() {
    await verdaccio.stop();
    await network.stop();
  };
}
```

### Test File Using inject()

```typescript
// Source: https://vitest.dev/config/globalsetup.html
import { describe, it, expect, beforeAll, afterAll, inject } from 'vitest';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';

describe('@op-nx/polyrepo e2e', () => {
  let container: StartedTestContainer;

  beforeAll(async () => {
    const snapshotImage = inject('snapshotImage');

    container = await new GenericContainer(snapshotImage)
      .withCommand(['sleep', 'infinity'])
      .start();
  });

  afterAll(async () => {
    if (container) {
      await container.stop();
    }
  });

  it('should be installed', async () => {
    const { exitCode } = await container.exec(
      ['npm', 'ls', '@op-nx/polyrepo'],
      { workingDir: '/workspace' },
    );

    expect(exitCode).toBe(0);
  });

  it('should report unsynced repos', async () => {
    // Register plugin in nx.json
    await container.exec(['sh', '-c', `cat > /workspace/nx.json << 'NXJSON'
{
  "plugins": [{
    "plugin": "@op-nx/polyrepo",
    "options": {
      "repos": {
        "nx": { "url": "/repos/nx", "depth": 1, "ref": "master" }
      }
    }
  }]
}
NXJSON`], { workingDir: '/workspace' });

    const { stdout } = await container.exec(
      ['npx', 'nx', 'polyrepo-status'],
      { workingDir: '/workspace' },
    );

    expect(stdout).toContain('[not synced]');
  });
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Host-side create-nx-workspace per test run | Prebaked Docker image with cached layers | This phase | ~3 min -> ~8-30s e2e runtime |
| Host-side git clone from GitHub | Prebaked local clone in Docker image | This phase | Zero network dependency at test time |
| `@nx/js:verdaccio` executor on host | `hertzg/verdaccio` container via testcontainers | This phase | arm64-native, consistent across local/CI |
| `execSync()` for in-workspace commands | `container.exec()` typed API | This phase | Typed return values, no shell escaping issues |
| `global.stopLocalRegistry` for cleanup | Vitest `provide()`/`inject()` + testcontainers Ryuk | This phase | Type-safe data sharing, automatic orphan cleanup |

**Deprecated/outdated:**
- `startLocalRegistry` from `@nx/js/plugins/jest/local-registry`: Despite the jest path, this is a generic Verdaccio launcher. Replaced by testcontainers-managed Verdaccio container.
- `global.stopLocalRegistry` pattern: Replaced by testcontainers automatic cleanup and Vitest teardown function return.

## Open Questions

1. **GenericContainer.fromDockerfile() vs shell docker build**
   - What we know: testcontainers has `GenericContainer.fromDockerfile()` that builds from a Dockerfile. Alternatively, we can shell out to `docker build` then use the image name.
   - What's unclear: Whether `fromDockerfile()` supports build args (NX_VERSION, NX_REF) and layer caching as effectively as `docker buildx build`.
   - Recommendation: Research `fromDockerfile()` during implementation. If it supports build args and caching, prefer it for consistency. Otherwise, use `execSync('docker build ...')` in globalSetup.

2. **Network object reconstruction in test files**
   - What we know: `provide()` can only pass serializable data. Network name/ID is a string.
   - What's unclear: Whether `GenericContainer` can attach to an existing network by name without a Network object reference.
   - Recommendation: The Network object stays alive in globalSetup's scope. Test files may not need the network if snapshot containers are self-sufficient (plugin already installed). If network is needed (e.g., for Verdaccio access during test), pass the network name and investigate `withNetworkMode()` or keeping Verdaccio alive.

3. **Verdaccio wait strategy**
   - What we know: testcontainers has log-based, port-based, and HTTP health check wait strategies.
   - What's unclear: Which is most reliable for Verdaccio startup detection.
   - Recommendation: Use `.withWaitStrategy(Wait.forListeningPorts())` (port 4873) as the simplest approach. If unreliable, switch to HTTP health check on `http://localhost:4873/-/ping`.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest 4.0.18 |
| Config file | `packages/op-nx-polyrepo-e2e/vitest.config.mts` |
| Quick run command | `npm exec nx e2e op-nx-polyrepo-e2e` |
| Full suite command | `npm exec nx e2e op-nx-polyrepo-e2e` (same -- single e2e target) |

### Phase Requirements -> Test Map

This phase has no formal requirement IDs (DX improvement). Validation is against the success criteria from the phase description:

| Criterion | Behavior | Test Type | Automated Command | File Exists? |
|-----------|----------|-----------|-------------------|-------------|
| SC-01 | e2e completes in under 30 seconds | smoke | `npm exec nx e2e op-nx-polyrepo-e2e` (check wall time) | Existing spec, refactored |
| SC-02 | e2e tests pass with identical assertions | e2e | `npm exec nx e2e op-nx-polyrepo-e2e` | Existing spec, refactored |
| SC-03 | No network dependency during test execution | manual-only | Verify Verdaccio is localhost, repo is local path | N/A |
| SC-04 | Docker image rebuilds only when Nx version or repo ref changes | manual-only | Change source, rebuild, verify layer cache hit | N/A |

### Sampling Rate
- **Per task commit:** `npm exec nx e2e op-nx-polyrepo-e2e`
- **Per wave merge:** Same (single e2e target)
- **Phase gate:** Full e2e green + wall time under 30 seconds

### Wave 0 Gaps
- [ ] `packages/op-nx-polyrepo-e2e/docker/Dockerfile` -- prebaked workspace image
- [ ] `packages/op-nx-polyrepo-e2e/src/setup/global-setup.ts` -- testcontainers lifecycle
- [ ] `packages/op-nx-polyrepo-e2e/src/setup/provided-context.ts` -- ProvidedContext type declaration
- [ ] `testcontainers` npm dependency -- `npm install -D testcontainers`

## Sources

### Primary (HIGH confidence)
- [testcontainers npm v11.12.0](https://www.npmjs.com/package/testcontainers) - version, dependencies, API surface
- [testcontainers Containers docs](https://node.testcontainers.org/features/containers/) - exec(), commit(), lifecycle, wait strategies
- [testcontainers Networking docs](https://node.testcontainers.org/features/networking/) - Network class, aliases, inter-container communication
- [Vitest globalSetup docs](https://vitest.dev/config/globalsetup.html) - provide()/inject() API, TestProject type, teardown patterns
- [hertzg/verdaccio Docker Hub](https://hub.docker.com/r/hertzg/verdaccio) - multi-arch image availability

### Secondary (MEDIUM confidence)
- [testcontainers DeepWiki](https://deepwiki.com/testcontainers/testcontainers-node/2.1-genericcontainer) - GenericContainer internals, commit() source analysis
- [Vitest + Testcontainers blog](https://nikolamilovic.com/posts/2025-4-15-integration-testing-node-vitest-testcontainers/) - real-world integration patterns

### Tertiary (LOW confidence)
- Dockerfile layer optimization best practices -- general Docker knowledge, not project-specific verified

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - testcontainers v11.12.0 verified via npm registry, API verified via official docs
- Architecture: HIGH - commit() + exec() + Network patterns all documented in official testcontainers docs; provide()/inject() documented in Vitest 4.x docs
- Pitfalls: MEDIUM - based on Docker experience and testcontainers docs; some pitfalls (Ryuk on Windows, network after commit) are inferred from architecture understanding

**Research date:** 2026-03-16
**Valid until:** 2026-04-16 (stable libraries, 30-day validity)
