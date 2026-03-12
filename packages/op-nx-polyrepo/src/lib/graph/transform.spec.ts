import { describe, it, expect } from 'vitest';
import type { TargetConfiguration } from '@nx/devkit';
import { transformGraphForRepo } from './transform';
import type { ExternalGraphJson, TransformedNode } from './types';

/**
 * Fixture representing a typical external graph with 2 projects,
 * various targets, dependencies, and tags.
 */
function makeFixtureGraph(): ExternalGraphJson {
  return {
    graph: {
      nodes: {
        'my-lib': {
          name: 'my-lib',
          type: 'lib',
          data: {
            root: 'libs/my-lib',
            sourceRoot: 'libs/my-lib/src',
            projectType: 'library',
            targets: {
              build: {
                executor: '@nx/js:tsc',
                inputs: ['production', '^production'],
                outputs: ['{options.outputPath}'],
                cache: true,
                dependsOn: ['^build'],
                configurations: {
                  production: { optimization: true },
                },
                parallelism: true,
                metadata: { technologies: ['typescript'] },
              },
              test: {
                executor: '@nx/vite:test',
                inputs: ['default', '^production'],
                outputs: ['{projectRoot}/coverage'],
                cache: true,
              },
              lint: {
                executor: '@nx/eslint:lint',
                inputs: ['default'],
                outputs: ['{options.outputFile}'],
              },
            },
            tags: ['scope:shared', 'type:util'],
            metadata: { description: 'Shared utility library' },
          },
        },
        'my-app': {
          name: 'my-app',
          type: 'app',
          data: {
            root: 'apps/my-app',
            sourceRoot: 'apps/my-app/src',
            projectType: 'application',
            targets: {
              build: {
                executor: '@nx/webpack:webpack',
                inputs: ['production', '^production'],
                outputs: ['{options.outputPath}'],
                cache: true,
                dependsOn: ['^build', 'generate-api'],
              },
              serve: {
                executor: '@nx/webpack:dev-server',
              },
              'generate-api': {
                executor: 'nx:run-commands',
                cache: false,
              },
            },
            tags: ['scope:app'],
            metadata: { description: 'Main application' },
          },
        },
      },
      dependencies: {
        'my-lib': [],
        'my-app': [
          { source: 'my-app', target: 'my-lib', type: 'static' },
        ],
      },
    },
  };
}

/**
 * Get a node from the result, throwing if not found.
 * Avoids "possibly undefined" errors when indexing Records in strict mode.
 */
function getNode(
  nodes: Record<string, TransformedNode>,
  key: string,
): TransformedNode {
  const node = nodes[key];

  if (!node) {
    throw new Error(`Expected node "${key}" not found in result`);
  }

  return node;
}

/**
 * Get a target from a node, throwing if not found.
 */
function getTarget(
  targets: Record<string, TargetConfiguration>,
  key: string,
): TargetConfiguration {
  const target = targets[key];

  if (!target) {
    throw new Error(`Expected target "${key}" not found in node`);
  }

  return target;
}

