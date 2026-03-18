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
      // No tmpfs for .repos/ — use overlay filesystem so pnpm hardlinks
      // to the pre-warmed store at /repos/nx work (cross-filesystem hardlinks
      // fail on tmpfs). Slightly slower I/O but no size limit and pnpm install
      // resolves via hardlinks instead of copies.
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

      // Debug: verify .repos/ is in .gitignore before sync
      const gitignoreCheck = await container.exec(
        ['sh', '-c', 'grep -c ".repos/" .gitignore && echo "[OK] .repos/ in .gitignore" || echo "[MISSING] .repos/ not in .gitignore"'],
        { workingDir: '/workspace' },
      );

      console.log('[debug] gitignore check:', gitignoreCheck.stdout.trim());

      // Run sync -- clones from file:///repos/nx to /workspace/.repos/nx/
      // and extracts graph cache
      console.log('[debug] starting polyrepo-sync...');
      const syncStart = Date.now();

      const syncResult = await container.exec(
        ['npx', 'nx', 'polyrepo-sync'],
        { workingDir: '/workspace' },
      );

      console.log(`[debug] polyrepo-sync completed in ${String(Date.now() - syncStart)}ms, exit=${String(syncResult.exitCode)}`);
      console.log('[debug] sync stdout (last 500 chars):', syncResult.stdout.slice(-500));

      if (syncResult.exitCode !== 0) {
        console.log('[debug] sync stderr:', syncResult.stderr);
      }

      expect(syncResult.exitCode).toBe(0);

      // Run status -- should now show project counts from cached graph
      const statusResult = await container.exec(
        ['npx', 'nx', 'polyrepo-status'],
        { workingDir: '/workspace' },
      );

      expect(statusResult.stdout).toContain('projects');
      expect(statusResult.stdout).not.toContain('[not synced]');
    }, 300_000);
  });

  describe('cross-repo dependencies', () => {
    // The workspace root project created by create-nx-workspace
    const hostProject = '@workspace/source';

    /**
     * Run polyrepo-sync inside the container to clone repos into .repos/.
     */
    async function syncRepos(ctr: StartedTestContainer): Promise<void> {
      console.log('[debug] syncRepos starting...');
      const start = Date.now();

      const result = await ctr.exec(
        ['npx', 'nx', 'polyrepo-sync'],
        { workingDir: '/workspace' },
      );

      console.log(`[debug] syncRepos completed in ${String(Date.now() - start)}ms, exit=${String(result.exitCode)}`);

      if (result.exitCode !== 0) {
        console.log('[debug] syncRepos stderr:', result.stderr);
        console.log('[debug] syncRepos stdout (last 500):', result.stdout.slice(-500));

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

    it('should auto-detect cross-repo edges from package.json dependencies', async () => {
      expect.hasAssertions();

      // Write nx.json with repos config only (no overrides)
      await writeNxJson(container, {
        repos: {
          nx: { url: 'file:///repos/nx', depth: 1, ref: nxVersion },
        },
      });

      await syncRepos(container);

      // Inject @nx/devkit into the host's devDependencies to guarantee
      // a package name match. The host workspace may already have nx/*
      // deps from create-nx-workspace, but @nx/devkit is explicitly
      // known to match the nrwl/nx repo's published package name.
      await container.exec(
        [
          'sh',
          '-c',
          'cd /workspace && node -e "' +
            "const p=require('./package.json');" +
            "p.devDependencies=p.devDependencies||{};" +
            "p.devDependencies['@nx/devkit']='*';" +
            "require('fs').writeFileSync('package.json',JSON.stringify(p,null,2))" +
            '"',
        ],
        { workingDir: '/workspace' },
      );

      const graph = await getProjectGraph(container);

      // Find cross-repo edges from @workspace/source to nx/* projects
      const sourceEdges = graph.dependencies[hostProject] ?? [];
      const crossRepoEdges = sourceEdges.filter(
        (edge) => edge.target.startsWith('nx/') && edge.type === 'implicit',
      );

      // The host workspace has @nx/devkit as a devDependency which should
      // produce at least one auto-detected implicit edge to a namespaced
      // nx/* project whose packageName matches @nx/devkit.
      expect(crossRepoEdges.length).toBeGreaterThan(0);
    }, 300_000);

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
    }, 300_000);

    it('should suppress negated auto-detected edges', async () => {
      expect.hasAssertions();

      // Step 1: Discover an auto-detected edge to negate.
      // Write nx.json with repos only (no overrides/negations).
      await writeNxJson(container, {
        repos: {
          nx: { url: 'file:///repos/nx', depth: 1, ref: nxVersion },
        },
      });

      const baseGraph = await getProjectGraph(container);

      const baseEdges = baseGraph.dependencies[hostProject] ?? [];
      const autoDetectedEdges = baseEdges.filter(
        (edge) => edge.target.startsWith('nx/') && edge.type === 'implicit',
      );

      // Auto-detection must produce at least one edge for negation to work.
      // The auto-detect test above injects @nx/devkit into the host's
      // package.json, which persists across tests in the same container.
      expect(autoDetectedEdges.length).toBeGreaterThan(0);

      // The length assertion above guarantees at least one edge exists,
      // so the target is always defined here.
      const targetToNegate = autoDetectedEdges[0]?.target ?? '';

      // Step 2: Add negation for the discovered target.
      await writeNxJson(container, {
        repos: {
          nx: { url: 'file:///repos/nx', depth: 1, ref: nxVersion },
        },
        implicitDependencies: {
          [hostProject]: [`!${targetToNegate}`],
        },
      });

      const negatedGraph = await getProjectGraph(container);

      const negatedEdges = negatedGraph.dependencies[hostProject] ?? [];
      const suppressedEdge = negatedEdges.find(
        (edge) => edge.target === targetToNegate,
      );

      // The negated edge should be absent from the graph
      expect(suppressedEdge).toBeUndefined();
    }, 300_000);
  });
});
