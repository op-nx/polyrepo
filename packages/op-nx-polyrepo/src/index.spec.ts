import { describe, it, expect, vi } from 'vitest';
import type {
  CreateNodesContextV2,
  CreateDependenciesContext,
} from '@nx/devkit';
import type * as NodeFsPromises from 'node:fs/promises';
import type * as NodeFs from 'node:fs';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof NodeFsPromises>();

  return {
    ...actual,
    readFile: vi.fn<(path: string, options?: unknown) => Promise<string>>(),
  };
});

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof NodeFs>();

  return {
    ...actual,
    existsSync: vi.fn<(path: string) => boolean>(),
  };
});

vi.mock('@nx/devkit', () => ({
  logger: {
    warn: vi.fn<(...args: unknown[]) => void>(),
    info: vi.fn<(...args: unknown[]) => void>(),
    error: vi.fn<(...args: unknown[]) => void>(),
  },
  DependencyType: {
    static: 'static',
    dynamic: 'dynamic',
    implicit: 'implicit',
  },
}));

vi.mock('nx/src/devkit-internals', () => ({
  hashObject: vi.fn<(...args: unknown[]) => string>(),
}));

vi.mock('./lib/graph/cache', () => ({
  populateGraphReport: vi.fn<typeof populateGraphReport>(),
}));

import { createNodesV2, createDependencies } from './index';
import { logger } from '@nx/devkit';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { hashObject } from 'nx/src/devkit-internals';
import { populateGraphReport } from './lib/graph/cache';
import type { PolyrepoGraphReport } from './lib/graph/types';
import { assertDefined } from './lib/testing/asserts';