describe('transformGraphForRepo', () => {
  const repoAlias = 'repo-b';
  const workspaceRoot = '/workspace';

  describe('project name namespacing', () => {
    it('prefixes project names with repoAlias/ separator', () => {
      const graph = makeFixtureGraph();
      const result = transformGraphForRepo(repoAlias, graph, workspaceRoot);

      expect(result.nodes['repo-b/my-lib']).toBeDefined();
      expect(result.nodes['repo-b/my-app']).toBeDefined();
      expect(result.nodes['my-lib']).toBeUndefined();
      expect(result.nodes['my-app']).toBeUndefined();
    });

    it('sets name property to namespaced name', () => {
      const graph = makeFixtureGraph();
      const result = transformGraphForRepo(repoAlias, graph, workspaceRoot);

      expect(getNode(result.nodes, 'repo-b/my-lib').name).toBe('repo-b/my-lib');
      expect(getNode(result.nodes, 'repo-b/my-app').name).toBe('repo-b/my-app');
    });
  });

  describe('path rewriting', () => {
    it('rewrites project root to .repos/<alias>/<original-root>', () => {
      const graph = makeFixtureGraph();
      const result = transformGraphForRepo(repoAlias, graph, workspaceRoot);

      expect(getNode(result.nodes, 'repo-b/my-lib').root).toBe(
        '.repos/repo-b/libs/my-lib',
      );
      expect(getNode(result.nodes, 'repo-b/my-app').root).toBe(
        '.repos/repo-b/apps/my-app',
      );
    });

    it('rewrites sourceRoot similarly', () => {
      const graph = makeFixtureGraph();
      const result = transformGraphForRepo(repoAlias, graph, workspaceRoot);

      expect(getNode(result.nodes, 'repo-b/my-lib').sourceRoot).toBe(
        '.repos/repo-b/libs/my-lib/src',
      );
    });

    it('handles missing sourceRoot (undefined stays undefined)', () => {
      const graph = makeFixtureGraph();
      const myLib = graph.graph.nodes['my-lib'];

      if (!myLib) {
        throw new Error('Expected my-lib node in fixture');
      }

      delete myLib.data.sourceRoot;

      const result = transformGraphForRepo(repoAlias, graph, workspaceRoot);

      expect(getNode(result.nodes, 'repo-b/my-lib').sourceRoot).toBeUndefined();
    });

    it('all paths use forward slashes (no backslashes)', () => {
      const graph: ExternalGraphJson = {
        graph: {
          nodes: {
            'win-lib': {
              name: 'win-lib',
              type: 'lib',
              data: {
                root: 'libs\\win-lib',
                sourceRoot: 'libs\\win-lib\\src',
              },
            },
          },
          dependencies: {},
        },
      };

      const result = transformGraphForRepo(repoAlias, graph, workspaceRoot);
      const node = getNode(result.nodes, 'repo-b/win-lib');

      expect(node.root).not.toContain('\\');
      expect(node.sourceRoot).not.toContain('\\');
      expect(node.root).toBe(
        '.repos/repo-b/libs/win-lib',
      );
    });
  });

  describe('projectType and metadata preservation', () => {
    it('preserves projectType from node data', () => {
      const graph = makeFixtureGraph();
      const result = transformGraphForRepo(repoAlias, graph, workspaceRoot);

      expect(getNode(result.nodes, 'repo-b/my-lib').projectType).toBe('library');
      expect(getNode(result.nodes, 'repo-b/my-app').projectType).toBe('application');
    });

    it('falls back to node.type when projectType is missing', () => {
      const graph = makeFixtureGraph();
      const myLib = graph.graph.nodes['my-lib'];

      if (!myLib) {
        throw new Error('Expected my-lib node in fixture');
      }

      delete myLib.data.projectType;

      const result = transformGraphForRepo(repoAlias, graph, workspaceRoot);

      expect(getNode(result.nodes, 'repo-b/my-lib').projectType).toBe('lib');
    });

    it('preserves metadata from original node', () => {
      const graph = makeFixtureGraph();
      const result = transformGraphForRepo(repoAlias, graph, workspaceRoot);

      expect(getNode(result.nodes, 'repo-b/my-lib').metadata).toEqual({
        description: 'Shared utility library',
      });
    });
  });

  describe('tag injection', () => {
    it('preserves existing tags and appends polyrepo:external + polyrepo:<alias>', () => {
      const graph = makeFixtureGraph();
      const result = transformGraphForRepo(repoAlias, graph, workspaceRoot);

      const tags = getNode(result.nodes, 'repo-b/my-lib').tags;

      expect(tags).toContain('scope:shared');
      expect(tags).toContain('type:util');
      expect(tags).toContain('polyrepo:external');
      expect(tags).toContain('polyrepo:repo-b');
    });

    it('handles project with no tags (empty array, still gets auto-tags)', () => {
      const graph: ExternalGraphJson = {
        graph: {
          nodes: {
            'no-tags': {
              name: 'no-tags',
              type: 'lib',
              data: { root: 'libs/no-tags' },
            },
          },
          dependencies: {},
        },
      };

      const result = transformGraphForRepo(repoAlias, graph, workspaceRoot);

      expect(getNode(result.nodes, 'repo-b/no-tags').tags).toEqual([
        'polyrepo:external',
        'polyrepo:repo-b',
      ]);
    });
  });

  describe('target rewriting', () => {
    it('rewrites each target to use @op-nx/polyrepo:run executor', () => {
      const graph = makeFixtureGraph();
      const result = transformGraphForRepo(repoAlias, graph, workspaceRoot);
      const targets = getNode(result.nodes, 'repo-b/my-lib').targets;

      expect(getTarget(targets, 'build').executor).toBe('@op-nx/polyrepo:run');
      expect(getTarget(targets, 'test').executor).toBe('@op-nx/polyrepo:run');
      expect(getTarget(targets, 'lint').executor).toBe('@op-nx/polyrepo:run');
    });

    it('sets options with repoAlias, originalProject, targetName', () => {
      const graph = makeFixtureGraph();
      const result = transformGraphForRepo(repoAlias, graph, workspaceRoot);
      const buildTarget = getTarget(getNode(result.nodes, 'repo-b/my-lib').targets, 'build');

      expect(buildTarget.options).toEqual({
        repoAlias: 'repo-b',
        originalProject: 'my-lib',
        targetName: 'build',
      });
    });

    it('sets inputs to empty array (prevents native hasher from resolving external files)', () => {
      const graph = makeFixtureGraph();
      const result = transformGraphForRepo(repoAlias, graph, workspaceRoot);
      const buildTarget = getTarget(getNode(result.nodes, 'repo-b/my-lib').targets, 'build');

      expect(buildTarget.inputs).toEqual([]);
    });

    it('omits outputs from proxy target (child repo manages its own outputs)', () => {
      const graph = makeFixtureGraph();
      const result = transformGraphForRepo(repoAlias, graph, workspaceRoot);
      const testTarget = getTarget(getNode(result.nodes, 'repo-b/my-lib').targets, 'test');

      expect(testTarget.outputs).toBeUndefined();
    });

    it('sets cache to false on proxy targets (child repo handles caching)', () => {
      const graph = makeFixtureGraph();
      const result = transformGraphForRepo(repoAlias, graph, workspaceRoot);

      expect(getTarget(getNode(result.nodes, 'repo-b/my-lib').targets, 'build').cache).toBe(false);
    });

    it('copies parallelism from original target', () => {
      const graph = makeFixtureGraph();
      const result = transformGraphForRepo(repoAlias, graph, workspaceRoot);

      expect(
        getTarget(getNode(result.nodes, 'repo-b/my-lib').targets, 'build').parallelism,
      ).toBe(true);
    });

    it('copies metadata from original target', () => {
      const graph = makeFixtureGraph();
      const result = transformGraphForRepo(repoAlias, graph, workspaceRoot);

      expect(
        getTarget(getNode(result.nodes, 'repo-b/my-lib').targets, 'build').metadata,
      ).toEqual({ technologies: ['typescript'] });
    });

    it('copies configurations from original target', () => {
      const graph = makeFixtureGraph();
      const result = transformGraphForRepo(repoAlias, graph, workspaceRoot);
      const buildTarget = getTarget(getNode(result.nodes, 'repo-b/my-lib').targets, 'build');

      expect(buildTarget.configurations).toEqual({
        production: { optimization: true },
      });
    });

    it('handles project with no targets (empty targets object)', () => {
      const graph: ExternalGraphJson = {
        graph: {
          nodes: {
            'no-targets': {
              name: 'no-targets',
              type: 'lib',
              data: { root: 'libs/no-targets' },
            },
          },
          dependencies: {},
        },
      };

      const result = transformGraphForRepo(repoAlias, graph, workspaceRoot);

      expect(getNode(result.nodes, 'repo-b/no-targets').targets).toEqual({});
    });
  });

  describe('dependsOn omission', () => {
    it('omits dependsOn from proxy targets (child repo handles its own task graph)', () => {
      const graph = makeFixtureGraph();
      const result = transformGraphForRepo(repoAlias, graph, workspaceRoot);

      // my-lib:build originally had dependsOn: ['^build']
      expect(
        getTarget(getNode(result.nodes, 'repo-b/my-lib').targets, 'build').dependsOn,
      ).toBeUndefined();

      // my-app:build originally had dependsOn: ['^build', 'generate-api']
      expect(
        getTarget(getNode(result.nodes, 'repo-b/my-app').targets, 'build').dependsOn,
      ).toBeUndefined();
    });

    it('omits dependsOn even when original has object entries with projects', () => {
      const graph: ExternalGraphJson = {
        graph: {
          nodes: {
            'lib-a': {
              name: 'lib-a',
              type: 'lib',
              data: {
                root: 'libs/lib-a',
                targets: {
                  build: {
                    executor: '@nx/js:tsc',
                    dependsOn: [
                      {
                        projects: ['lib-b', 'lib-c'],
                        target: 'build',
                      },
                    ],
                  },
                },
              },
            },
          },
          dependencies: {},
        },
      };

      const result = transformGraphForRepo(repoAlias, graph, workspaceRoot);

      expect(
        getTarget(getNode(result.nodes, 'repo-b/lib-a').targets, 'build').dependsOn,
      ).toBeUndefined();
    });
  });

  describe('dependency transformation', () => {
    it('transforms dependencies: both source and target get prefixed', () => {
      const graph = makeFixtureGraph();
      const result = transformGraphForRepo(repoAlias, graph, workspaceRoot);

      expect(result.dependencies).toContainEqual({
        source: 'repo-b/my-app',
        target: 'repo-b/my-lib',
        type: 'static',
      });
    });

    it('dependencies use string type value (passed through)', () => {
      const graph = makeFixtureGraph();
      const result = transformGraphForRepo(repoAlias, graph, workspaceRoot);
      const dep = result.dependencies.find(
        (d) => d.source === 'repo-b/my-app',
      );

      expect(typeof dep?.type).toBe('string');
      expect(dep?.type).toBe('static');
    });

    it('handles project with no dependencies (empty array)', () => {
      const graph: ExternalGraphJson = {
        graph: {
          nodes: {
            'isolated-lib': {
              name: 'isolated-lib',
              type: 'lib',
              data: { root: 'libs/isolated-lib' },
            },
          },
          dependencies: {
            'isolated-lib': [],
          },
        },
      };

      const result = transformGraphForRepo(repoAlias, graph, workspaceRoot);

      expect(result.dependencies).toEqual([]);
    });

    it('handles missing dependencies key for a project', () => {
      const graph: ExternalGraphJson = {
        graph: {
          nodes: {
            'no-deps': {
              name: 'no-deps',
              type: 'lib',
              data: { root: 'libs/no-deps' },
            },
          },
          dependencies: {},
        },
      };

      const result = transformGraphForRepo(repoAlias, graph, workspaceRoot);

      expect(result.dependencies).toEqual([]);
    });
  });
});
