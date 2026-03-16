import { describe, it, expect, beforeAll, afterAll, inject } from 'vitest';
import {
  GenericContainer,
  type StartedTestContainer,
} from 'testcontainers';

import './setup/provided-context.js';

describe('@op-nx/polyrepo', () => {
  let container: StartedTestContainer;

  beforeAll(async () => {
    const snapshotImage = inject('snapshotImage');
    container = await new GenericContainer(snapshotImage)
      .withCommand(['sleep', 'infinity'])
      .start();
  });

  afterAll(async () => {
    await container.stop();
  });

  it('should be installed', async () => {
    expect.assertions(1);

    const { exitCode } = await container.exec(
      ['npm', 'ls', '@op-nx/polyrepo'],
      { workingDir: '/workspace' },
    );

    expect(exitCode).toBe(0);
  });

  describe('polyrepo-status', () => {
    beforeAll(async () => {
      // Register plugin in nx.json using local /repos/nx path (prebaked in Docker image)
      const nxJsonContent = JSON.stringify(
        {
          plugins: [
            {
              plugin: '@op-nx/polyrepo',
              options: {
                repos: {
                  nx: { url: 'file:///repos/nx', depth: 1, ref: 'master' },
                },
              },
            },
          ],
        },
        null,
        2,
      );

      const { exitCode, output } = await container.exec(
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
    });

    it('should report unsynced repos', async () => {
      expect.assertions(2);

      const { stdout } = await container.exec(
        ['npx', 'nx', 'polyrepo-status'],
        { workingDir: '/workspace' },
      );

      expect(stdout).toContain('[not synced]');
      expect(stdout).toContain('1 configured, 0 synced, 1 not synced');
    });

    it('should register target on root project', async () => {
      expect.assertions(2);

      const { stdout } = await container.exec(
        ['npx', 'nx', 'show', 'project', '@workspace/source', '--json'],
        { workingDir: '/workspace' },
      );

      // Extract JSON object from stdout (strip Nx warnings before/after)
      const jsonMatch = /\{[\s\S]*\}/.exec(stdout);
      const project = JSON.parse(jsonMatch?.[0] ?? '{}');

      expect(project.targets['polyrepo-status']).toBeDefined();
      expect(project.targets['polyrepo-status'].executor).toBe(
        '@op-nx/polyrepo:status',
      );
    });

    it('should show project counts after sync', async () => {
      expect.assertions(2);

      // Run sync -- clones from file:///repos/nx to /workspace/.repos/nx/
      // and extracts graph cache
      const syncResult = await container.exec(
        ['npx', 'nx', 'polyrepo-sync'],
        { workingDir: '/workspace' },
      );

      if (syncResult.exitCode !== 0) {
        throw new Error(`Sync failed: ${syncResult.output}`);
      }

      // Run status -- should now show project counts from cached graph
      const statusResult = await container.exec(
        ['npx', 'nx', 'polyrepo-status'],
        { workingDir: '/workspace' },
      );

      expect(statusResult.stdout).toContain('projects');
      expect(statusResult.stdout).not.toContain('[not synced]');
    }, 120_000);
  });
});
