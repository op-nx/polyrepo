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
    // Shared state discovered during auto-detection test, reused by override/negation tests
    let autoDetectedTarget: string;
    let nonAutoDetectedNxProject: string;

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

    it('should auto-detect cross-repo edges from package.json dependencies', async () => {
      expect.hasAssertions();

      // Write nx.json with repos config only (no overrides)
      await writeNxJson(container, {
        repos: {
          nx: { url: 'file:///repos/nx', depth: 1, ref: nxVersion },
        },
      });

      const graph = await getProjectGraph(container);

      // Find cross-repo edges from @workspace/source to nx/* projects
      const sourceEdges = graph.dependencies['@workspace/source'] ?? [];
      const crossRepoEdges = sourceEdges.filter(
        (edge) => edge.target.startsWith('nx/') && edge.type === 'static',
      );

      // The host workspace has @nx/* devDependencies (devkit, js, vitest, etc.)
      // which should produce auto-detected static edges to namespaced nx/* projects
      expect(crossRepoEdges.length).toBeGreaterThan(0);

      // Store one auto-detected target for the negation test
      autoDetectedTarget = crossRepoEdges[0].target;

      // Discover an nx/* project that is NOT in the auto-detected edges
      // (for the override test -- pick one that @workspace/source does NOT depend on)
      const allNxProjectNames = Object.keys(graph.nodes).filter(
        (name) => name.startsWith('nx/'),
      );
      const autoDetectedTargets = new Set(
        crossRepoEdges.map((edge) => edge.target),
      );

      const candidateProject = allNxProjectNames.find(
        (name) => !autoDetectedTargets.has(name),
      );

      // nrwl/nx has 100+ projects but only ~10 @nx/* packages are host deps,
      // so there are always non-auto-detected projects available
      expect(candidateProject).toBeDefined();

      nonAutoDetectedNxProject = candidateProject ?? '';
    }, 120_000);

    it('should include explicit override edges in the graph', async () => {
      expect.assertions(2);

      // Configure an explicit override from @workspace/source to an nx/* project
      // that has no auto-detected edge (discovered in previous test)
      await writeNxJson(container, {
        repos: {
          nx: { url: 'file:///repos/nx', depth: 1, ref: nxVersion },
        },
        implicitDependencies: {
          '@workspace/source': [nonAutoDetectedNxProject],
        },
      });

      const graph = await getProjectGraph(container);

      const sourceEdges = graph.dependencies['@workspace/source'] ?? [];
      const overrideEdge = sourceEdges.find(
        (edge) => edge.target === nonAutoDetectedNxProject,
      );

      expect(overrideEdge).toBeDefined();
      expect(overrideEdge?.type).toBe('implicit');
    }, 120_000);

    it('should suppress negated auto-detected edges', async () => {
      expect.assertions(1);

      // Configure a negation on the auto-detected edge discovered in the first test
      await writeNxJson(container, {
        repos: {
          nx: { url: 'file:///repos/nx', depth: 1, ref: nxVersion },
        },
        implicitDependencies: {
          '@workspace/source': [`!${autoDetectedTarget}`],
        },
      });

      const graph = await getProjectGraph(container);

      const sourceEdges = graph.dependencies['@workspace/source'] ?? [];
      const suppressedEdge = sourceEdges.find(
        (edge) => edge.target === autoDetectedTarget,
      );

      // The negated edge should be absent from the graph
      expect(suppressedEdge).toBeUndefined();
    }, 120_000);
  });
});