function setup() {
  vi.clearAllMocks();

  const mockedReadFile = vi.mocked(readFile);
  const mockedExistsSync = vi.mocked(existsSync);
  const mockedHashObject = vi.mocked(hashObject);
  const mockedPopulateGraphReport = vi.mocked(populateGraphReport);
  const mockedLoggerWarn = vi.mocked(logger.warn);

  mockedReadFile.mockResolvedValue('.repos/\nnode_modules\n');
  mockedExistsSync.mockReturnValue(true);
  mockedHashObject.mockReturnValue('mock-hash');

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

describe(createDependencies, () => {
  it('is a describe placeholder for createNodesV2 tuple — see below', () => {
    // createNodesV2 is a tuple, not a function, so we use createDependencies
    // as the outer describe grouping and describe createNodesV2 inline.
    expect(true).toBe(true);
  });
});

describe('createNodesV2 plugin', () => {
  it('is exported as a tuple with nx.json glob', () => {
    const [glob] = createNodesV2;

    expect(glob).toBe('nx.json');
  });

  it('callback throws for invalid config (no repos key)', async () => {
    expect.hasAssertions();

    const { mockContext } = setup();

    const [, callback] = createNodesV2;

    await expect(
      callback(['nx.json'], undefined, mockContext),
    ).rejects.toThrowError('Invalid @op-nx/polyrepo config');
  });

  it('callback returns polyrepo-sync and polyrepo-status targets on root project', async () => {
    expect.hasAssertions();

    const { mockedPopulateGraphReport, mockContext } = setup();

    mockedPopulateGraphReport.mockResolvedValue({ repos: {} });

    const [, callback] = createNodesV2;

    const options = {
      repos: { 'repo-a': 'git@github.com:org/repo-a.git' },
    };

    const results = await callback(['nx.json'], options, mockContext);

    expect(results).toHaveLength(1);

    const firstResult = results[0];

    assertDefined(firstResult, 'Expected at least one result');

    expect(firstResult[0]).toBe('nx.json');

    const createNodesResult = firstResult[1];

    const projects = createNodesResult.projects;

    expect(projects).toBeDefined();

    const rootProject = projects?.['.'];

    expect(rootProject).toBeDefined();

    const targets = rootProject?.targets;

    expect(targets).toBeDefined();
    expect(targets?.['polyrepo-sync']).toStrictEqual({
      executor: '@op-nx/polyrepo:sync',
      options: {},
    });
    expect(targets?.['polyrepo-status']).toStrictEqual({
      executor: '@op-nx/polyrepo:status',
      options: {},
    });
  });

  it('calls populateGraphReport with config, workspaceRoot, and options hash', async () => {
    expect.hasAssertions();

    const { mockedPopulateGraphReport, mockContext } = setup();

    mockedPopulateGraphReport.mockResolvedValue({ repos: {} });

    const [, callback] = createNodesV2;

    const options = {
      repos: { 'repo-a': 'git@github.com:org/repo-a.git' },
    };

    await callback(['nx.json'], options, mockContext);

    expect(mockedPopulateGraphReport).toHaveBeenCalledExactlyOnceWith(options, '/workspace', 'mock-hash');
  });

  it('registers external projects from graph report alongside root project', async () => {
    expect.hasAssertions();

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

    assertDefined(firstResult, 'Expected at least one result');

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
    expect(myLib?.tags).toStrictEqual([
      'scope:shared',
      'polyrepo:external',
      'polyrepo:repo-a',
    ]);
    expect(myLib?.metadata).toStrictEqual({
      description: 'My library',
    });
    expect(myLib?.targets?.['build']).toBeDefined();
  });

  it('registers external app project from graph report', async () => {
    expect.hasAssertions();

    const { mockedPopulateGraphReport, mockContext } = setup();

    const report: PolyrepoGraphReport = {
      repos: {
        'repo-a': {
          nodes: {
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

    assertDefined(firstResult, 'Expected at least one result');

    const projects = firstResult[1].projects ?? {};
    const myApp = projects['.repos/repo-a/apps/my-app'];

    expect(myApp).toBeDefined();
    expect(myApp?.name).toBe('repo-a/my-app');
    expect(myApp?.projectType).toBe('application');
  });

  it('registers only root project when graph report has empty repos', async () => {
    expect.hasAssertions();

    const { mockedPopulateGraphReport, mockContext } = setup();

    mockedPopulateGraphReport.mockResolvedValue({ repos: {} });

    const [, callback] = createNodesV2;

    const options = {
      repos: { 'repo-a': 'git@github.com:org/repo-a.git' },
    };

    const results = await callback(['nx.json'], options, mockContext);
    const firstResult = results[0];

    assertDefined(firstResult, 'Expected at least one result');

    const projects = firstResult[1].projects ?? {};

    expect(Object.keys(projects)).toStrictEqual(['.']);
  });

  it('logs warning and registers only root project when populateGraphReport throws', async () => {
    expect.hasAssertions();

    const { mockedPopulateGraphReport, mockedLoggerWarn, mockContext } = setup();

    mockedPopulateGraphReport.mockRejectedValue(new Error('extraction failed'));

    const [, callback] = createNodesV2;

    const options = {
      repos: { 'repo-a': 'git@github.com:org/repo-a.git' },
    };

    const results = await callback(['nx.json'], options, mockContext);
    const firstResult = results[0];

    assertDefined(firstResult, 'Expected at least one result');

    const projects = firstResult[1].projects ?? {};

    // Only root project registered
    expect(Object.keys(projects)).toStrictEqual(['.']);

    // Warning logged
    expect(mockedLoggerWarn).toHaveBeenCalledWith(
      expect.stringContaining('extraction failed'),
    );
  });
});

describe(createDependencies, () => {
  it('returns implicit dependencies from graph report', async () => {
    expect.hasAssertions();

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
    expect(deps[0]).toStrictEqual({
      source: 'repo-a/my-app',
      target: 'repo-a/my-lib',
      type: 'implicit',
    });
  });

  it('only includes edges where both source and target exist in context.projects', async () => {
    expect.hasAssertions();

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
    expect(deps[0]).toStrictEqual(expect.objectContaining({ target: 'repo-a/my-lib' }));
  });

  it('returns empty array when populateGraphReport fails', async () => {
    expect.hasAssertions();

    const { mockedPopulateGraphReport } = setup();

    mockedPopulateGraphReport.mockRejectedValue(new Error('extraction failed'));

    const depContext = createDepContext({});

    const options = {
      repos: { 'repo-a': 'git@github.com:org/repo-a.git' },
    };

    const deps = await createDependencies(options, depContext);

    expect(deps).toStrictEqual([]);
  });

  it('returns empty array when no graph report exists (no synced repos)', async () => {
    expect.hasAssertions();

    const { mockedPopulateGraphReport } = setup();

    mockedPopulateGraphReport.mockResolvedValue({ repos: {} });

    const depContext = createDepContext({});

    const options = {
      repos: { 'repo-a': 'git@github.com:org/repo-a.git' },
    };

    const deps = await createDependencies(options, depContext);

    expect(deps).toStrictEqual([]);
  });
});
