/**
 * Vitest globalSetup for e2e testing with testcontainers.
 *
 * Orchestrates the full container lifecycle:
 * 1. Build prebaked workspace Docker image + start Verdaccio (parallel)
 * 2. Publish plugin to Verdaccio (on host)
 * 3. Build snapshot image via `docker build --network=host` (installs
 *    plugin from Verdaccio, warms graph cache — no docker commit needed)
 * 4. Provide snapshot image to test files
 * 5. Return teardown function
 */
import './provided-context.js';

import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import type { TestProject } from 'vitest/node';

import { releasePublish, releaseVersion } from 'nx/release';

async function publishPlugin(registryPort: number, registryUrl: string): Promise<void> {
  const originalRegistry = process.env['npm_config_registry'];
  const originalNxDaemon = process.env['NX_DAEMON'];
  process.env['npm_config_registry'] = registryUrl;
  process.env['NX_DAEMON'] = 'false';

  execSync(
    `npm config set //localhost:${String(registryPort)}/:_authToken "secretVerdaccioToken" --ws=false`,
    { stdio: 'inherit', windowsHide: true },
  );

  try {
    await releaseVersion({
      specifier: '0.0.0-e2e',
      stageChanges: false,
      gitCommit: false,
      gitTag: false,
      firstRelease: true,
      versionActionsOptionsOverrides: {
        skipLockFileUpdate: true,
      },
    });

    await releasePublish({
      tag: 'e2e',
      firstRelease: true,
    });
  } finally {
    execSync(
      `npm config delete //localhost:${String(registryPort)}/:_authToken --ws=false`,
      { stdio: 'ignore', windowsHide: true },
    );

    if (originalRegistry === undefined) {
      delete process.env['npm_config_registry'];
    } else {
      process.env['npm_config_registry'] = originalRegistry;
    }

    if (originalNxDaemon === undefined) {
      delete process.env['NX_DAEMON'];
    } else {
      process.env['NX_DAEMON'] = originalNxDaemon;
    }
  }
}

/**
 * Remove stale resources from previous crashed/killed runs.
 * Keeps the base image (op-nx-e2e-workspace) and pulled images
 * (node:22-slim, hertzg/verdaccio) to speed up the next run.
 */
function cleanupStaleResources(): void {
  const commands = [
    // Remove any containers from previous e2e runs
    'docker rm -f $(docker ps -aq --filter name=op-nx-polyrepo-e2e) 2>/dev/null || true',
    // Remove stale network (no longer created, but clean up old ones)
    'docker network rm op-nx-polyrepo-e2e 2>/dev/null || true',
    // Remove previous snapshot image (single-use, rebuilt each run)
    'docker rmi op-nx-e2e-snapshot:latest 2>/dev/null || true',
  ];

  for (const cmd of commands) {
    execSync(cmd, { stdio: 'ignore', windowsHide: true });
  }
}

export default async function setup(project: TestProject) {
  let verdaccio: StartedTestContainer | undefined;

  // Clean up stale resources from previous crashed/killed runs
  cleanupStaleResources();

  try {
    function timedSync<T>(label: string, fn: () => T): T {
      const start = performance.now();
      const result = fn();
      const sec = (performance.now() - start) / 1000;
      const m = Math.floor(sec / 60);
      const s = sec % 60;
      const duration = m > 0 ? `${String(m)}m${s.toFixed(1)}s` : `${s.toFixed(1)}s`;
      console.log(`[e2e] ${label} (${duration})`);

      return result;
    }

    async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
      const start = performance.now();
      const result = await fn();
      const sec = (performance.now() - start) / 1000;
      const m = Math.floor(sec / 60);
      const s = sec % 60;
      const duration = m > 0 ? `${String(m)}m${s.toFixed(1)}s` : `${s.toFixed(1)}s`;
      console.log(`[e2e] ${label} (${duration})`);

      return result;
    }

    // Phase 1: Build base image and start Verdaccio in parallel
    const dockerfilePath = resolve(__dirname, '../../docker').replaceAll('\\', '/');
    const verdaccioConfig = resolve(__dirname, '../../docker/verdaccio.yaml').replaceAll('\\', '/');

    const [_baseImage, startedVerdaccio] = await timed(
      'Base image + Verdaccio ready',
      () => Promise.all([
        GenericContainer.fromDockerfile(dockerfilePath)
          .withCache(true)
          .build('op-nx-e2e-workspace', { deleteOnExit: false }),
        new GenericContainer('hertzg/verdaccio')
          .withExposedPorts(4873)
          .withName('op-nx-polyrepo-e2e-verdaccio')
          .withCopyFilesToContainer([{ source: verdaccioConfig, target: '/verdaccio/conf/config.yaml' }])
          .withWaitStrategy(Wait.forListeningPorts())
          .start(),
      ]),
    );

    verdaccio = startedVerdaccio;
    const registryPort = verdaccio.getMappedPort(4873);
    const registryUrl = `http://localhost:${String(registryPort)}`;

    // Phase 2: Publish plugin to Verdaccio
    await timed('Plugin published', () => publishPlugin(registryPort, registryUrl));

    // Phase 3: Build snapshot image via docker build --network=host.
    // This installs the plugin from Verdaccio and warms the graph cache
    // in a single Docker build step — no docker commit needed.
    const snapshotDockerfile = resolve(__dirname, '../../docker/Dockerfile.snapshot').replaceAll('\\', '/');

    timedSync('Snapshot built', () => {
      execSync(
        [
          'docker build --network=host',
          `-f "${snapshotDockerfile}"`,
          `--build-arg REGISTRY_URL=${registryUrl}`,
          '--build-arg PLUGIN_TAG=e2e',
          `-t op-nx-e2e-snapshot:latest`,
          `"${dockerfilePath}"`,
        ].join(' '),
        { stdio: 'inherit', windowsHide: true },
      );
    });

    // Phase 4: Provide snapshot image to test files
    project.provide('snapshotImage', 'op-nx-e2e-snapshot:latest');

    // Stop Verdaccio (no longer needed after build)
    await timed('Verdaccio stopped', async () => {
      await verdaccio?.stop();
      verdaccio = undefined;
    });

    // Return teardown function
    return async function teardown() {
      console.log('[e2e] Tearing down...');

      if (verdaccio) {
        await verdaccio.stop();
      }

      // Remove the snapshot image (single-use, rebuilt each run).
      // Keep the base image and BuildKit cache for faster rebuilds.
      execSync('docker rmi op-nx-e2e-snapshot:latest 2>/dev/null || true', {
        stdio: 'ignore',
        windowsHide: true,
      });

      console.log('[e2e] Teardown complete.');
    };
  } catch (error: unknown) {
    // Attempt to clean up any started containers before re-throwing
    console.error('[e2e] Global setup failed, cleaning up...');

    if (verdaccio) {
      try {
        await verdaccio.stop();
      } catch {
        // Ignore cleanup errors
      }
    }

    throw error;
  }
}
