import { describe, it, expect, vi } from 'vitest';
import type {
  CreateNodesContextV2,
  CreateDependenciesContext,
} from '@nx/devkit';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();

  return {
    ...actual,
    readFile: vi.fn().mockResolvedValue('.repos/\nnode_modules\n'),
  };
});

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();

  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(true),
  };
});

vi.mock('@nx/devkit', () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
  DependencyType: {
    static: 'static',
    dynamic: 'dynamic',
    implicit: 'implicit',
  },
}));

vi.mock('nx/src/devkit-internals', () => ({
  hashObject: vi.fn().mockReturnValue('mock-hash'),
}));

vi.mock('./lib/graph/cache', () => ({
  populateGraphReport: vi.fn(),
  getCurrentGraphReport: vi.fn(),
}));

import { createNodesV2, createDependencies } from './index';
import { logger } from '@nx/devkit';
import { populateGraphReport } from './lib/graph/cache';
import type { PolyrepoGraphReport } from './lib/graph/types';

function setup() {
  vi.clearAllMocks();

  const mockedPopulateGraphReport = vi.mocked(populateGraphReport);
  const mockedLoggerWarn = vi.mocked(logger.warn);

  const mockContext: CreateNodesContextV2 = {
    nxJsonConfiguration: {},
    workspaceRoot: '/workspace',
  };

  return { mockedPopulateGraphReport, mockedLoggerWarn, mockContext };
}

/**
 * Create a minimal CreateDependenciesContext for testing.
 * Uses properly typed fields instead of stub casts.
 */
function createDepContext(
  projects: Record<string, { root: string }>,
): CreateDependenciesContext {
  return {
    projects,
    nxJsonConfiguration: {},
    workspaceRoot: '/workspace',
    externalNodes: {},
    fileMap: { projectFileMap: {}, nonProjectFiles: [] },
    filesToProcess: { projectFileMap: {}, nonProjectFiles: [] },
  };
}

