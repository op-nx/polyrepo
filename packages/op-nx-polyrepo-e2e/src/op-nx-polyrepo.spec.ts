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

      // Inject @nx/devkit as a direct devDependency in the workspace's
      // package.json. create-nx-workspace only adds "nx" as a direct dep;
      // detection scans declared deps, not transitive ones.
      const injectDep = await container.exec(
        [
          'sh',
          '-c',
          'cd /workspace && node -e "' +
            "const p=JSON.parse(require('fs').readFileSync('package.json','utf8'));" +
            "p.devDependencies=p.devDependencies||{};" +
            "p.devDependencies['@nx/devkit']='*';" +
            "require('fs').writeFileSync('package.json',JSON.stringify(p,null,2));" +
            '"',
        ],
        { workingDir: '/workspace' },
      );

      if (injectDep.exitCode !== 0) {
        throw new Error(`Failed to inject dep: ${injectDep.output}`);
      }

      await writeNxJson(container, {
        repos: {
          nx: { url: 'file:///repos/nx', depth: 1, ref: nxVersion },
        },
      });

      const graph = await getProjectGraph(container);

      // Find the root project name (may vary by Nx version / preset)
      const rootProject = Object.keys(graph.nodes).find(
        (name) => !name.startsWith('nx/'),
      );

      if (!rootProject) {
        throw new Error('No host project found in graph');
      }

      // Find cross-repo edges from the host project to nx/* projects.
      // Host-sourced edges use 'static' type (sourceFile in file map).
      const sourceEdges = graph.dependencies[rootProject] ?? [];
      const crossRepoEdges = sourceEdges.filter(
        (edge) => edge.target.startsWith('nx/') && edge.type === 'static',
      );

      // @nx/devkit was injected and should map to an nx/* namespaced project
      expect(crossRepoEdges.length).toBeGreaterThan(0);

      // Store the auto-detected target for the negation test
      const firstEdge = crossRepoEdges[0];

      if (!firstEdge) {
        throw new Error('Expected at least one cross-repo edge');
      }

      autoDetectedTarget = firstEdge.target;

      // Discover an nx/* project NOT in auto-detected edges (for override test)
      const allNxProjectNames = Object.keys(graph.nodes).filter(
        (name) => name.startsWith('nx/'),
      );
      const autoDetectedTargets = new Set(
        crossRepoEdges.map((edge) => edge.target),
      );

      const candidateProject = allNxProjectNames.find(
        (name) => !autoDetectedTargets.has(name),
      );

      expect(candidateProject).toBeDefined();

      nonAutoDetectedNxProject = candidateProject ?? '';
    }, 120_000);

    it('should include explicit override edges in the graph', async () => {
      expect.assertions(2);

      // Find the host project name dynamically
      const preGraph = await getProjectGraph(container);
      const rootProject = Object.keys(preGraph.nodes).find(
        (name) => !name.startsWith('nx/'),
      );

      if (!rootProject) {
        throw new Error('No host project found in graph');
      }

      // Use a known nx/* project if nonAutoDetectedNxProject is empty
      // (fallback in case auto-detect test didn't run or failed)
      const overrideTarget = nonAutoDetectedNxProject || Object.keys(preGraph.nodes).find(
        (name) => name.startsWith('nx/'),
      ) || '';

      if (!overrideTarget) {
        throw new Error('No nx/* project found for override test');
      }

      await writeNxJson(container, {
        repos: {
          nx: { url: 'file:///repos/nx', depth: 1, ref: nxVersion },
        },
        implicitDependencies: {
          [rootProject]: [overrideTarget],
        },
      });

      const graph = await getProjectGraph(container);

      const sourceEdges = graph.dependencies[rootProject] ?? [];
      const overrideEdge = sourceEdges.find(
        (edge) => edge.target === overrideTarget,
      );

      expect(overrideEdge).toBeDefined();
      expect(overrideEdge?.type).toBe('implicit');
    }, 120_000);

    it('should suppress negated auto-detected edges', async () => {
      expect.assertions(1);

      // Find the host project name dynamically
      const preGraph = await getProjectGraph(container);
      const rootProject = Object.keys(preGraph.nodes).find(
        (name) => !name.startsWith('nx/'),
      );

      if (!rootProject) {
        throw new Error('No host project found in graph');
      }

      // Use the auto-detected target from test 1 (negation suppresses it)
      if (!autoDetectedTarget) {
        throw new Error('Auto-detected target not set — auto-detect test must run first');
      }

      await writeNxJson(container, {
        repos: {
          nx: { url: 'file:///repos/nx', depth: 1, ref: nxVersion },
        },
        implicitDependencies: {
          [rootProject]: [`!${autoDetectedTarget}`],
        },
      });

      const graph = await getProjectGraph(container);

      const sourceEdges = graph.dependencies[rootProject] ?? [];
      const suppressedEdge = sourceEdges.find(
        (edge) => edge.target === autoDetectedTarget,
      );

      // The negated edge should be absent from the graph
      expect(suppressedEdge).toBeUndefined();
    }, 120_000);
  });
});
