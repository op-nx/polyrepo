import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { DependencyType } from '@nx/devkit';
import type { CreateDependenciesContext } from '@nx/devkit';
import { detectCrossRepoDependencies } from './detect';
import type { PolyrepoGraphReport, TransformedNode } from './types';
import type { PolyrepoConfig } from '../config/schema';

vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeConfig(): PolyrepoConfig {
  return {
    repos: { 'repo-a': 'https://github.com/org/repo-a.git' },
  };
}

function makeContext(
  projects: Record<string, { root: string; metadata?: Record<string, unknown> }> = {},
  workspaceRoot = '/workspace',
): CreateDependenciesContext {
  return {
    projects: Object.fromEntries(
      Object.entries(projects).map(([name, { root, metadata }]) => [
        name,
        { root, metadata, name, targets: {} },
      ]),
    ),
    workspaceRoot,
    nxJsonConfiguration: {},
    fileMap: { projectFileMap: {}, nonProjectFiles: [] },
    filesToProcess: { projectFileMap: {}, nonProjectFiles: [] },
  } as unknown as CreateDependenciesContext;
}

function makeExternalNode(
  overrides: Partial<TransformedNode> & { name: string; root: string },
): TransformedNode {
  return {
    targets: {},
    tags: [],
    ...overrides,
  };
}

function makeReport(
  repos: PolyrepoGraphReport['repos'],
): PolyrepoGraphReport {
  return { repos };
}


// ---------------------------------------------------------------------------
// describe(detectCrossRepoDependencies)
// ---------------------------------------------------------------------------

