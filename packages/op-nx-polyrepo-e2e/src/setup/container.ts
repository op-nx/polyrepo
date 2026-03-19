import { createRequire } from 'node:module';

import { GenericContainer, type StartedTestContainer } from 'testcontainers';

import './provided-context.js';

const require = createRequire(import.meta.url);
export const nxVersion: string = require('nx/package.json').version;

/**
 * Start a test container from the pre-synced snapshot image.
 * Restores node_modules from the warm npm cache — the snapshot has
 * ~/.npm/_cacache/ but node_modules is deleted before commit to keep
 * the overlay2 diff small (30K fewer files = minutes faster commit).
 */
export async function startContainer(snapshotImage: string, name: string): Promise<StartedTestContainer> {
  const ctr = await new GenericContainer(snapshotImage)
    .withName(`op-nx-polyrepo-e2e-${name}`)
    .withCommand(['sleep', 'infinity'])
    .start();

  const result = await ctr.exec(
    ['npm', 'install', '--prefer-offline', '--no-audit'],
    { workingDir: '/workspace' },
  );

  if (result.exitCode !== 0) {
    throw new Error(
      `npm install failed in ${name}: ${result.stderr || result.output}`,
    );
  }

  return ctr;
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
}
