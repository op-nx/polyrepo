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

import { execSync } from 'node:child_process';
import { resolve } from 'node:path';

import { GenericContainer, type StartedTestContainer, Network, type StartedNetwork, Wait } from 'testcontainers';
import type { TestProject } from 'vitest/node';

import { releasePublish, releaseVersion } from 'nx/release';

export default async function setup(project: TestProject) {
  let network: StartedNetwork | undefined;
  let verdaccio: StartedTestContainer | undefined;
  let workspace: StartedTestContainer | undefined;

  try {
    // 1. Build the prebaked workspace image using testcontainers API
    console.log('[e2e] Building prebaked workspace Docker image...');
    const dockerfilePath = resolve(__dirname, '../../docker').replaceAll('\\', '/');
    const workspaceImage = await GenericContainer.fromDockerfile(dockerfilePath)
      .withCache(true)
      .build('op-nx-e2e-workspace', { deleteOnExit: false });

    // 2. Create shared network
    console.log('[e2e] Creating shared network...');
    network = await new Network().start();

    // 3. Start Verdaccio on the shared network with permissive config
    // (default hertzg/verdaccio config requires auth for publish)
    console.log('[e2e] Starting Verdaccio registry...');
    const verdaccioConfig = resolve(__dirname, '../../docker/verdaccio.yaml').replaceAll('\\', '/');
    verdaccio = await new GenericContainer('hertzg/verdaccio')
      .withNetwork(network)
      .withNetworkAliases('verdaccio')
      .withExposedPorts(4873)
      .withName('op-nx-polyrepo-e2e-verdaccio')
      .withCopyFilesToContainer([{ source: verdaccioConfig, target: '/verdaccio/conf/config.yaml' }])
      .withWaitStrategy(Wait.forListeningPorts())
      .start();

    const registryPort = verdaccio.getMappedPort(4873);
    const registryUrl = `http://localhost:${String(registryPort)}`;

    // 4. Publish plugin to Verdaccio (on host via mapped port)
    // Set auth token — Verdaccio accepts any token when publish: $all,
    // but npm CLI requires one to be configured
    console.log(`[e2e] Publishing plugin to Verdaccio at ${registryUrl}...`);
    const originalRegistry = process.env['npm_config_registry'];
    process.env['npm_config_registry'] = registryUrl;
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
      // Clean up auth token and restore registry
      execSync(
        `npm config delete //localhost:${String(registryPort)}/:_authToken --ws=false`,
        { stdio: 'ignore', windowsHide: true },
      );

      if (originalRegistry === undefined) {
        delete process.env['npm_config_registry'];
      } else {
        process.env['npm_config_registry'] = originalRegistry;
      }
    }

    // 5. Start workspace container and install plugin
    console.log('[e2e] Starting workspace container...');
    workspace = await workspaceImage
      .withNetwork(network)
      .withName('op-nx-polyrepo-e2e-workspace')
      .withCommand(['sleep', 'infinity'])
      .start();

    console.log('[e2e] Installing plugin in workspace container...');
    const installResult = await workspace.exec(
      ['npm', 'install', '-D', '@op-nx/polyrepo@e2e', '--registry', 'http://verdaccio:4873'],
      { workingDir: '/workspace' },
    );

    if (installResult.exitCode !== 0) {
      throw new Error(
        `Plugin install failed (exit ${String(installResult.exitCode)}):\n${installResult.stderr || installResult.output}`,
      );
    }

    // 6. Commit snapshot image
    console.log('[e2e] Committing workspace snapshot...');
    const snapshotImage = await workspace.commit({
      repo: 'op-nx-e2e-snapshot',
      tag: 'latest',
      deleteOnExit: true,
    });

    // 7. Provide to test files via Vitest inject()
    project.provide('snapshotImage', snapshotImage);

    // Stop the setup workspace (tests use snapshot, not this container)
    console.log('[e2e] Stopping setup workspace container...');
    await workspace.stop();
    workspace = undefined;

    console.log('[e2e] Global setup complete.');

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
