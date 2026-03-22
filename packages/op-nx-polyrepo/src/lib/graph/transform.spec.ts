import { describe, it, expect, expectTypeOf, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import type { TargetConfiguration } from '@nx/devkit';
import { transformGraphForRepo } from './transform';
import type { ExternalGraphJson, TransformedNode } from './types';

vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
}));

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
            metadata: {
              description: 'Shared utility library',
              js: { packageName: '@scope/my-lib' },
            },
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
            metadata: {
              description: 'Main application',
              js: { packageName: '@scope/my-app' },
            },
          },
        },
      },
      dependencies: {
        'my-lib': [],
        'my-app': [{ source: 'my-app', target: 'my-lib', type: 'static' }],
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

/**
 * Get a graph node from an ExternalGraphJson, throwing if not found.
 */
function getGraphNode(
  graph: ExternalGraphJson,
  key: string,
): ExternalGraphJson['graph']['nodes'][string] {
  const node = graph.graph.nodes[key];

  if (!node) {
    throw new Error(`Expected graph node "${key}" not found in fixture`);
  }

  return node;
}

describe(transformGraphForRepo, () => {
  const repoAlias = 'repo-b';
  const workspaceRoot = '/workspace';

  beforeEach(() => {
    vi.mocked(readFileSync).mockReturnValue('{}');
  });

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
      const myLib = getGraphNode(graph, 'my-lib');

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
      expect(node.root).toBe('.repos/repo-b/libs/win-lib');
    });
  });

  describe('projectType and metadata preservation', () => {
    it('preserves projectType from node data', () => {
      const graph = makeFixtureGraph();
      const result = transformGraphForRepo(repoAlias, graph, workspaceRoot);

      expect(getNode(result.nodes, 'repo-b/my-lib').projectType).toBe(
        'library',
      );
      expect(getNode(result.nodes, 'repo-b/my-app').projectType).toBe(
        'application',
      );
    });

    it('falls back to node.type when projectType is missing', () => {
      const graph = makeFixtureGraph();
      const myLib = getGraphNode(graph, 'my-lib');

      delete myLib.data.projectType;

      const result = transformGraphForRepo(repoAlias, graph, workspaceRoot);

      expect(getNode(result.nodes, 'repo-b/my-lib').projectType).toBe('lib');
    });

    it('preserves metadata from original node', () => {
      const graph = makeFixtureGraph();
      const result = transformGraphForRepo(repoAlias, graph, workspaceRoot);

      expect(getNode(result.nodes, 'repo-b/my-lib').metadata).toStrictEqual({
        description: 'Shared utility library',
        js: { packageName: '@scope/my-lib' },
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

      expect(getNode(result.nodes, 'repo-b/no-tags').tags).toStrictEqual([
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
      const buildTarget = getTarget(
        getNode(result.nodes, 'repo-b/my-lib').targets,
        'build',
      );

      expect(buildTarget.options).toStrictEqual({
        repoAlias: 'repo-b',
        originalProject: 'my-lib',
        targetName: 'build',
      });
    });

    it('sets inputs to empty array (prevents native hasher from resolving external files)', () => {
      const graph = makeFixtureGraph();
      const result = transformGraphForRepo(repoAlias, graph, workspaceRoot);
      const buildTarget = getTarget(
        getNode(result.nodes, 'repo-b/my-lib').targets,
        'build',
      );

      expect(buildTarget.inputs).toStrictEqual([]);
    });

    it('omits outputs from proxy target (child repo manages its own outputs)', () => {
      const graph = makeFixtureGraph();
      const result = transformGraphForRepo(repoAlias, graph, workspaceRoot);
      const testTarget = getTarget(
        getNode(result.nodes, 'repo-b/my-lib').targets,
        'test',
      );

      expect(testTarget.outputs).toBeUndefined();
    });

    it('sets cache to false on proxy targets (child repo handles caching)', () => {
      const graph = makeFixtureGraph();
      const result = transformGraphForRepo(repoAlias, graph, workspaceRoot);

      expect(
        getTarget(getNode(result.nodes, 'repo-b/my-lib').targets, 'build')
          .cache,
      ).toBe(false);
    });

    it('copies parallelism from original target', () => {
      const graph = makeFixtureGraph();
      const result = transformGraphForRepo(repoAlias, graph, workspaceRoot);

      expect(
        getTarget(getNode(result.nodes, 'repo-b/my-lib').targets, 'build')
          .parallelism,
      ).toBe(true);
    });

    it('copies metadata from original target', () => {
      const graph = makeFixtureGraph();
      const result = transformGraphForRepo(repoAlias, graph, workspaceRoot);

      expect(
        getTarget(getNode(result.nodes, 'repo-b/my-lib').targets, 'build')
          .metadata,
      ).toStrictEqual({ technologies: ['typescript'] });
    });

    it('copies configurations from original target', () => {
      const graph = makeFixtureGraph();
      const result = transformGraphForRepo(repoAlias, graph, workspaceRoot);
      const buildTarget = getTarget(
        getNode(result.nodes, 'repo-b/my-lib').targets,
        'build',
      );

      expect(buildTarget.configurations).toStrictEqual({
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

      expect(getNode(result.nodes, 'repo-b/no-targets').targets).toStrictEqual(
        {},
      );
    });
  });

  describe('dependsOn preservation', () => {
    it('preserves caret string dependsOn entries unchanged', () => {
      const graph = makeFixtureGraph();
      const result = transformGraphForRepo(repoAlias, graph, workspaceRoot);

      // my-lib:build originally had dependsOn: ['^build']
      const buildTarget = getTarget(
        getNode(result.nodes, 'repo-b/my-lib').targets,
        'build',
      );

      expect(buildTarget.dependsOn).toStrictEqual(['^build']);
    });

    it('preserves both caret and bare string dependsOn entries unchanged', () => {
      const graph = makeFixtureGraph();
      const result = transformGraphForRepo(repoAlias, graph, workspaceRoot);

      // my-app:build originally had dependsOn: ['^build', 'generate-api']
      const buildTarget = getTarget(
        getNode(result.nodes, 'repo-b/my-app').targets,
        'build',
      );

      expect(buildTarget.dependsOn).toStrictEqual(['^build', 'generate-api']);
    });

    it('sets dependsOn to empty array when absent from raw config (blocks targetDefaults merge)', () => {
      const graph = makeFixtureGraph();
      const result = transformGraphForRepo(repoAlias, graph, workspaceRoot);

      // my-lib:test has no dependsOn in fixture
      const testTarget = getTarget(
        getNode(result.nodes, 'repo-b/my-lib').targets,
        'test',
      );

      expect(testTarget.dependsOn).toStrictEqual([]);
    });

    it('namespaces project names in object dependsOn entries with projects array', () => {
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
      const buildTarget = getTarget(
        getNode(result.nodes, 'repo-b/lib-a').targets,
        'build',
      );

      expect(buildTarget.dependsOn).toStrictEqual([
        { projects: ['repo-b/lib-b', 'repo-b/lib-c'], target: 'build' },
      ]);
    });

    it('passes through object dependsOn entries with projects: "self" unchanged', () => {
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
                    dependsOn: [{ target: 'build', projects: 'self' }],
                  },
                },
              },
            },
          },
          dependencies: {},
        },
      };

      const result = transformGraphForRepo(repoAlias, graph, workspaceRoot);
      const buildTarget = getTarget(
        getNode(result.nodes, 'repo-b/lib-a').targets,
        'build',
      );

      expect(buildTarget.dependsOn).toStrictEqual([
        { target: 'build', projects: 'self' },
      ]);
    });

    it('passes through object dependsOn entries with projects: "dependencies" unchanged', () => {
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
                    dependsOn: [{ target: 'build', projects: 'dependencies' }],
                  },
                },
              },
            },
          },
          dependencies: {},
        },
      };

      const result = transformGraphForRepo(repoAlias, graph, workspaceRoot);
      const buildTarget = getTarget(
        getNode(result.nodes, 'repo-b/lib-a').targets,
        'build',
      );

      expect(buildTarget.dependsOn).toStrictEqual([
        { target: 'build', projects: 'dependencies' },
      ]);
    });

    it('passes through tag selectors in projects arrays unchanged', () => {
      const graph: ExternalGraphJson = {
        graph: {
          nodes: {
            'nx-source': {
              name: 'nx-source',
              type: 'lib',
              data: {
                root: 'packages/nx-source',
                targets: {
                  build: {
                    executor: '@nx/js:tsc',
                    dependsOn: [
                      { target: 'build', projects: ['tag:npm:public'] },
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
      const buildTarget = getTarget(
        getNode(result.nodes, 'repo-b/nx-source').targets,
        'build',
      );

      expect(buildTarget.dependsOn).toStrictEqual([
        { target: 'build', projects: ['tag:npm:public'] },
      ]);
    });

    it('treats non-array dependsOn value as absent and returns empty array', () => {
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
                    dependsOn: 'invalid-string-value',
                  },
                },
              },
            },
          },
          dependencies: {},
        },
      };

      const result = transformGraphForRepo(repoAlias, graph, workspaceRoot);
      const buildTarget = getTarget(
        getNode(result.nodes, 'repo-b/lib-a').targets,
        'build',
      );

      expect(buildTarget.dependsOn).toStrictEqual([]);
    });

    it('handles mixed array with string entries and object entries correctly', () => {
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
                      '^build',
                      'build-base',
                      { target: 'compile', projects: ['lib-b'] },
                      { target: 'test', projects: 'self' },
                      { target: 'pack', projects: ['tag:npm:public', 'lib-c'] },
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
      const buildTarget = getTarget(
        getNode(result.nodes, 'repo-b/lib-a').targets,
        'build',
      );

      expect(buildTarget.dependsOn).toStrictEqual([
        '^build',
        'build-base',
        { target: 'compile', projects: ['repo-b/lib-b'] },
        { target: 'test', projects: 'self' },
        { target: 'pack', projects: ['tag:npm:public', 'repo-b/lib-c'] },
      ]);
    });
  });

  describe('package name extraction', () => {
    beforeEach(() => {
      vi.mocked(readFileSync).mockReturnValue('{}');
    });

    it('extracts packageName from metadata.js.packageName onto TransformedNode', () => {
      const graph = makeFixtureGraph();
      const result = transformGraphForRepo(repoAlias, graph, workspaceRoot);

      expect(getNode(result.nodes, 'repo-b/my-lib').packageName).toBe(
        '@scope/my-lib',
      );
      expect(getNode(result.nodes, 'repo-b/my-app').packageName).toBe(
        '@scope/my-app',
      );
    });

    it('sets packageName to undefined when metadata is missing', () => {
      const graph: ExternalGraphJson = {
        graph: {
          nodes: {
            'no-meta': {
              name: 'no-meta',
              type: 'lib',
              data: { root: 'libs/no-meta' },
            },
          },
          dependencies: {},
        },
      };

      const result = transformGraphForRepo(repoAlias, graph, workspaceRoot);

      expect(
        getNode(result.nodes, 'repo-b/no-meta').packageName,
      ).toBeUndefined();
    });

    it('sets packageName to undefined when metadata.js is missing', () => {
      const graph: ExternalGraphJson = {
        graph: {
          nodes: {
            'no-js-meta': {
              name: 'no-js-meta',
              type: 'lib',
              data: {
                root: 'libs/no-js-meta',
                metadata: { description: 'no js field' },
              },
            },
          },
          dependencies: {},
        },
      };

      const result = transformGraphForRepo(repoAlias, graph, workspaceRoot);

      expect(
        getNode(result.nodes, 'repo-b/no-js-meta').packageName,
      ).toBeUndefined();
    });

    it('sets packageName to undefined when metadata.js.packageName is missing', () => {
      const graph: ExternalGraphJson = {
        graph: {
          nodes: {
            'no-pkg-name': {
              name: 'no-pkg-name',
              type: 'lib',
              data: { root: 'libs/no-pkg-name', metadata: { js: {} } },
            },
          },
          dependencies: {},
        },
      };

      const result = transformGraphForRepo(repoAlias, graph, workspaceRoot);

      expect(
        getNode(result.nodes, 'repo-b/no-pkg-name').packageName,
      ).toBeUndefined();
    });
  });

  describe('dependency list extraction', () => {
    it('extracts dependencies from package.json on disk', () => {
      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify({
          dependencies: { react: '^18.0.0', lodash: '^4.0.0' },
        }),
      );

      const graph: ExternalGraphJson = {
        graph: {
          nodes: {
            'my-lib': {
              name: 'my-lib',
              type: 'lib',
              data: { root: 'libs/my-lib' },
            },
          },
          dependencies: {},
        },
      };

      const result = transformGraphForRepo(repoAlias, graph, workspaceRoot);

      expect(getNode(result.nodes, 'repo-b/my-lib').dependencies).toStrictEqual(
        ['react', 'lodash'],
      );
    });

    it('extracts devDependencies from package.json on disk', () => {
      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify({
          devDependencies: { vitest: '^1.0.0', typescript: '^5.0.0' },
        }),
      );

      const graph: ExternalGraphJson = {
        graph: {
          nodes: {
            'my-lib': {
              name: 'my-lib',
              type: 'lib',
              data: { root: 'libs/my-lib' },
            },
          },
          dependencies: {},
        },
      };

      const result = transformGraphForRepo(repoAlias, graph, workspaceRoot);

      expect(
        getNode(result.nodes, 'repo-b/my-lib').devDependencies,
      ).toStrictEqual(['vitest', 'typescript']);
    });

    it('extracts peerDependencies from package.json on disk', () => {
      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify({ peerDependencies: { react: '>=17.0.0' } }),
      );

      const graph: ExternalGraphJson = {
        graph: {
          nodes: {
            'my-lib': {
              name: 'my-lib',
              type: 'lib',
              data: { root: 'libs/my-lib' },
            },
          },
          dependencies: {},
        },
      };

      const result = transformGraphForRepo(repoAlias, graph, workspaceRoot);

      expect(
        getNode(result.nodes, 'repo-b/my-lib').peerDependencies,
      ).toStrictEqual(['react']);
    });

    it('all three dep fields are undefined when package.json does not exist (silent skip)', () => {
      const enoentError = Object.assign(
        new Error('ENOENT: no such file or directory'),
        {
          code: 'ENOENT',
        },
      );

      vi.mocked(readFileSync).mockImplementation(() => {
        throw enoentError;
      });

      const graph: ExternalGraphJson = {
        graph: {
          nodes: {
            'my-lib': {
              name: 'my-lib',
              type: 'lib',
              data: { root: 'libs/my-lib' },
            },
          },
          dependencies: {},
        },
      };

      const result = transformGraphForRepo(repoAlias, graph, workspaceRoot);
      const node = getNode(result.nodes, 'repo-b/my-lib');

      expect(node.dependencies).toBeUndefined();
      expect(node.devDependencies).toBeUndefined();
      expect(node.peerDependencies).toBeUndefined();
    });

    it('all three dep fields are undefined when package.json has invalid JSON (silent skip)', () => {
      vi.mocked(readFileSync).mockReturnValue('{ invalid json !!!');

      const graph: ExternalGraphJson = {
        graph: {
          nodes: {
            'my-lib': {
              name: 'my-lib',
              type: 'lib',
              data: { root: 'libs/my-lib' },
            },
          },
          dependencies: {},
        },
      };

      const result = transformGraphForRepo(repoAlias, graph, workspaceRoot);
      const node = getNode(result.nodes, 'repo-b/my-lib');

      expect(node.dependencies).toBeUndefined();
      expect(node.devDependencies).toBeUndefined();
      expect(node.peerDependencies).toBeUndefined();
    });

    it('dep field is undefined when the corresponding field is missing from package.json', () => {
      vi.mocked(readFileSync).mockReturnValue(
        JSON.stringify({ dependencies: { react: '^18.0.0' } }),
      );

      const graph: ExternalGraphJson = {
        graph: {
          nodes: {
            'my-lib': {
              name: 'my-lib',
              type: 'lib',
              data: { root: 'libs/my-lib' },
            },
          },
          dependencies: {},
        },
      };

      const result = transformGraphForRepo(repoAlias, graph, workspaceRoot);
      const node = getNode(result.nodes, 'repo-b/my-lib');

      expect(node.dependencies).toStrictEqual(['react']);
      expect(node.devDependencies).toBeUndefined();
      expect(node.peerDependencies).toBeUndefined();
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
      const dep = result.dependencies.find((d) => d.source === 'repo-b/my-app');

      expectTypeOf(dep?.type).toEqualTypeOf<string | undefined>();

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

      expect(result.dependencies).toStrictEqual([]);
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

      expect(result.dependencies).toStrictEqual([]);
    });
  });
});