describe('detectCrossRepoDependencies', () => {

  // -------------------------------------------------------------------------
  // Lookup map from external nodes
  // -------------------------------------------------------------------------

  describe('lookup map from external nodes', () => {
    it('external node with packageName creates lookup map entry', () => {
      function setup() {
        vi.clearAllMocks();
        vi.mocked(readFileSync).mockReturnValue('{}');

        const report = makeReport({
          'repo-b': {
            nodes: {
              'repo-b/my-lib': makeExternalNode({
                name: 'repo-b/my-lib',
                root: '.repos/repo-b/libs/my-lib',
                packageName: '@scope/my-lib',
              }),
            },
            dependencies: [],
          },
        });

        const config = makeConfig();
        const context = makeContext({ 'host-app': { root: 'apps/host-app' } });

        return { report, config, context };
      }

      const { report, config, context } = setup();
      const edges = detectCrossRepoDependencies(report, config, context);

      // The lookup map should recognize '@scope/my-lib' as a target project.
      // If we add a consumer that depends on '@scope/my-lib', it should emit an edge.
      // We verify the lookup map works indirectly by providing a consuming project.
      // No consumer here => no edges, but function should not throw.
      expect(edges).toBeInstanceOf(Array);
    });

    it('repo-root project (root ".repos/<alias>/.") emits implicit edge (no sourceFile)', () => {
      function setup() {
        vi.clearAllMocks();
        vi.mocked(readFileSync).mockReturnValue('{}');

        const report = makeReport({
          'repo-a': {
            nodes: {
              'repo-a/root': makeExternalNode({
                name: 'repo-a/root',
                root: '.repos/repo-a/.',
                dependencies: ['@host/utils'],
              }),
            },
            dependencies: [],
          },
        });

        const config = makeConfig();
        const context = makeContext({
          'host-utils': {
            root: 'libs/host-utils',
            metadata: { js: { packageName: '@host/utils' } },
          },
        });

        return { report, config, context };
      }

      const { report, config, context } = setup();
      const edges = detectCrossRepoDependencies(report, config, context);

      expect(edges).toHaveLength(1);

      const edge = edges[0];

      if (!edge) {
        throw new Error('Expected at least one edge');
      }

      // External-sourced edges use implicit type (no sourceFile) because
      // .repos/ is gitignored and not in Nx's file map
      expect(edge).toMatchObject({
        source: 'repo-a/root',
        target: 'host-utils',
        type: DependencyType.implicit,
      });
      expect(edge).not.toHaveProperty('sourceFile');
    });

    it('external node without packageName is excluded from lookup map (no edge emitted)', () => {
      function setup() {
        vi.clearAllMocks();

        const packageJson = JSON.stringify({ dependencies: { '@scope/my-lib': '^1.0.0' } });
        vi.mocked(readFileSync).mockReturnValue(packageJson);

        const report = makeReport({
          'repo-b': {
            nodes: {
              'repo-b/my-lib': makeExternalNode({
                name: 'repo-b/my-lib',
                root: '.repos/repo-b/libs/my-lib',
                // packageName intentionally omitted
              }),
              'repo-a/my-app': makeExternalNode({
                name: 'repo-a/my-app',
                root: '.repos/repo-a/apps/my-app',
                dependencies: ['@scope/my-lib'],
              }),
            },
            dependencies: [],
          },
        });

        const config = makeConfig();
        const context = makeContext();

        return { report, config, context };
      }

      const { report, config, context } = setup();
      const edges = detectCrossRepoDependencies(report, config, context);

      expect(edges).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // Lookup map from host projects
  // -------------------------------------------------------------------------

  describe('lookup map from host projects', () => {
    it('host project with metadata.js.packageName creates lookup map entry', () => {
      function setup() {
        vi.clearAllMocks();
        vi.mocked(readFileSync).mockReturnValue('{}');

        const report = makeReport({
          'repo-b': {
            nodes: {
              'repo-b/my-app': makeExternalNode({
                name: 'repo-b/my-app',
                root: '.repos/repo-b/apps/my-app',
                dependencies: ['@host/utils'],
              }),
            },
            dependencies: [],
          },
        });

        const config = makeConfig();
        const context = makeContext({
          'host-utils': {
            root: 'libs/host-utils',
            metadata: { js: { packageName: '@host/utils' } },
          },
        });

        return { report, config, context };
      }

      const { report, config, context } = setup();
      const edges = detectCrossRepoDependencies(report, config, context);

      expect(edges).toHaveLength(1);
      expect(edges[0]).toMatchObject({
        source: 'repo-b/my-app',
        target: 'host-utils',
        type: DependencyType.implicit,
      });
    });

    it('host project with no metadata.js.packageName is excluded from lookup map', () => {
      function setup() {
        vi.clearAllMocks();
        vi.mocked(readFileSync).mockReturnValue('{}');

        const report = makeReport({
          'repo-b': {
            nodes: {
              'repo-b/my-app': makeExternalNode({
                name: 'repo-b/my-app',
                root: '.repos/repo-b/apps/my-app',
                dependencies: ['@host/utils'],
              }),
            },
            dependencies: [],
          },
        });

        const config = makeConfig();
        // host-utils has no metadata
        const context = makeContext({
          'host-utils': { root: 'libs/host-utils' },
        });

        return { report, config, context };
      }

      const { report, config, context } = setup();
      const edges = detectCrossRepoDependencies(report, config, context);

      expect(edges).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // packageName precedence: external wins over host
  // -------------------------------------------------------------------------

  describe('packageName precedence', () => {
    it('external TransformedNode packageName wins over host project packageName on collision', () => {
      function setup() {
        vi.clearAllMocks();
        vi.mocked(readFileSync).mockReturnValue('{}');

        // Both repo-b/my-lib and host-lib claim '@scope/shared'.
        // Consumer repo-a/my-app depends on '@scope/shared'.
        // External inserted first => repo-b/my-lib wins.
        const report = makeReport({
          'repo-b': {
            nodes: {
              'repo-b/my-lib': makeExternalNode({
                name: 'repo-b/my-lib',
                root: '.repos/repo-b/libs/my-lib',
                packageName: '@scope/shared',
              }),
            },
            dependencies: [],
          },
          'repo-a': {
            nodes: {
              'repo-a/my-app': makeExternalNode({
                name: 'repo-a/my-app',
                root: '.repos/repo-a/apps/my-app',
                dependencies: ['@scope/shared'],
              }),
            },
            dependencies: [],
          },
        });

        const config = makeConfig();
        const context = makeContext({
          'host-lib': {
            root: 'libs/host-lib',
            metadata: { js: { packageName: '@scope/shared' } },
          },
        });

        return { report, config, context };
      }

      const { report, config, context } = setup();
      const edges = detectCrossRepoDependencies(report, config, context);

      expect(edges).toHaveLength(1);
      // Target should be the external node name, not the host project
      expect(edges[0]).toMatchObject({
        source: 'repo-a/my-app',
        target: 'repo-b/my-lib',
        type: DependencyType.implicit,
      });
    });
  });

  // -------------------------------------------------------------------------
  // DETECT-01: dependencies field
  // -------------------------------------------------------------------------

  describe('DETECT-01 — dependencies field', () => {
    it('consumer with matching dependency emits one implicit edge', () => {
      function setup() {
        vi.clearAllMocks();
        vi.mocked(readFileSync).mockReturnValue('{}');

        const report = makeReport({
          'repo-a': {
            nodes: {
              'repo-a/my-app': makeExternalNode({
                name: 'repo-a/my-app',
                root: '.repos/repo-a/apps/my-app',
                dependencies: ['@scope/my-lib'],
              }),
            },
            dependencies: [],
          },
          'repo-b': {
            nodes: {
              'repo-b/my-lib': makeExternalNode({
                name: 'repo-b/my-lib',
                root: '.repos/repo-b/libs/my-lib',
                packageName: '@scope/my-lib',
              }),
            },
            dependencies: [],
          },
        });

        const config = makeConfig();
        const context = makeContext();

        return { report, config, context };
      }

      const { report, config, context } = setup();
      const edges = detectCrossRepoDependencies(report, config, context);

      expect(edges).toHaveLength(1);
      expect(edges[0]).toStrictEqual({
        source: 'repo-a/my-app',
        target: 'repo-b/my-lib',
        type: DependencyType.implicit,
      });
    });

    it('consumer dependencies with no lookup map match emits zero edges', () => {
      function setup() {
        vi.clearAllMocks();
        vi.mocked(readFileSync).mockReturnValue('{}');

        const report = makeReport({
          'repo-a': {
            nodes: {
              'repo-a/my-app': makeExternalNode({
                name: 'repo-a/my-app',
                root: '.repos/repo-a/apps/my-app',
                dependencies: ['react', 'lodash'],
              }),
            },
            dependencies: [],
          },
        });

        const config = makeConfig();
        const context = makeContext();

        return { report, config, context };
      }

      const { report, config, context } = setup();
      const edges = detectCrossRepoDependencies(report, config, context);

      expect(edges).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // DETECT-02: devDependencies field
  // -------------------------------------------------------------------------

  describe('DETECT-02 — devDependencies field', () => {
    it('consumer with matching devDependency emits one implicit edge', () => {
      function setup() {
        vi.clearAllMocks();
        vi.mocked(readFileSync).mockReturnValue('{}');

        const report = makeReport({
          'repo-a': {
            nodes: {
              'repo-a/my-app': makeExternalNode({
                name: 'repo-a/my-app',
                root: '.repos/repo-a/apps/my-app',
                devDependencies: ['@scope/my-lib'],
              }),
            },
            dependencies: [],
          },
          'repo-b': {
            nodes: {
              'repo-b/my-lib': makeExternalNode({
                name: 'repo-b/my-lib',
                root: '.repos/repo-b/libs/my-lib',
                packageName: '@scope/my-lib',
              }),
            },
            dependencies: [],
          },
        });

        const config = makeConfig();
        const context = makeContext();

        return { report, config, context };
      }

      const { report, config, context } = setup();
      const edges = detectCrossRepoDependencies(report, config, context);

      expect(edges).toHaveLength(1);
      expect(edges[0]).toStrictEqual({
        source: 'repo-a/my-app',
        target: 'repo-b/my-lib',
        type: DependencyType.implicit,
      });
    });
  });

  // -------------------------------------------------------------------------
  // DETECT-03: peerDependencies field
  // -------------------------------------------------------------------------

  describe('DETECT-03 — peerDependencies field', () => {
    it('consumer with matching peerDependency emits one implicit edge', () => {
      function setup() {
        vi.clearAllMocks();
        vi.mocked(readFileSync).mockReturnValue('{}');

        const report = makeReport({
          'repo-a': {
            nodes: {
              'repo-a/my-app': makeExternalNode({
                name: 'repo-a/my-app',
                root: '.repos/repo-a/apps/my-app',
                peerDependencies: ['@scope/my-lib'],
              }),
            },
            dependencies: [],
          },
          'repo-b': {
            nodes: {
              'repo-b/my-lib': makeExternalNode({
                name: 'repo-b/my-lib',
                root: '.repos/repo-b/libs/my-lib',
                packageName: '@scope/my-lib',
              }),
            },
            dependencies: [],
          },
        });

        const config = makeConfig();
        const context = makeContext();

        return { report, config, context };
      }

      const { report, config, context } = setup();
      const edges = detectCrossRepoDependencies(report, config, context);

      expect(edges).toHaveLength(1);
      expect(edges[0]).toStrictEqual({
        source: 'repo-a/my-app',
        target: 'repo-b/my-lib',
        type: DependencyType.implicit,
      });
    });
  });

  // -------------------------------------------------------------------------
  // sourceFile path
  // -------------------------------------------------------------------------

  describe('sourceFile path', () => {
    it('external-sourced edges omit sourceFile (.repos/ not in file map)', () => {
      function setup() {
        vi.clearAllMocks();
        vi.mocked(readFileSync).mockReturnValue('{}');

        const report = makeReport({
          'repo-a': {
            nodes: {
              'repo-a/my-app': makeExternalNode({
                name: 'repo-a/my-app',
                root: '.repos/repo-a/apps/my-app',
                dependencies: ['@scope/my-lib'],
              }),
            },
            dependencies: [],
          },
          'repo-b': {
            nodes: {
              'repo-b/my-lib': makeExternalNode({
                name: 'repo-b/my-lib',
                root: '.repos/repo-b/libs/my-lib',
                packageName: '@scope/my-lib',
              }),
            },
            dependencies: [],
          },
        });

        const config = makeConfig();
        const context = makeContext();

        return { report, config, context };
      }

      const { report, config, context } = setup();
      const edges = detectCrossRepoDependencies(report, config, context);

      expect(edges).toHaveLength(1);
      expect(edges[0]).not.toHaveProperty('sourceFile');
    });

    it('host-sourced edges also omit sourceFile (use implicit type)', () => {
      function setup() {
        vi.clearAllMocks();

        const packageJson = JSON.stringify({
          dependencies: { '@scope/ext-lib': '^1.0.0' },
        });
        vi.mocked(readFileSync).mockReturnValue(packageJson);

        const report = makeReport({
          'repo-b': {
            nodes: {
              'repo-b/my-lib': makeExternalNode({
                name: 'repo-b/my-lib',
                root: '.repos/repo-b/libs/my-lib',
                packageName: '@scope/ext-lib',
              }),
            },
            dependencies: [],
          },
        });

        const config = makeConfig();
        const context = makeContext({
          'host-app': { root: 'apps/host-app' },
        });

        return { report, config, context };
      }

      const { report, config, context } = setup();
      const edges = detectCrossRepoDependencies(report, config, context);

      expect(edges).toHaveLength(1);
      expect(edges[0]).not.toHaveProperty('sourceFile');
      expect(edges[0]).toMatchObject({ type: DependencyType.implicit });
    });
  });

  // -------------------------------------------------------------------------
  // Cross-repo guard
  // -------------------------------------------------------------------------

  describe('cross-repo guard', () => {
    it('intra-repo edges (source and target in same repo) are NOT emitted', () => {
      function setup() {
        vi.clearAllMocks();
        vi.mocked(readFileSync).mockReturnValue('{}');

        // Both nodes in repo-a; '@scope/my-lib' is also from repo-a
        const report = makeReport({
          'repo-a': {
            nodes: {
              'repo-a/my-app': makeExternalNode({
                name: 'repo-a/my-app',
                root: '.repos/repo-a/apps/my-app',
                dependencies: ['@scope/my-lib'],
              }),
              'repo-a/my-lib': makeExternalNode({
                name: 'repo-a/my-lib',
                root: '.repos/repo-a/libs/my-lib',
                packageName: '@scope/my-lib',
              }),
            },
            dependencies: [],
          },
        });

        const config = makeConfig();
        const context = makeContext();

        return { report, config, context };
      }

      const { report, config, context } = setup();
      const edges = detectCrossRepoDependencies(report, config, context);

      expect(edges).toHaveLength(0);
    });

    it('host-to-host edges (both source and target are host projects) are NOT emitted', () => {
      function setup() {
        vi.clearAllMocks();
        vi.mocked(readFileSync).mockReturnValue(
          JSON.stringify({ dependencies: { '@host/utils': '^1.0.0' } }),
        );

        // Empty external report
        const report = makeReport({});

        const config = makeConfig();
        // host-app depends on host-utils (both are host projects)
        const context = makeContext({
          'host-app': { root: 'apps/host-app' },
          'host-utils': {
            root: 'libs/host-utils',
            metadata: { js: { packageName: '@host/utils' } },
          },
        });

        return { report, config, context };
      }

      const { report, config, context } = setup();
      const edges = detectCrossRepoDependencies(report, config, context);

      expect(edges).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // Host project as source
  // -------------------------------------------------------------------------

  describe('host project as source', () => {
    it('host project consuming external package emits implicit cross-repo edge', () => {
      function setup() {
        vi.clearAllMocks();
        // readFileSync returns the host app's package.json with a dep on @scope/my-lib
        vi.mocked(readFileSync).mockReturnValue(
          JSON.stringify({ dependencies: { '@scope/my-lib': '^1.0.0' } }),
        );

        const report = makeReport({
          'repo-b': {
            nodes: {
              'repo-b/my-lib': makeExternalNode({
                name: 'repo-b/my-lib',
                root: '.repos/repo-b/libs/my-lib',
                packageName: '@scope/my-lib',
              }),
            },
            dependencies: [],
          },
        });

        const config = makeConfig();
        const context = makeContext(
          { 'host-app': { root: 'apps/host-app' } },
          '/workspace',
        );

        return { report, config, context };
      }

      const { report, config, context } = setup();
      const edges = detectCrossRepoDependencies(report, config, context);

      expect(edges).toHaveLength(1);
      expect(edges[0]).toStrictEqual({
        source: 'host-app',
        target: 'repo-b/my-lib',
        type: DependencyType.implicit,
      });
    });
  });

  // -------------------------------------------------------------------------
  // Deduplication
  // -------------------------------------------------------------------------

  describe('deduplication', () => {
    it('same package in both dependencies and devDependencies emits only ONE edge', () => {
      function setup() {
        vi.clearAllMocks();
        vi.mocked(readFileSync).mockReturnValue('{}');

        const report = makeReport({
          'repo-a': {
            nodes: {
              'repo-a/my-app': makeExternalNode({
                name: 'repo-a/my-app',
                root: '.repos/repo-a/apps/my-app',
                dependencies: ['@scope/my-lib'],
                devDependencies: ['@scope/my-lib'],
              }),
            },
            dependencies: [],
          },
          'repo-b': {
            nodes: {
              'repo-b/my-lib': makeExternalNode({
                name: 'repo-b/my-lib',
                root: '.repos/repo-b/libs/my-lib',
                packageName: '@scope/my-lib',
              }),
            },
            dependencies: [],
          },
        });

        const config = makeConfig();
        const context = makeContext();

        return { report, config, context };
      }

      const { report, config, context } = setup();
      const edges = detectCrossRepoDependencies(report, config, context);

      expect(edges).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // No mutation
  // -------------------------------------------------------------------------

  describe('no mutation', () => {
    it('input report is not mutated', () => {
      function setup() {
        vi.clearAllMocks();
        vi.mocked(readFileSync).mockReturnValue('{}');

        const report = makeReport({
          'repo-a': {
            nodes: {
              'repo-a/my-app': makeExternalNode({
                name: 'repo-a/my-app',
                root: '.repos/repo-a/apps/my-app',
                dependencies: ['@scope/my-lib'],
              }),
            },
            dependencies: [],
          },
          'repo-b': {
            nodes: {
              'repo-b/my-lib': makeExternalNode({
                name: 'repo-b/my-lib',
                root: '.repos/repo-b/libs/my-lib',
                packageName: '@scope/my-lib',
              }),
            },
            dependencies: [],
          },
        });

        const config = makeConfig();
        const context = makeContext();
        const reportBefore = JSON.stringify(report);

        return { report, config, context, reportBefore };
      }

      const { report, config, context, reportBefore } = setup();
      detectCrossRepoDependencies(report, config, context);

      expect(JSON.stringify(report)).toBe(reportBefore);
    });
  });

  // -------------------------------------------------------------------------
  // DETECT-04: tsconfig path alias expansion — lookup map enrichment
  // -------------------------------------------------------------------------

  describe('DETECT-04 — tsconfig path alias expansion', () => {
    it('tsconfig.base.json path alias with matching node root expands lookup map and emits edge', () => {
      function setup() {
        vi.clearAllMocks();

        // readFileSync call map:
        // - .repos/repo-b/tsconfig.base.json -> tsconfig with @acme/core alias
        // - anything else (host package.json) -> '{}'
        vi.mocked(readFileSync).mockImplementation((path) => {
          const p = String(path);

          if (p.endsWith('repo-b/tsconfig.base.json')) {
            return JSON.stringify({
              compilerOptions: {
                paths: {
                  '@acme/core': ['libs/core/src/index.ts'],
                },
              },
            });
          }

          return '{}';
        });

        const report = makeReport({
          'repo-a': {
            nodes: {
              'repo-a/my-app': makeExternalNode({
                name: 'repo-a/my-app',
                root: '.repos/repo-a/apps/my-app',
                dependencies: ['@acme/core'],
              }),
            },
            dependencies: [],
          },
          'repo-b': {
            nodes: {
              'repo-b/core': makeExternalNode({
                name: 'repo-b/core',
                root: '.repos/repo-b/libs/core',
                // no packageName — must be discovered via tsconfig alias
              }),
            },
            dependencies: [],
          },
        });

        const config = makeConfig();
        const context = makeContext();

        return { report, config, context };
      }

      const { report, config, context } = setup();
      const edges = detectCrossRepoDependencies(report, config, context);

      expect(edges).toHaveLength(1);
      expect(edges[0]).toMatchObject({
        source: 'repo-a/my-app',
        target: 'repo-b/core',
        type: DependencyType.implicit,
      });
    });

    it('packageName takes precedence over tsconfig alias when both map to the same key', () => {
      function setup() {
        vi.clearAllMocks();

        vi.mocked(readFileSync).mockImplementation((path) => {
          const p = String(path);

          if (p.endsWith('repo-b/tsconfig.base.json')) {
            return JSON.stringify({
              compilerOptions: {
                paths: {
                  '@acme/core': ['libs/core/src/index.ts'],
                },
              },
            });
          }

          return '{}';
        });

        const report = makeReport({
          'repo-a': {
            nodes: {
              'repo-a/my-app': makeExternalNode({
                name: 'repo-a/my-app',
                root: '.repos/repo-a/apps/my-app',
                dependencies: ['@acme/core'],
              }),
            },
            dependencies: [],
          },
          'repo-b': {
            nodes: {
              // packageName already claims '@acme/core'
              'repo-b/core': makeExternalNode({
                name: 'repo-b/core',
                root: '.repos/repo-b/libs/core',
                packageName: '@acme/core',
              }),
            },
            dependencies: [],
          },
        });

        const config = makeConfig();
        const context = makeContext();

        return { report, config, context };
      }

      const { report, config, context } = setup();
      const edges = detectCrossRepoDependencies(report, config, context);

      // Should still emit exactly 1 edge (not duplicated)
      expect(edges).toHaveLength(1);
      expect(edges[0]).toMatchObject({
        source: 'repo-a/my-app',
        target: 'repo-b/core',
        type: DependencyType.implicit,
      });
    });

    it('falls back to tsconfig.json when tsconfig.base.json is absent', () => {
      function setup() {
        vi.clearAllMocks();

        vi.mocked(readFileSync).mockImplementation((path) => {
          const p = String(path);

          if (p.endsWith('repo-b/tsconfig.base.json')) {
            throw new Error('ENOENT');
          }

          if (p.endsWith('repo-b/tsconfig.json')) {
            return JSON.stringify({
              compilerOptions: {
                paths: {
                  '@acme/utils': ['libs/utils/src/index.ts'],
                },
              },
            });
          }

          return '{}';
        });

        const report = makeReport({
          'repo-a': {
            nodes: {
              'repo-a/my-app': makeExternalNode({
                name: 'repo-a/my-app',
                root: '.repos/repo-a/apps/my-app',
                dependencies: ['@acme/utils'],
              }),
            },
            dependencies: [],
          },
          'repo-b': {
            nodes: {
              'repo-b/utils': makeExternalNode({
                name: 'repo-b/utils',
                root: '.repos/repo-b/libs/utils',
              }),
            },
            dependencies: [],
          },
        });

        const config = makeConfig();
        const context = makeContext();

        return { report, config, context };
      }

      const { report, config, context } = setup();
      const edges = detectCrossRepoDependencies(report, config, context);

      expect(edges).toHaveLength(1);
      expect(edges[0]).toMatchObject({
        source: 'repo-a/my-app',
        target: 'repo-b/utils',
        type: DependencyType.implicit,
      });
    });

    it('repo with neither tsconfig.base.json nor tsconfig.json is silently skipped — no error', () => {
      function setup() {
        vi.clearAllMocks();

        vi.mocked(readFileSync).mockImplementation((path) => {
          const p = String(path);

          if (p.includes('tsconfig')) {
            throw new Error('ENOENT');
          }

          return '{}';
        });

        const report = makeReport({
          'repo-b': {
            nodes: {
              'repo-b/core': makeExternalNode({
                name: 'repo-b/core',
                root: '.repos/repo-b/libs/core',
              }),
            },
            dependencies: [],
          },
        });

        const config = makeConfig();
        const context = makeContext();

        return { report, config, context };
      }

      const { report, config, context } = setup();

      expect(() => detectCrossRepoDependencies(report, config, context)).not.toThrow();
    });

    it('alias value with filename strips filename and walks up segments to find matching root', () => {
      function setup() {
        vi.clearAllMocks();

        // alias value 'libs/core/src/index.ts' -> strip filename -> 'libs/core/src'
        // walk up: 'libs/core/src' no match, 'libs/core' matches node root 'libs/core'
        vi.mocked(readFileSync).mockImplementation((path) => {
          const p = String(path);

          if (p.endsWith('repo-b/tsconfig.base.json')) {
            return JSON.stringify({
              compilerOptions: {
                paths: {
                  '@acme/core': ['libs/core/src/index.ts'],
                },
              },
            });
          }

          return '{}';
        });

        const report = makeReport({
          'repo-a': {
            nodes: {
              'repo-a/my-app': makeExternalNode({
                name: 'repo-a/my-app',
                root: '.repos/repo-a/apps/my-app',
                dependencies: ['@acme/core'],
              }),
            },
            dependencies: [],
          },
          'repo-b': {
            nodes: {
              'repo-b/core': makeExternalNode({
                name: 'repo-b/core',
                root: '.repos/repo-b/libs/core',
              }),
            },
            dependencies: [],
          },
        });

        const config = makeConfig();
        const context = makeContext();

        return { report, config, context };
      }

      const { report, config, context } = setup();
      const edges = detectCrossRepoDependencies(report, config, context);

      expect(edges).toHaveLength(1);
      expect(edges[0]).toMatchObject({
        source: 'repo-a/my-app',
        target: 'repo-b/core',
        type: DependencyType.implicit,
      });
    });

    it('alias value whose path matches no project root is silently ignored', () => {
      function setup() {
        vi.clearAllMocks();

        vi.mocked(readFileSync).mockImplementation((path) => {
          const p = String(path);

          if (p.endsWith('repo-b/tsconfig.base.json')) {
            return JSON.stringify({
              compilerOptions: {
                paths: {
                  '@acme/ghost': ['libs/ghost/src/index.ts'],
                },
              },
            });
          }

          return '{}';
        });

        const report = makeReport({
          'repo-b': {
            nodes: {
              'repo-b/core': makeExternalNode({
                name: 'repo-b/core',
                root: '.repos/repo-b/libs/core',
              }),
            },
            dependencies: [],
          },
        });

        const config = makeConfig();
        const context = makeContext();

        return { report, config, context };
      }

      const { report, config, context } = setup();

      expect(() => detectCrossRepoDependencies(report, config, context)).not.toThrow();
      const edges = detectCrossRepoDependencies(report, config, context);
      expect(edges).toHaveLength(0);
    });

    it('host workspace tsconfig.base.json path alias expands lookup map with host project', () => {
      function setup() {
        vi.clearAllMocks();

        vi.mocked(readFileSync).mockImplementation((path) => {
          const p = String(path);

          // Host workspace tsconfig.base.json at workspace root
          if (p === '/workspace/tsconfig.base.json') {
            return JSON.stringify({
              compilerOptions: {
                paths: {
                  '@host/utils': ['libs/utils/src/index.ts'],
                },
              },
            });
          }

          // Host project package.json — no deps
          if (p === '/workspace/apps/host-app/package.json') {
            return '{}';
          }

          // External tsconfig — not present
          if (p.includes('tsconfig')) {
            throw new Error('ENOENT');
          }

          return '{}';
        });

        const report = makeReport({
          'repo-b': {
            nodes: {
              'repo-b/my-app': makeExternalNode({
                name: 'repo-b/my-app',
                root: '.repos/repo-b/apps/my-app',
                dependencies: ['@host/utils'],
              }),
            },
            dependencies: [],
          },
        });

        const config = makeConfig();
        const context = makeContext(
          {
            'host-app': { root: 'apps/host-app' },
            'host-utils': { root: 'libs/utils' },
          },
          '/workspace',
        );

        return { report, config, context };
      }

      const { report, config, context } = setup();
      const edges = detectCrossRepoDependencies(report, config, context);

      expect(edges).toHaveLength(1);
      expect(edges[0]).toMatchObject({
        source: 'repo-b/my-app',
        target: 'host-utils',
        type: DependencyType.implicit,
      });
    });

    it('invalid tsconfig JSON is silently skipped — no error', () => {
      function setup() {
        vi.clearAllMocks();

        vi.mocked(readFileSync).mockImplementation((path) => {
          const p = String(path);

          if (p.endsWith('repo-b/tsconfig.base.json')) {
            return 'not-valid-json{{{';
          }

          return '{}';
        });

        const report = makeReport({
          'repo-b': {
            nodes: {
              'repo-b/core': makeExternalNode({
                name: 'repo-b/core',
                root: '.repos/repo-b/libs/core',
              }),
            },
            dependencies: [],
          },
        });

        const config = makeConfig();
        const context = makeContext();

        return { report, config, context };
      }

      const { report, config, context } = setup();

      expect(() => detectCrossRepoDependencies(report, config, context)).not.toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // OVRD-01: Explicit override edge emission
  // -------------------------------------------------------------------------

  describe('OVRD-01 — explicit override edge emission', () => {
    it('exact project name in implicitDependencies emits one implicit edge without sourceFile', () => {
      function setup() {
        vi.clearAllMocks();
        vi.mocked(readFileSync).mockReturnValue('{}');

        const report = makeReport({
          'repo-a': {
            nodes: {
              'repo-a/my-app': makeExternalNode({
                name: 'repo-a/my-app',
                root: '.repos/repo-a/apps/my-app',
              }),
            },
            dependencies: [],
          },
          'repo-b': {
            nodes: {
              'repo-b/my-lib': makeExternalNode({
                name: 'repo-b/my-lib',
                root: '.repos/repo-b/libs/my-lib',
              }),
            },
            dependencies: [],
          },
        });

        const config: PolyrepoConfig = {
          repos: { 'repo-a': 'https://github.com/org/repo-a.git' },
          implicitDependencies: {
            'repo-a/my-app': ['repo-b/my-lib'],
          },
        };

        const context = makeContext({
          // register both in context.projects so they appear in override validation
          // (they are external nodes, not host projects, but for override validation
          // context.projects is not used — project names come from report.repos)
        });

        return { report, config, context };
      }

      const { report, config, context } = setup();
      const edges = detectCrossRepoDependencies(report, config, context);

      expect(edges).toHaveLength(1);
      expect(edges[0]).toStrictEqual({
        source: 'repo-a/my-app',
        target: 'repo-b/my-lib',
        type: DependencyType.implicit,
      });
    });

    it('glob key matches multiple source projects and emits one implicit edge per matched source', () => {
      function setup() {
        vi.clearAllMocks();
        vi.mocked(readFileSync).mockReturnValue('{}');

        const report = makeReport({
          'repo-a': {
            nodes: {
              'repo-a/app1': makeExternalNode({
                name: 'repo-a/app1',
                root: '.repos/repo-a/apps/app1',
              }),
              'repo-a/app2': makeExternalNode({
                name: 'repo-a/app2',
                root: '.repos/repo-a/apps/app2',
              }),
            },
            dependencies: [],
          },
          'repo-b': {
            nodes: {
              'repo-b/my-lib': makeExternalNode({
                name: 'repo-b/my-lib',
                root: '.repos/repo-b/libs/my-lib',
              }),
            },
            dependencies: [],
          },
        });

        const config: PolyrepoConfig = {
          repos: { 'repo-a': 'https://github.com/org/repo-a.git' },
          implicitDependencies: {
            'repo-a/*': ['repo-b/my-lib'],
          },
        };

        const context = makeContext();

        return { report, config, context };
      }

      const { report, config, context } = setup();
      const edges = detectCrossRepoDependencies(report, config, context);

      expect(edges).toHaveLength(2);

      const sources = edges.map((e) => e.source).sort();
      expect(sources).toEqual(['repo-a/app1', 'repo-a/app2']);
      expect(edges.every((e) => e.target === 'repo-b/my-lib')).toBe(true);
      expect(edges.every((e) => e.type === DependencyType.implicit)).toBe(true);
    });

    it('glob target matches multiple target projects and emits one implicit edge per matched target', () => {
      function setup() {
        vi.clearAllMocks();
        vi.mocked(readFileSync).mockReturnValue('{}');

        const report = makeReport({
          'repo-a': {
            nodes: {
              'repo-a/my-app': makeExternalNode({
                name: 'repo-a/my-app',
                root: '.repos/repo-a/apps/my-app',
              }),
            },
            dependencies: [],
          },
          'repo-b': {
            nodes: {
              'repo-b/lib1': makeExternalNode({
                name: 'repo-b/lib1',
                root: '.repos/repo-b/libs/lib1',
              }),
              'repo-b/lib2': makeExternalNode({
                name: 'repo-b/lib2',
                root: '.repos/repo-b/libs/lib2',
              }),
            },
            dependencies: [],
          },
        });

        const config: PolyrepoConfig = {
          repos: { 'repo-a': 'https://github.com/org/repo-a.git' },
          implicitDependencies: {
            'repo-a/my-app': ['repo-b/*'],
          },
        };

        const context = makeContext();

        return { report, config, context };
      }

      const { report, config, context } = setup();
      const edges = detectCrossRepoDependencies(report, config, context);

      expect(edges).toHaveLength(2);

      const targets = edges.map((e) => e.target).sort();
      expect(targets).toEqual(['repo-b/lib1', 'repo-b/lib2']);
      expect(edges.every((e) => e.source === 'repo-a/my-app')).toBe(true);
      expect(edges.every((e) => e.type === DependencyType.implicit)).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // OVRD-02: Negation suppression
  // -------------------------------------------------------------------------

  describe('OVRD-02 — negation suppression', () => {
    it('!target negation suppresses an auto-detected edge from the output', () => {
      function setup() {
        vi.clearAllMocks();
        vi.mocked(readFileSync).mockReturnValue('{}');

        const report = makeReport({
          'repo-a': {
            nodes: {
              'repo-a/my-app': makeExternalNode({
                name: 'repo-a/my-app',
                root: '.repos/repo-a/apps/my-app',
                dependencies: ['@scope/my-lib'],
              }),
            },
            dependencies: [],
          },
          'repo-b': {
            nodes: {
              'repo-b/my-lib': makeExternalNode({
                name: 'repo-b/my-lib',
                root: '.repos/repo-b/libs/my-lib',
                packageName: '@scope/my-lib',
              }),
            },
            dependencies: [],
          },
        });

        const config: PolyrepoConfig = {
          repos: { 'repo-a': 'https://github.com/org/repo-a.git' },
          implicitDependencies: {
            'repo-a/my-app': ['!repo-b/my-lib'],
          },
        };

        const context = makeContext();

        return { report, config, context };
      }

      const { report, config, context } = setup();
      const edges = detectCrossRepoDependencies(report, config, context);

      expect(edges).toHaveLength(0);
    });

    it('negation removes only the specific source+target pair; other edges from same source are kept', () => {
      function setup() {
        vi.clearAllMocks();
        vi.mocked(readFileSync).mockReturnValue('{}');

        const report = makeReport({
          'repo-a': {
            nodes: {
              'repo-a/my-app': makeExternalNode({
                name: 'repo-a/my-app',
                root: '.repos/repo-a/apps/my-app',
                dependencies: ['@scope/lib1', '@scope/lib2'],
              }),
            },
            dependencies: [],
          },
          'repo-b': {
            nodes: {
              'repo-b/lib1': makeExternalNode({
                name: 'repo-b/lib1',
                root: '.repos/repo-b/libs/lib1',
                packageName: '@scope/lib1',
              }),
              'repo-b/lib2': makeExternalNode({
                name: 'repo-b/lib2',
                root: '.repos/repo-b/libs/lib2',
                packageName: '@scope/lib2',
              }),
            },
            dependencies: [],
          },
        });

        // Suppress only repo-b/lib1; lib2 should still be emitted
        const config: PolyrepoConfig = {
          repos: { 'repo-a': 'https://github.com/org/repo-a.git' },
          implicitDependencies: {
            'repo-a/my-app': ['!repo-b/lib1'],
          },
        };

        const context = makeContext();

        return { report, config, context };
      }

      const { report, config, context } = setup();
      const edges = detectCrossRepoDependencies(report, config, context);

      expect(edges).toHaveLength(1);
      expect(edges[0]).toMatchObject({
        source: 'repo-a/my-app',
        target: 'repo-b/lib2',
        type: DependencyType.implicit,
      });
    });

    it('negation suppresses edges detected via package.json AND tsconfig alias', () => {
      function setup() {
        vi.clearAllMocks();

        vi.mocked(readFileSync).mockImplementation((path) => {
          const p = String(path);

          if (p.endsWith('repo-b/tsconfig.base.json')) {
            return JSON.stringify({
              compilerOptions: {
                paths: {
                  '@acme/core': ['libs/core/src/index.ts'],
                },
              },
            });
          }

          return '{}';
        });

        const report = makeReport({
          'repo-a': {
            nodes: {
              'repo-a/my-app': makeExternalNode({
                name: 'repo-a/my-app',
                root: '.repos/repo-a/apps/my-app',
                dependencies: ['@acme/core'],
              }),
            },
            dependencies: [],
          },
          'repo-b': {
            nodes: {
              'repo-b/core': makeExternalNode({
                name: 'repo-b/core',
                root: '.repos/repo-b/libs/core',
              }),
            },
            dependencies: [],
          },
        });

        const config: PolyrepoConfig = {
          repos: { 'repo-a': 'https://github.com/org/repo-a.git' },
          implicitDependencies: {
            'repo-a/my-app': ['!repo-b/core'],
          },
        };

        const context = makeContext();

        return { report, config, context };
      }

      const { report, config, context } = setup();
      const edges = detectCrossRepoDependencies(report, config, context);

      expect(edges).toHaveLength(0);
    });

    it('positive override wins over negation when both explicit and negation target the same pair', () => {
      function setup() {
        vi.clearAllMocks();
        vi.mocked(readFileSync).mockReturnValue('{}');

        const report = makeReport({
          'repo-a': {
            nodes: {
              'repo-a/my-app': makeExternalNode({
                name: 'repo-a/my-app',
                root: '.repos/repo-a/apps/my-app',
              }),
            },
            dependencies: [],
          },
          'repo-b': {
            nodes: {
              'repo-b/my-lib': makeExternalNode({
                name: 'repo-b/my-lib',
                root: '.repos/repo-b/libs/my-lib',
              }),
            },
            dependencies: [],
          },
        });

        // Both positive and negation for same pair — negation suppresses auto-detect;
        // positive override explicitly adds it; net result: edge IS emitted (as implicit)
        const config: PolyrepoConfig = {
          repos: { 'repo-a': 'https://github.com/org/repo-a.git' },
          implicitDependencies: {
            'repo-a/my-app': ['repo-b/my-lib', '!repo-b/my-lib'],
          },
        };

        const context = makeContext();

        return { report, config, context };
      }

      const { report, config, context } = setup();
      const edges = detectCrossRepoDependencies(report, config, context);

      // Negation filters auto-detected (none here anyway), override emission adds implicit edge
      // So net result: 1 implicit edge from override emission
      expect(edges).toHaveLength(1);
      expect(edges[0]).toMatchObject({
        source: 'repo-a/my-app',
        target: 'repo-b/my-lib',
        type: DependencyType.implicit,
      });
    });
  });

  // -------------------------------------------------------------------------
  // OVRD-03: Unknown project validation
  // -------------------------------------------------------------------------

  describe('OVRD-03 — unknown project validation', () => {
    it('unknown key pattern that matches zero projects throws with the unknown name', () => {
      function setup() {
        vi.clearAllMocks();
        vi.mocked(readFileSync).mockReturnValue('{}');

        const report = makeReport({
          'repo-b': {
            nodes: {
              'repo-b/my-lib': makeExternalNode({
                name: 'repo-b/my-lib',
                root: '.repos/repo-b/libs/my-lib',
              }),
            },
            dependencies: [],
          },
        });

        const config: PolyrepoConfig = {
          repos: { 'repo-a': 'https://github.com/org/repo-a.git' },
          implicitDependencies: {
            'nx/missing-lib': ['repo-b/my-lib'],
          },
        };

        const context = makeContext();

        return { report, config, context };
      }

      const { report, config, context } = setup();

      expect(() => detectCrossRepoDependencies(report, config, context)).toThrow(
        'Unknown projects in implicitDependencies: nx/missing-lib',
      );
    });

    it('unknown target pattern that matches zero projects throws with the unknown name', () => {
      function setup() {
        vi.clearAllMocks();
        vi.mocked(readFileSync).mockReturnValue('{}');

        const report = makeReport({
          'repo-a': {
            nodes: {
              'repo-a/my-app': makeExternalNode({
                name: 'repo-a/my-app',
                root: '.repos/repo-a/apps/my-app',
              }),
            },
            dependencies: [],
          },
        });

        const config: PolyrepoConfig = {
          repos: { 'repo-a': 'https://github.com/org/repo-a.git' },
          implicitDependencies: {
            'repo-a/my-app': ['repo-b/ghost'],
          },
        };

        const context = makeContext();

        return { report, config, context };
      }

      const { report, config, context } = setup();

      expect(() => detectCrossRepoDependencies(report, config, context)).toThrow(
        'Unknown projects in implicitDependencies: repo-b/ghost',
      );
    });

    it('both unknown key AND unknown target are reported in a single throw', () => {
      function setup() {
        vi.clearAllMocks();
        vi.mocked(readFileSync).mockReturnValue('{}');

        const report = makeReport({});

        const config: PolyrepoConfig = {
          repos: { 'repo-a': 'https://github.com/org/repo-a.git' },
          implicitDependencies: {
            'nx/missing-lib': ['repo-b/ghost'],
          },
        };

        const context = makeContext();

        return { report, config, context };
      }

      const { report, config, context } = setup();

      expect(() => detectCrossRepoDependencies(report, config, context)).toThrow(
        /Unknown projects in implicitDependencies:.*nx\/missing-lib.*repo-b\/ghost/,
      );
    });

    it('negation target that matches zero projects also throws', () => {
      function setup() {
        vi.clearAllMocks();
        vi.mocked(readFileSync).mockReturnValue('{}');

        const report = makeReport({
          'repo-a': {
            nodes: {
              'repo-a/my-app': makeExternalNode({
                name: 'repo-a/my-app',
                root: '.repos/repo-a/apps/my-app',
              }),
            },
            dependencies: [],
          },
        });

        const config: PolyrepoConfig = {
          repos: { 'repo-a': 'https://github.com/org/repo-a.git' },
          implicitDependencies: {
            'repo-a/my-app': ['!repo-b/ghost'],
          },
        };

        const context = makeContext();

        return { report, config, context };
      }

      const { report, config, context } = setup();

      expect(() => detectCrossRepoDependencies(report, config, context)).toThrow(
        'Unknown projects in implicitDependencies: repo-b/ghost',
      );
    });

    it('config with no implicitDependencies field does not throw', () => {
      function setup() {
        vi.clearAllMocks();
        vi.mocked(readFileSync).mockReturnValue('{}');

        const report = makeReport({
          'repo-b': {
            nodes: {
              'repo-b/my-lib': makeExternalNode({
                name: 'repo-b/my-lib',
                root: '.repos/repo-b/libs/my-lib',
              }),
            },
            dependencies: [],
          },
        });

        const config = makeConfig(); // no implicitDependencies
        const context = makeContext();

        return { report, config, context };
      }

      const { report, config, context } = setup();

      expect(() => detectCrossRepoDependencies(report, config, context)).not.toThrow();
    });
  });

});
