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

export default async function setup(project: TestProject) {
  let network: StartedNetwork | undefined;
  let verdaccio: StartedTestContainer | undefined;
  let workspace: StartedTestContainer | undefined;

  try {
    const t0 = performance.now();
    const elapsed = () => `${((performance.now() - t0) / 1000).toFixed(1)}s`;

    // Phase 1: Build image and create network in parallel (independent)
    console.log('[e2e] Building image and creating network...');
    const dockerfilePath = resolve(__dirname, '../../docker').replaceAll('\\', '/');
    const verdaccioConfig = resolve(__dirname, '../../docker/verdaccio.yaml').replaceAll('\\', '/');

    const [workspaceImage, startedNetwork] = await Promise.all([
      GenericContainer.fromDockerfile(dockerfilePath)
        .withCache(true)
        .build('op-nx-e2e-workspace', { deleteOnExit: false }),
      new Network().start(),
    ]);

    network = startedNetwork;
    console.log(`[e2e] [${elapsed()}] Image + network ready`);

    // Phase 2: Start Verdaccio and workspace in parallel (both need network)
    const [startedVerdaccio, startedWorkspace] = await Promise.all([
      new GenericContainer('hertzg/verdaccio')
        .withNetwork(network)
        .withNetworkAliases('verdaccio')
        .withExposedPorts(4873)
        .withName('op-nx-polyrepo-e2e-verdaccio')
        .withCopyFilesToContainer([{ source: verdaccioConfig, target: '/verdaccio/conf/config.yaml' }])
        .withWaitStrategy(Wait.forListeningPorts())
        .start(),
      workspaceImage
        .withNetwork(network)
        .withName('op-nx-polyrepo-e2e-workspace')
        .withCommand(['sleep', 'infinity'])
        .start(),
    ]);

    verdaccio = startedVerdaccio;
    workspace = startedWorkspace;
    console.log(`[e2e] [${elapsed()}] Verdaccio + workspace started`);

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

    await Promise.all([
      publishPlugin(registryPort, registryUrl),
      workspace.exec(
        [
          'sh',
          '-c',
          `cat > /workspace/nx.json << 'NXJSONEOF'\n${nxJsonContent}\nNXJSONEOF`,
        ],
        { workingDir: '/workspace' },
      ),
    ]);

    console.log(`[e2e] [${elapsed()}] Published + nx.json written`);

    // Phase 4: Install plugin (needs both Verdaccio published + workspace ready)
    const installResult = await workspace.exec(
      ['npm', 'install', '-D', '@op-nx/polyrepo@e2e', '--registry', 'http://verdaccio:4873'],
      { workingDir: '/workspace' },
    );

    if (installResult.exitCode !== 0) {
      throw new Error(
        `Plugin install failed (exit ${String(installResult.exitCode)}):\n${installResult.stderr || installResult.output}`,
      );
    }

    console.log(`[e2e] [${elapsed()}] Plugin installed`);

    // Phase 5: Warm the plugin's graph cache.
    // This triggers createNodesV2 → populateGraphReport → extractGraphFromRepo
    // which writes .repos/.polyrepo-graph-cache.json. Without this, every test
    // container's first nx command would re-extract the graph.
    await workspace.exec(
      ['npx', 'nx', 'show', 'projects'],
      { workingDir: '/workspace' },
    );

    console.log(`[e2e] [${elapsed()}] Graph cache warmed`);

    // Phase 6: Commit snapshot image
    console.log('[e2e] Committing workspace snapshot...');
    const snapshotImage = await workspace.commit({
      repo: 'op-nx-e2e-snapshot',
      tag: 'latest',
      deleteOnExit: true,
    });

    // 7. Provide to test files via Vitest inject()
    project.provide('snapshotImage', snapshotImage);

    // Stop the setup workspace (tests use snapshot, not this container)
    await workspace.stop();
    workspace = undefined;

    console.log(`[e2e] [${elapsed()}] Global setup complete.`);

    // 8. Return teardown function
    return async function teardown() {
      console.log('[e2e] Tearing down...');

      if (verdaccio) {
        await verdaccio.stop();
      }

      if (network) {
        await network.stop();
      }

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
