import { createRequire } from 'node:module';

import { describe, it, expect, beforeAll, afterAll, inject } from 'vitest';
import {
  GenericContainer,
  type StartedTestContainer,
} from 'testcontainers';

import './setup/provided-context.js';

const require = createRequire(import.meta.url);
const nxVersion: string = require('nx/package.json').version;

describe('@op-nx/polyrepo', () => {
  let container: StartedTestContainer;

  beforeAll(async () => {
    const snapshotImage = inject('snapshotImage');
    container = await new GenericContainer(snapshotImage)
      // tmpfs for .repos/ eliminates OverlayFS copy-up overhead during
      // pnpm install linking (130s on overlay2 → 37s on tmpfs)
      .withTmpFs({ '/workspace/.repos': 'rw,exec,size=4g' })
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
                  nx: { url: 'file:///repos/nx', depth: 1, ref: nxVersion },
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
      expect.assertions(3);

      // Run sync -- clones from file:///repos/nx to /workspace/.repos/nx/
      // and extracts graph cache
      const syncResult = await container.exec(
        ['npx', 'nx', 'polyrepo-sync'],
        { workingDir: '/workspace' },
      );

      expect(syncResult.exitCode).toBe(0);

      // Run status -- should now show project counts from cached graph
      const statusResult = await container.exec(
        ['npx', 'nx', 'polyrepo-status'],
        { workingDir: '/workspace' },
      );

      expect(statusResult.stdout).toContain('projects');
      expect(statusResult.stdout).not.toContain('[not synced]');
    }, 120_000);
  });

  describe('cross-repo dependencies', () => {
    // The workspace root project created by create-nx-workspace
    const hostProject = '@workspace/source';

    /**
     * Run polyrepo-sync inside the container to clone repos into .repos/.
     */
    async function syncRepos(ctr: StartedTestContainer): Promise<void> {
      const result = await ctr.exec(
        ['npx', 'nx', 'polyrepo-sync'],
        { workingDir: '/workspace' },
      );

      if (result.exitCode !== 0) {
        throw new Error(
          `polyrepo-sync failed (exit ${String(result.exitCode)}):\n${result.output}`,
        );
      }
    }

    /**
     * Run `nx graph --print` inside the container and parse the project graph JSON.
     */
    async function getProjectGraph(ctr: StartedTestContainer): Promise<{
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
    async function writeNxJson(
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

    // NOTE: Auto-detection of package.json deps is thoroughly tested at the
    // unit level (36+ tests in detect.spec.ts). E2e auto-detect is skipped
    // because the nrwl/nx repo's registered projects are example apps without
    // packageName fields matching the host's dependencies.

    it('should include explicit override edges in the graph', async () => {
      expect.assertions(2);

      await writeNxJson(container, {
        repos: {
          nx: { url: 'file:///repos/nx', depth: 1, ref: nxVersion },
        },
      });

      await syncRepos(container);

      // Discover an nx/* project to use as override target
      const preGraph = await getProjectGraph(container);
      const overrideTarget = Object.keys(preGraph.nodes).find(
        (name) => name.startsWith('nx/'),
      );

      if (!overrideTarget) {
        throw new Error('No nx/* project found for override test');
      }

      await writeNxJson(container, {
        repos: {
          nx: { url: 'file:///repos/nx', depth: 1, ref: nxVersion },
        },
        implicitDependencies: {
          [hostProject]: [overrideTarget],
        },
      });

      const graph = await getProjectGraph(container);

      const sourceEdges = graph.dependencies[hostProject] ?? [];
      const overrideEdge = sourceEdges.find(
        (edge) => edge.target === overrideTarget,
      );

      expect(overrideEdge).toBeDefined();
      expect(overrideEdge?.type).toBe('implicit');
    }, 120_000);

    // NOTE: Negation suppression is thoroughly tested at the unit level
    // (detect.spec.ts). Negation only affects auto-detected edges, which
    // require packageName-matched projects that the nrwl/nx e2e fixture
    // doesn't produce. Override + negation are independent operations:
    // [target, !target] adds an override edge AND suppresses auto-detection
    // (not a cancellation).
  });
});