describe('createNodesV2', () => {
  it('is exported as a tuple with nx.json glob', () => {
    const [glob] = createNodesV2;

    expect(glob).toBe('nx.json');
  });

  it('callback throws for invalid config (no repos key)', async () => {
    const { mockContext } = setup();

    const [, callback] = createNodesV2;

    await expect(
      callback(['nx.json'], undefined, mockContext),
    ).rejects.toThrow();
  });

  it('callback returns polyrepo-sync and polyrepo-status targets on root project', async () => {
    const { mockedPopulateGraphReport, mockContext } = setup();

    mockedPopulateGraphReport.mockResolvedValue({ repos: {} });

    const [, callback] = createNodesV2;

    const options = {
      repos: { 'repo-a': 'git@github.com:org/repo-a.git' },
    };

    const results = await callback(['nx.json'], options, mockContext);

    expect(results).toHaveLength(1);

    const firstResult = results[0];
    expect(firstResult).toBeDefined();

    if (!firstResult) {
      return;
    }

    expect(firstResult[0]).toBe('nx.json');

    const createNodesResult = firstResult[1];

    const projects = createNodesResult.projects;
    expect(projects).toBeDefined();

    const rootProject = projects?.['.'];
    expect(rootProject).toBeDefined();

    const targets = rootProject?.targets;

    expect(targets).toBeDefined();
    expect(targets?.['polyrepo-sync']).toEqual({
      executor: '@op-nx/polyrepo:sync',
      options: {},
    });
    expect(targets?.['polyrepo-status']).toEqual({
      executor: '@op-nx/polyrepo:status',
      options: {},
    });
  });

  it('calls populateGraphReport with config, workspaceRoot, and options hash', async () => {
    const { mockedPopulateGraphReport, mockContext } = setup();

    mockedPopulateGraphReport.mockResolvedValue({ repos: {} });

    const [, callback] = createNodesV2;

    const options = {
      repos: { 'repo-a': 'git@github.com:org/repo-a.git' },
    };

    await callback(['nx.json'], options, mockContext);

    expect(mockedPopulateGraphReport).toHaveBeenCalledTimes(1);
    expect(mockedPopulateGraphReport).toHaveBeenCalledWith(
      options,
      '/workspace',
      'mock-hash',
    );
  });

  it('registers external projects from graph report alongside root project', async () => {
    const { mockedPopulateGraphReport, mockContext } = setup();

    const report: PolyrepoGraphReport = {
      repos: {
        'repo-a': {
          nodes: {
            'repo-a/my-lib': {
              name: 'repo-a/my-lib',
              root: '.repos/repo-a/libs/my-lib',
              projectType: 'library',
              sourceRoot: '.repos/repo-a/libs/my-lib/src',
              targets: {
                build: {
                  executor: '@op-nx/polyrepo:run',
                  options: {
                    repoAlias: 'repo-a',
                    originalProject: 'my-lib',
                    targetName: 'build',
                  },
                },
              },
              tags: ['scope:shared', 'polyrepo:external', 'polyrepo:repo-a'],
              metadata: { description: 'My library' },
            },
            'repo-a/my-app': {
              name: 'repo-a/my-app',
              root: '.repos/repo-a/apps/my-app',
              projectType: 'application',
              sourceRoot: '.repos/repo-a/apps/my-app/src',
              targets: {
                serve: {
                  executor: '@op-nx/polyrepo:run',
                  options: {
                    repoAlias: 'repo-a',
                    originalProject: 'my-app',
                    targetName: 'serve',
                  },
                },
              },
              tags: ['polyrepo:external', 'polyrepo:repo-a'],
            },
          },
          dependencies: [],
        },
      },
    };

    mockedPopulateGraphReport.mockResolvedValue(report);

    const [, callback] = createNodesV2;

    const options = {
      repos: { 'repo-a': 'git@github.com:org/repo-a.git' },
    };

    const results = await callback(['nx.json'], options, mockContext);
    const firstResult = results[0];

    if (!firstResult) {
      throw new Error('Expected at least one result');
    }

    const projects = firstResult[1].projects ?? {};

    // Root project still there
    expect(projects['.']).toBeDefined();
    expect(projects['.']?.targets?.['polyrepo-sync']).toBeDefined();

    // External projects registered by root path
    const myLib = projects['.repos/repo-a/libs/my-lib'];
    expect(myLib).toBeDefined();
    expect(myLib?.name).toBe('repo-a/my-lib');
    expect(myLib?.projectType).toBe('library');
    expect(myLib?.sourceRoot).toBe('.repos/repo-a/libs/my-lib/src');
    expect(myLib?.tags).toEqual([
      'scope:shared',
      'polyrepo:external',
      'polyrepo:repo-a',
    ]);
    expect(myLib?.metadata).toEqual({
      description: 'My library',
    });
    expect(myLib?.targets?.['build']).toBeDefined();

    const myApp = projects['.repos/repo-a/apps/my-app'];
    expect(myApp).toBeDefined();
    expect(myApp?.name).toBe('repo-a/my-app');
    expect(myApp?.projectType).toBe('application');
  });

  it('registers only root project when graph report has empty repos', async () => {
    const { mockedPopulateGraphReport, mockContext } = setup();

    mockedPopulateGraphReport.mockResolvedValue({ repos: {} });

    const [, callback] = createNodesV2;

    const options = {
      repos: { 'repo-a': 'git@github.com:org/repo-a.git' },
    };

    const results = await callback(['nx.json'], options, mockContext);
    const firstResult = results[0];

    if (!firstResult) {
      throw new Error('Expected at least one result');
    }

    const projects = firstResult[1].projects ?? {};

    expect(Object.keys(projects)).toEqual(['.']);
  });

  it('logs warning and registers only root project when populateGraphReport throws', async () => {
    const { mockedPopulateGraphReport, mockedLoggerWarn, mockContext } = setup();

    mockedPopulateGraphReport.mockRejectedValue(new Error('extraction failed'));

    const [, callback] = createNodesV2;

    const options = {
      repos: { 'repo-a': 'git@github.com:org/repo-a.git' },
    };

    const results = await callback(['nx.json'], options, mockContext);
    const firstResult = results[0];

    if (!firstResult) {
      throw new Error('Expected at least one result');
    }

    const projects = firstResult[1].projects ?? {};

    // Only root project registered
    expect(Object.keys(projects)).toEqual(['.']);

    // Warning logged
    expect(mockedLoggerWarn).toHaveBeenCalledWith(
      expect.stringContaining('extraction failed'),
    );
  });
});

