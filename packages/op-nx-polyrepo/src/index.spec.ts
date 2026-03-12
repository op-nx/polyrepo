import { describe, it, expect, vi, beforeEach } from 'vitest';
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

const mockedPopulateGraphReport = vi.mocked(populateGraphReport);
const mockedLoggerWarn = vi.mocked(logger.warn);

const mockContext: CreateNodesContextV2 = {
  nxJsonConfiguration: {},
  workspaceRoot: '/workspace',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('createNodesV2', () => {
  it('is exported as a tuple with nx.json glob', () => {
    const [glob] = createNodesV2;

    expect(glob).toBe('nx.json');
  });

  it('callback throws for invalid config (no repos key)', async () => {
    const [, callback] = createNodesV2;

    await expect(
      callback(['nx.json'], {} as never, mockContext),
    ).rejects.toThrow();
  });

  it('callback returns polyrepo-sync and polyrepo-status targets on root project', async () => {
    mockedPopulateGraphReport.mockResolvedValue({ repos: {} });

    const [, callback] = createNodesV2;

    const options = {
      repos: { 'repo-a': 'git@github.com:org/repo-a.git' },
    };

    const results = await callback(['nx.json'], options, mockContext);

    expect(results).toHaveLength(1);
    expect(results[0][0]).toBe('nx.json');

    const createNodesResult = results[0][1];

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
    const projects = results[0][1].projects ?? {};

    // Root project still there
    expect(projects['.']).toBeDefined();
    expect(projects['.'].targets?.['polyrepo-sync']).toBeDefined();

    // External projects registered by root path
    const myLib = projects['.repos/repo-a/libs/my-lib'];
    expect(myLib).toBeDefined();
    expect(myLib.name).toBe('repo-a/my-lib');
    expect(myLib.projectType).toBe('library');
    expect(myLib.sourceRoot).toBe('.repos/repo-a/libs/my-lib/src');
    expect(myLib.tags).toEqual([
      'scope:shared',
      'polyrepo:external',
      'polyrepo:repo-a',
    ]);
    expect(myLib.metadata).toEqual({
      description: 'My library',
    });
    expect(myLib.targets?.['build']).toBeDefined();

    const myApp = projects['.repos/repo-a/apps/my-app'];
    expect(myApp).toBeDefined();
    expect(myApp.name).toBe('repo-a/my-app');
    expect(myApp.projectType).toBe('application');
  });

  it('registers only root project when graph report has empty repos', async () => {
    mockedPopulateGraphReport.mockResolvedValue({ repos: {} });

    const [, callback] = createNodesV2;

    const options = {
      repos: { 'repo-a': 'git@github.com:org/repo-a.git' },
    };

    const results = await callback(['nx.json'], options, mockContext);
    const projects = results[0][1].projects ?? {};

    expect(Object.keys(projects)).toEqual(['.']);
  });

  it('logs warning and registers only root project when populateGraphReport throws', async () => {
    mockedPopulateGraphReport.mockRejectedValue(
      new Error('extraction failed'),
    );

    const [, callback] = createNodesV2;

    const options = {
      repos: { 'repo-a': 'git@github.com:org/repo-a.git' },
    };

    const results = await callback(['nx.json'], options, mockContext);
    const projects = results[0][1].projects ?? {};

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

    const depContext: CreateDependenciesContext = {
      projects: {
        'repo-a/my-app': {
          root: '.repos/repo-a/apps/my-app',
        },
        'repo-a/my-lib': {
          root: '.repos/repo-a/libs/my-lib',
        },
      },
      nxJsonConfiguration: {},
      workspaceRoot: '/workspace',
      externalNodes: {},
      fileMap: { projectFileMap: {}, nonProjectFiles: [] },
      filesToProcess: { projectFileMap: {}, nonProjectFiles: [] },
    };

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

    const depContext: CreateDependenciesContext = {
      projects: {
        'repo-a/my-app': {
          root: '.repos/repo-a/apps/my-app',
        },
        'repo-a/my-lib': {
          root: '.repos/repo-a/libs/my-lib',
        },
        // 'repo-a/missing-lib' NOT in context
      },
      nxJsonConfiguration: {},
      workspaceRoot: '/workspace',
      externalNodes: {},
      fileMap: { projectFileMap: {}, nonProjectFiles: [] },
      filesToProcess: { projectFileMap: {}, nonProjectFiles: [] },
    };

    const options = {
      repos: { 'repo-a': 'git@github.com:org/repo-a.git' },
    };

    const deps = await createDependencies(options, depContext);

    expect(deps).toHaveLength(1);
    expect(deps[0].target).toBe('repo-a/my-lib');
  });

  it('returns empty array when populateGraphReport fails', async () => {
    mockedPopulateGraphReport.mockRejectedValue(
      new Error('extraction failed'),
    );

    const depContext: CreateDependenciesContext = {
      projects: {},
      nxJsonConfiguration: {},
      workspaceRoot: '/workspace',
      externalNodes: {},
      fileMap: { projectFileMap: {}, nonProjectFiles: [] },
      filesToProcess: { projectFileMap: {}, nonProjectFiles: [] },
    };

    const options = {
      repos: { 'repo-a': 'git@github.com:org/repo-a.git' },
    };

    const deps = await createDependencies(options, depContext);

    expect(deps).toEqual([]);
  });

  it('returns empty array when no graph report exists (no synced repos)', async () => {
    mockedPopulateGraphReport.mockResolvedValue({ repos: {} });

    const depContext: CreateDependenciesContext = {
      projects: {},
      nxJsonConfiguration: {},
      workspaceRoot: '/workspace',
      externalNodes: {},
      fileMap: { projectFileMap: {}, nonProjectFiles: [] },
      filesToProcess: { projectFileMap: {}, nonProjectFiles: [] },
    };

    const options = {
      repos: { 'repo-a': 'git@github.com:org/repo-a.git' },
    };

    const deps = await createDependencies(options, depContext);

    expect(deps).toEqual([]);
  });
});
