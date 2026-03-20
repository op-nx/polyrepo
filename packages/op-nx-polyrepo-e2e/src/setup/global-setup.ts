/**
 * Vitest globalSetup for e2e testing with testcontainers.
 *
 * Orchestrates the full container lifecycle:
 * 1. Build prebaked workspace Docker image + start Verdaccio (parallel)
 * 2. Publish plugin to Verdaccio (on host)
 * 3. Build snapshot image via testcontainers fromDockerfile (installs
 *    plugin from Verdaccio via host.docker.internal, warms graph cache)
 * 4. Provide snapshot image to test files
 * 5. Return teardown function
 */
import './provided-context.js';

import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { unlinkSync, writeFileSync } from 'node:fs';

import { GenericContainer, type StartedTestContainer, Wait } from 'testcontainers';
import type { TestProject } from 'vitest/node';

import { releasePublish, releaseVersion } from 'nx/release';

/**
 * Publish the plugin to a local Verdaccio registry.
 *
 * Uses a project-scoped .npmrc file to avoid polluting the user's
 * global npm config. The env vars npm_config_userconfig and
 * npm_config_registry direct npm to use the temporary config.
 */
async function publishPlugin(registryPort: number, registryUrl: string): Promise<void> {
  const npmrcPath = resolve(process.cwd(), '.npmrc.e2e');
  const saved = {
    registry: process.env['npm_config_registry'],
    userconfig: process.env['npm_config_userconfig'],
    nxDaemon: process.env['NX_DAEMON'],
  };

  writeFileSync(
    npmrcPath,
    `//localhost:${String(registryPort)}/:_authToken=secretVerdaccioToken\n`,
  );

  process.env['npm_config_userconfig'] = npmrcPath;
  process.env['npm_config_registry'] = registryUrl;
  process.env['NX_DAEMON'] = 'false';

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
    try {
      unlinkSync(npmrcPath);
    } catch {
      // File may not exist if writeFileSync failed
    }

    for (const [key, value] of Object.entries(saved)) {
      const envKey = key === 'nxDaemon' ? 'NX_DAEMON' : `npm_config_${key}`;

      if (value === undefined) {
        delete process.env[envKey];
      } else {
        process.env[envKey] = value;
      }
    }
  }
}

/**
 * Remove stale resources from previous crashed/killed runs.
 *
 * Testcontainers' Ryuk reaper handles containers it manages, but
 * hard crashes (SIGKILL, power loss) can leave named containers
 * behind. The image removal ensures a fresh snapshot each run.
 */
function cleanupStaleResources(): void {
  const commands = [
    'docker rm -f $(docker ps -aq --filter name=op-nx-polyrepo-e2e) 2>/dev/null || true',
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
          .withBuildkit()
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

    // Phase 3: Build snapshot image. Installs the plugin from Verdaccio
    // and warms the graph cache. Uses host.docker.internal so the build
    // can reach Verdaccio's mapped port without --network=host.
    const snapshotImageName = 'op-nx-e2e-snapshot';

    await timed(
      'Snapshot built',
      () => GenericContainer.fromDockerfile(dockerfilePath, 'Dockerfile.snapshot')
        .withBuildArgs({
          REGISTRY_URL: `http://host.docker.internal:${String(registryPort)}`,
          PLUGIN_TAG: 'e2e',
        })
        .withBuildkit()
        .build(snapshotImageName, { deleteOnExit: true }),
    );

    // Phase 4: Provide snapshot image to test files
    project.provide('snapshotImage', snapshotImageName);

    // Stop Verdaccio (no longer needed after build)
    await timed('Verdaccio stopped', async () => {
      await verdaccio?.stop();
      verdaccio = undefined;
    });

    // Return teardown function (snapshot image cleaned up by testcontainers Ryuk)
    return async function teardown() {
      console.log('[e2e] Tearing down...');

      if (verdaccio) {
        await verdaccio.stop();
      }

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