describe('createDependencies', () => {
  it('returns implicit dependencies from graph report', async () => {
    const { mockedPopulateGraphReport } = setup();

    const report: PolyrepoGraphReport = {
      repos: {
        'repo-a': {
          nodes: {},
          dependencies: [
            {
              source: 'repo-a/my-app',
              target: 'repo-a/my-lib',
              type: 'static',
            },
          ],
        },
      },
    };

    mockedPopulateGraphReport.mockResolvedValue(report);

    const depContext = createDepContext({
      'repo-a/my-app': {
        root: '.repos/repo-a/apps/my-app',
      },
      'repo-a/my-lib': {
        root: '.repos/repo-a/libs/my-lib',
      },
    });

    const options = {
      repos: { 'repo-a': 'git@github.com:org/repo-a.git' },
    };

    const deps = await createDependencies(options, depContext);

    expect(deps).toHaveLength(1);
    expect(deps[0]).toEqual({
      source: 'repo-a/my-app',
      target: 'repo-a/my-lib',
      type: 'implicit',
    });
  });

  it('only includes edges where both source and target exist in context.projects', async () => {
    const { mockedPopulateGraphReport } = setup();

    const report: PolyrepoGraphReport = {
      repos: {
        'repo-a': {
          nodes: {},
          dependencies: [
            {
              source: 'repo-a/my-app',
              target: 'repo-a/missing-lib',
              type: 'static',
            },
            {
              source: 'repo-a/my-app',
              target: 'repo-a/my-lib',
              type: 'static',
            },
          ],
        },
      },
    };

    mockedPopulateGraphReport.mockResolvedValue(report);

    const depContext = createDepContext({
      'repo-a/my-app': {
        root: '.repos/repo-a/apps/my-app',
      },
      'repo-a/my-lib': {
        root: '.repos/repo-a/libs/my-lib',
      },
      // 'repo-a/missing-lib' NOT in context
    });

    const options = {
      repos: { 'repo-a': 'git@github.com:org/repo-a.git' },
    };

    const deps = await createDependencies(options, depContext);

    expect(deps).toHaveLength(1);
    expect(deps[0]).toEqual(expect.objectContaining({ target: 'repo-a/my-lib' }));
  });

  it('returns empty array when populateGraphReport fails', async () => {
    const { mockedPopulateGraphReport } = setup();

    mockedPopulateGraphReport.mockRejectedValue(new Error('extraction failed'));

    const depContext = createDepContext({});

    const options = {
      repos: { 'repo-a': 'git@github.com:org/repo-a.git' },
    };

    const deps = await createDependencies(options, depContext);

    expect(deps).toEqual([]);
  });

  it('returns empty array when no graph report exists (no synced repos)', async () => {
    const { mockedPopulateGraphReport } = setup();

    mockedPopulateGraphReport.mockResolvedValue({ repos: {} });

    const depContext = createDepContext({});

    const options = {
      repos: { 'repo-a': 'git@github.com:org/repo-a.git' },
    };

    const deps = await createDependencies(options, depContext);

    expect(deps).toEqual([]);
  });
});
