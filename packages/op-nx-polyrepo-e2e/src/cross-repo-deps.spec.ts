import { describe, it, expect, beforeAll, afterAll, inject } from 'vitest';
import { type StartedTestContainer } from 'testcontainers';

import {
  startContainer,
  nxVersion,
  getProjectGraph,
  writeNxJson,
} from './setup/container.js';

describe('cross-repo dependencies', () => {
  let container: StartedTestContainer;
  const hostProject = '@workspace/source';

  beforeAll(async () => {
    container = await startContainer(inject('snapshotImage'), 'cross-repo-deps');
  });

  afterAll(async () => {
    await container.stop();
  });

  it('should auto-detect cross-repo edges from package.json dependencies', async () => {
    expect.hasAssertions();

    // Write nx.json with repos config only (no overrides).
    // Repos are already synced from the pre-synced snapshot.
    await writeNxJson(container, {
      repos: {
        nx: { url: 'file:///repos/nx', depth: 1, ref: nxVersion },
      },
    });

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

    // Write base config (repos already synced from snapshot)
    await writeNxJson(container, {
      repos: {
        nx: { url: 'file:///repos/nx', depth: 1, ref: nxVersion },
      },
    });

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
