import { createRequire } from 'node:module';

import { GenericContainer, type StartedTestContainer } from 'testcontainers';

import './provided-context.js';

const require = createRequire(import.meta.url);
export const nxVersion: string = require('nx/package.json').version;

/**
 * Start a test container from the snapshot image. The snapshot includes
 * node_modules and a warm graph cache — no npm install restore needed.
 *
 * Forwards the host's `NX_DAEMON` env var to the container so the CI
 * matrix can run e2e tests under both daemon modes. When `NX_DAEMON`
 * is unset on the host, the container uses the Nx default (daemon enabled).
 */
export async function startContainer(snapshotImage: string, name: string): Promise<StartedTestContainer> {
  let container = new GenericContainer(snapshotImage)
    .withName(`op-nx-polyrepo-e2e-${name}`)
    .withCommand(['sleep', 'infinity']);

  // Forward NX_DAEMON from host environment to container.
  // If unset, container uses Nx default (daemon enabled).
  const nxDaemon = process.env['NX_DAEMON'];

  if (nxDaemon !== undefined) {
    container = container.withEnvironment({ NX_DAEMON: nxDaemon });
  }

  return container.start();
}

/**
 * Run `nx graph --print` inside the container and parse the project graph JSON.
 */
export async function getProjectGraph(ctr: StartedTestContainer): Promise<{
  nodes: Record<string, unknown>;
  dependencies: Record<string, Array<{ source: string; target: string; type: string }>>;
}> {
  const result = await ctr.exec(
    ['npx', 'nx', 'graph', '--print', '--output-style=static'],
    { workingDir: '/workspace' },
  );

  if (result.exitCode !== 0) {
    throw new Error(
      `nx graph --print failed (exit ${String(result.exitCode)}):\n${result.output}`,
    );
  }

  const jsonStart = result.stdout.indexOf('{');

  if (jsonStart === -1) {
    throw new Error(
      `No JSON found in nx graph output:\n${result.stdout}`,
    );
  }

  const parsed: {
    graph: {
      nodes: Record<string, unknown>;
      dependencies: Record<string, Array<{ source: string; target: string; type: string }>>;
    };
  } = JSON.parse(result.stdout.substring(jsonStart));

  return parsed.graph;
}

/**
 * Write nx.json with the given plugin options inside the container.
 */
export async function writeNxJson(
  ctr: StartedTestContainer,
  pluginOptions: Record<string, unknown>,
): Promise<void> {
  const nxJsonContent = JSON.stringify(
    { plugins: [{ plugin: '@op-nx/polyrepo', options: pluginOptions }] },
    null,
    2,
  );

  const { exitCode, output } = await ctr.exec(
    [
      'sh',
      '-c',
      `cat > /workspace/nx.json << 'NXJSONEOF'\n${nxJsonContent}\nNXJSONEOF`,
    ],
    { workingDir: '/workspace' },
  );

  if (exitCode !== 0) {
    throw new Error(`Failed to write nx.json: ${output}`);
  }

  // Stop the daemon so the next graph call picks up the new config.
  // The daemon caches the project graph in memory; file watchers inside
  // Docker containers may not detect nx.json changes reliably (overlayfs
  // + inotify race). Stopping ensures a fresh daemon reads the new config.
  await ctr.exec(['npx', 'nx', 'daemon', '--stop'], {
    workingDir: '/workspace',
  });
}
