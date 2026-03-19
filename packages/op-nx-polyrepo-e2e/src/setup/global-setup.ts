/**
 * Vitest globalSetup for e2e testing with testcontainers.
 *
 * Orchestrates the full container lifecycle:
 * 1. Build prebaked workspace Docker image
 * 2. Create shared network
 * 3. Start Verdaccio registry container
 * 4. Publish plugin to Verdaccio (on host)
 * 5. Start workspace container and install plugin
 * 6. Commit snapshot image
 * 7. Provide snapshot image to test files
 * 8. Return teardown function
 */
import './provided-context.js';

import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

import { GenericContainer, type StartedTestContainer, Network, type StartedNetwork, Wait } from 'testcontainers';
import type { TestProject } from 'vitest/node';

import { releasePublish, releaseVersion } from 'nx/release';

const require = createRequire(import.meta.url);
const nxVersion: string = require('nx/package.json').version;

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
    // Remove stale network
    'docker network rm op-nx-polyrepo-e2e 2>/dev/null || true',
    // Remove previous snapshot image (single-use, rebuilt each run)
    'docker rmi op-nx-e2e-snapshot:latest 2>/dev/null || true',
  ];

  for (const cmd of commands) {
    execSync(cmd, { stdio: 'ignore', windowsHide: true });
  }
}

export default async function setup(project: TestProject) {
  let network: StartedNetwork | undefined;
  let verdaccio: StartedTestContainer | undefined;
  let workspace: StartedTestContainer | undefined;

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

    // Phase 1: Build image and create network in parallel (independent)
    const dockerfilePath = resolve(__dirname, '../../docker').replaceAll('\\', '/');
    const verdaccioConfig = resolve(__dirname, '../../docker/verdaccio.yaml').replaceAll('\\', '/');

    const [workspaceImage, startedNetwork] = await timed(
      'Image + network ready',
      () => Promise.all([
        GenericContainer.fromDockerfile(dockerfilePath)
          .withCache(true)
          .build('op-nx-e2e-workspace', { deleteOnExit: false }),
        new Network().start(),
      ]),
    );

    network = startedNetwork;

    // Phase 2: Start Verdaccio and workspace in parallel (both need network)
    // network is guaranteed assigned from phase 1 above
    const readyNetwork = network;

    const [startedVerdaccio, startedWorkspace] = await timed(
      'Verdaccio + workspace started',
      () => Promise.all([
        new GenericContainer('hertzg/verdaccio')
          .withNetwork(readyNetwork)
          .withNetworkAliases('verdaccio')
          .withExposedPorts(4873)
          .withName('op-nx-polyrepo-e2e-verdaccio')
          .withCopyFilesToContainer([{ source: verdaccioConfig, target: '/verdaccio/conf/config.yaml' }])
          .withWaitStrategy(Wait.forListeningPorts())
          .start(),
        workspaceImage
          .withNetwork(readyNetwork)
          .withName('op-nx-polyrepo-e2e-workspace')
          .withCommand(['sleep', 'infinity'])
          .start(),
      ]),
    );

    verdaccio = startedVerdaccio;
    workspace = startedWorkspace;

    // Local binding guaranteed non-undefined for closures below
    const ctr = startedWorkspace;

    // Phase 3: Publish plugin and write nx.json in parallel
    // (publish needs Verdaccio, write needs workspace — independent)
    const registryPort = verdaccio.getMappedPort(4873);
    const registryUrl = `http://localhost:${String(registryPort)}`;

    const nxJsonContent = JSON.stringify(
      {
        plugins: [
          {
            plugin: '@op-nx/polyrepo',
            options: {
              repos: {
                nx: { url: 'file:///repos/nx', depth: 1, ref: nxVersion },
              },
            },
          },
        ],
      },
      null,
      2,
    );

    await timed('Published + nx.json written', () => Promise.all([
      publishPlugin(registryPort, registryUrl),
      ctr.exec(
        [
          'sh',
          '-c',
          `cat > /workspace/nx.json << 'NXJSONEOF'\n${nxJsonContent}\nNXJSONEOF`,
        ],
        { workingDir: '/workspace' },
      ),
    ]));

    // Phase 4: Install plugin (needs both Verdaccio published + workspace ready)
    await timed('Plugin installed', async () => {
      const installResult = await ctr.exec(
        ['npm', 'install', '-D', '@op-nx/polyrepo@e2e', '--registry', 'http://verdaccio:4873'],
        { workingDir: '/workspace' },
      );

      if (installResult.exitCode !== 0) {
        throw new Error(
          `Plugin install failed (exit ${String(installResult.exitCode)}):\n${installResult.stderr || installResult.output}`,
        );
      }
    });

    // Phase 5: Warm the plugin's graph cache.
    // This triggers createNodesV2 → populateGraphReport → extractGraphFromRepo
    // which writes .repos/.polyrepo-graph-cache.json. Without this, every test
    // container's first nx command would re-extract the graph.
    await timed('Graph cache warmed', () => ctr.exec(
      ['npx', 'nx', 'show', 'projects'],
      { workingDir: '/workspace' },
    ));

    // Phase 6: Delete node_modules to shrink the overlay2 diff before commit.
    // The npm cache (~/.npm/_cacache/) stays in the snapshot. Each test
    // container restores node_modules via `npm install --prefer-offline`
    // in startContainer() (~15-30s from cache vs ~5min commit with 30K files).
    await timed('node_modules deleted', () => ctr.exec(
      ['rm', '-rf', '/workspace/node_modules'],
      { workingDir: '/workspace' },
    ));

    // Phase 7: Commit snapshot image
    const snapshotImage = await timed('Snapshot committed', () => ctr.commit({
      repo: 'op-nx-e2e-snapshot',
      tag: 'latest',
      deleteOnExit: true,
    }));

    // 7. Provide to test files via Vitest inject()
    project.provide('snapshotImage', snapshotImage);

    // Stop the setup workspace (tests use snapshot, not this container)
    await timed('Setup container stopped', async () => {
      await ctr.stop();
      workspace = undefined;
    });

    // 8. Return teardown function
    return async function teardown() {
      console.log('[e2e] Tearing down...');

      if (verdaccio) {
        await verdaccio.stop();
      }

      if (network) {
        await network.stop();
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
    // Attempt to clean up any started containers/network before re-throwing
    console.error('[e2e] Global setup failed, cleaning up...');

    if (workspace) {
      try {
        await workspace.stop();
      } catch {
        // Ignore cleanup errors
      }
    }

    if (verdaccio) {
      try {
        await verdaccio.stop();
      } catch {
        // Ignore cleanup errors
      }
    }

    if (network) {
      try {
        await network.stop();
      } catch {
        // Ignore cleanup errors
      }
    }

    throw error;
  }
}
