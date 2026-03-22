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

vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();

  return {
    ...actual,
    randomUUID: vi.fn<() => string>(),
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
  hashArray: vi.fn<(input: string[]) => string>(),
}));

vi.mock('nx/src/devkit-internals', () => ({
  hashObject: vi.fn<(...args: unknown[]) => string>(),
}));

vi.mock('./lib/graph/cache', () => ({
  populateGraphReport: vi.fn<typeof populateGraphReport>(),
}));

vi.mock('./lib/graph/detect', () => ({
  detectCrossRepoDependencies: vi.fn<typeof detectCrossRepoDependencies>(),
}));

vi.mock('./lib/config/schema', () => ({
  normalizeRepos: vi.fn<typeof normalizeRepos>(),
}));

vi.mock('./lib/git/detect', () => ({
  getHeadSha: vi.fn<typeof getHeadSha>(),
  getStatusPorcelain: vi.fn<typeof getStatusPorcelain>(),
}));

vi.mock('./lib/graph/proxy-hash', () => ({
  toProxyHashEnvKey: vi.fn<typeof toProxyHashEnvKey>(),
}));

import { createNodesV2, createDependencies, preTasksExecution } from './index';
import { DependencyType, logger, hashArray } from '@nx/devkit';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { hashObject } from 'nx/src/devkit-internals';
import { populateGraphReport } from './lib/graph/cache';
import { detectCrossRepoDependencies } from './lib/graph/detect';
import { normalizeRepos } from './lib/config/schema';
import { getHeadSha, getStatusPorcelain } from './lib/git/detect';
import { toProxyHashEnvKey } from './lib/graph/proxy-hash';
import type { PolyrepoGraphReport } from './lib/graph/types';
import type { PreTasksExecution } from 'nx/src/project-graph/plugins/public-api';
import { assertDefined } from './lib/testing/asserts';

function setup() {
  vi.clearAllMocks();

  const mockedReadFile = vi.mocked(readFile);
  const mockedExistsSync = vi.mocked(existsSync);
  const mockedHashObject = vi.mocked(hashObject);
  const mockedPopulateGraphReport = vi.mocked(populateGraphReport);
  const mockedDetectCrossRepoDeps = vi.mocked(detectCrossRepoDependencies);
  const mockedLoggerWarn = vi.mocked(logger.warn);

  mockedReadFile.mockResolvedValue('.repos/\nnode_modules\n');
  mockedExistsSync.mockReturnValue(true);
  mockedHashObject.mockReturnValue('mock-hash');
  mockedDetectCrossRepoDeps.mockReturnValue([]);

  const mockContext: CreateNodesContextV2 = {
    nxJsonConfiguration: {},
    workspaceRoot: '/workspace',
  };

  return {
    mockedPopulateGraphReport,
    mockedDetectCrossRepoDeps,
    mockedLoggerWarn,
    mockContext,
  };
}

/**
 * Create a minimal CreateDependenciesContext for testing.
 * Uses properly typed fields instead of stub casts.
 *
 * @param projects - Projects to register in `context.projects`
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
      cache: false,
      options: {},
    });
    expect(targets?.['polyrepo-status']).toStrictEqual({
      executor: '@op-nx/polyrepo:status',
      cache: false,
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

    expect(mockedPopulateGraphReport).toHaveBeenCalledExactlyOnceWith(
      options,
      '/workspace',
      'mock-hash',
    );
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
    expect(myLib?.namedInputs).toStrictEqual({ default: [] });
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

    const { mockedPopulateGraphReport, mockedLoggerWarn, mockContext } =
      setup();

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
    expect(deps[0]).toStrictEqual(
      expect.objectContaining({ target: 'repo-a/my-lib' }),
    );
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

  it('includes cross-repo edges from detectCrossRepoDependencies', async () => {
    expect.hasAssertions();

    const { mockedPopulateGraphReport, mockedDetectCrossRepoDeps } = setup();

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
    mockedDetectCrossRepoDeps.mockReturnValue([
      {
        source: 'host-app',
        target: 'repo-a/lib',
        type: DependencyType.static,
      },
    ]);

    const depContext = createDepContext({
      'host-app': { root: 'apps/host-app' },
      'repo-a/my-app': { root: '.repos/repo-a/apps/my-app' },
      'repo-a/my-lib': { root: '.repos/repo-a/libs/my-lib' },
      'repo-a/lib': { root: '.repos/repo-a/libs/lib' },
    });

    const options = {
      repos: { 'repo-a': 'git@github.com:org/repo-a.git' },
    };

    const deps = await createDependencies(options, depContext);

    // Should include both intra-repo implicit edge and cross-repo edge
    expect(deps).toContainEqual({
      source: 'repo-a/my-app',
      target: 'repo-a/my-lib',
      type: 'implicit',
    });
    expect(deps).toContainEqual({
      source: 'host-app',
      target: 'repo-a/lib',
      type: 'static',
    });
    expect(deps).toHaveLength(2);

    // Verify detectCrossRepoDependencies was called with correct arguments
    expect(mockedDetectCrossRepoDeps).toHaveBeenCalledExactlyOnceWith(
      report,
      expect.objectContaining({ repos: expect.any(Object) }),
      depContext,
    );
  });

  it('keeps cross-repo edges when target has no fileMap entry', async () => {
    expect.hasAssertions();

    const { mockedPopulateGraphReport, mockedDetectCrossRepoDeps } = setup();

    const report: PolyrepoGraphReport = {
      repos: {
        'repo-a': {
          nodes: {},
          dependencies: [],
        },
      },
    };

    mockedPopulateGraphReport.mockResolvedValue(report);
    mockedDetectCrossRepoDeps.mockReturnValue([
      {
        source: 'host-app',
        target: 'repo-a/lib',
        type: DependencyType.implicit,
      },
    ]);

    // Cross-repo edges target project nodes directly. The namedInputs
    // override on external projects prevents the native task hasher
    // from crashing on missing fileMap entries.
    const depContext = createDepContext({
      'host-app': { root: 'apps/host-app' },
      'repo-a/lib': { root: '.repos/repo-a/libs/lib' },
    });

    const options = {
      repos: { 'repo-a': 'git@github.com:org/repo-a.git' },
    };

    const deps = await createDependencies(options, depContext);

    expect(deps).toHaveLength(1);
    expect(deps[0]).toMatchObject({
      source: 'host-app',
      target: 'repo-a/lib',
      type: DependencyType.implicit,
    });
  });

  it('filters intra-repo edges where target is not in context.projects', async () => {
    expect.hasAssertions();

    const { mockedPopulateGraphReport } = setup();

    const report: PolyrepoGraphReport = {
      repos: {
        'repo-a': {
          nodes: {},
          dependencies: [
            {
              source: 'repo-a/my-app',
              target: 'repo-a/missing-project',
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

    // repo-a/missing-project is NOT registered in context.projects at all
    const depContext = createDepContext({
      'repo-a/my-app': { root: '.repos/repo-a/apps/my-app' },
      'repo-a/my-lib': { root: '.repos/repo-a/libs/my-lib' },
    });

    const options = {
      repos: { 'repo-a': 'git@github.com:org/repo-a.git' },
    };

    const deps = await createDependencies(options, depContext);

    // Only the edge to repo-a/my-lib should be included
    expect(deps).toHaveLength(1);
    expect(deps[0]).toStrictEqual({
      source: 'repo-a/my-app',
      target: 'repo-a/my-lib',
      type: 'implicit',
    });
  });

  it('propagates detectCrossRepoDependencies errors (OVRD-03)', async () => {
    expect.hasAssertions();

    const { mockedPopulateGraphReport, mockedDetectCrossRepoDeps } = setup();

    const report: PolyrepoGraphReport = {
      repos: {
        'repo-a': {
          nodes: {},
          dependencies: [],
        },
      },
    };

    mockedPopulateGraphReport.mockResolvedValue(report);
    mockedDetectCrossRepoDeps.mockImplementation(() => {
      throw new Error('Unknown project in overrides: bad-project');
    });

    const depContext = createDepContext({});

    const options = {
      repos: { 'repo-a': 'git@github.com:org/repo-a.git' },
    };

    await expect(createDependencies(options, depContext)).rejects.toThrowError(
      'Unknown project in overrides: bad-project',
    );
  });

  it('does not call detectCrossRepoDependencies when extraction fails', async () => {
    expect.hasAssertions();

    const { mockedPopulateGraphReport, mockedDetectCrossRepoDeps } = setup();

    mockedPopulateGraphReport.mockRejectedValue(new Error('extraction failed'));

    const depContext = createDepContext({});

    const options = {
      repos: { 'repo-a': 'git@github.com:org/repo-a.git' },
    };

    const deps = await createDependencies(options, depContext);

    expect(deps).toStrictEqual([]);
    expect(mockedDetectCrossRepoDeps).not.toHaveBeenCalled();
  });

  it('returns only intra-repo edges when detection returns empty', async () => {
    expect.hasAssertions();

    const { mockedPopulateGraphReport, mockedDetectCrossRepoDeps } = setup();

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
    mockedDetectCrossRepoDeps.mockReturnValue([]);

    const depContext = createDepContext({
      'repo-a/my-app': { root: '.repos/repo-a/apps/my-app' },
      'repo-a/my-lib': { root: '.repos/repo-a/libs/my-lib' },
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
});

describe('preTasksExecution', () => {
  const mockedNormalizeRepos = vi.mocked(normalizeRepos);
  const mockedGetHeadSha = vi.mocked(getHeadSha);
  const mockedGetStatusPorcelain = vi.mocked(getStatusPorcelain);
  const mockedHashArray = vi.mocked(hashArray);
  const mockedRandomUUID = vi.mocked(randomUUID);
  const mockedToProxyHashEnvKey = vi.mocked(toProxyHashEnvKey);
  const mockedExistsSync = vi.mocked(existsSync);
  const mockedLoggerWarn = vi.mocked(logger.warn);

  function setupPreTasksExecution() {
    vi.clearAllMocks();

    mockedToProxyHashEnvKey.mockImplementation(
      (alias: string) =>
        `POLYREPO_HASH_${alias.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`,
    );
    mockedExistsSync.mockReturnValue(true);
    mockedGetHeadSha.mockResolvedValue('abc123');
    mockedGetStatusPorcelain.mockResolvedValue('');
    mockedHashArray.mockReturnValue('deterministic-hash');
    mockedRandomUUID.mockReturnValue(
      '550e8400-e29b-41d4-a716-446655440000' as `${string}-${string}-${string}-${string}-${string}`,
    );
  }

  const baseContext = {
    id: 'test-id',
    workspaceRoot: '/workspace',
    nxJsonConfiguration: {},
    argv: [],
  };

  /**
   * Save and restore a process.env key around a test.
   */
  function withEnvCleanup(key: string): () => void {
    const saved = process.env[key];

    return () => {
      if (saved === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = saved;
      }
    };
  }

  it('sets env var to deterministic hash for synced repo with no dirty files', async () => {
    expect.hasAssertions();

    setupPreTasksExecution();
    mockedNormalizeRepos.mockReturnValue([
      {
        type: 'remote',
        alias: 'repo-a',
        url: 'https://github.com/org/repo-a.git',
        depth: 1,
        disableHooks: true,
      },
    ]);

    const cleanup = withEnvCleanup('POLYREPO_HASH_REPO_A');

    try {
      await preTasksExecution(
        { repos: { 'repo-a': 'https://github.com/org/repo-a.git' } },
        baseContext,
      );

      expect(process.env['POLYREPO_HASH_REPO_A']).toBe('deterministic-hash');
      expect(mockedHashArray).toHaveBeenCalledWith(['abc123', 'clean']);
    } finally {
      cleanup();
    }
  });

  it('sets env var to hash of HEAD + dirty for repo with modified files', async () => {
    expect.hasAssertions();

    setupPreTasksExecution();
    mockedGetStatusPorcelain.mockResolvedValue('M file.ts');
    mockedHashArray.mockReturnValue('dirty-hash');
    mockedNormalizeRepos.mockReturnValue([
      {
        type: 'remote',
        alias: 'repo-a',
        url: 'https://github.com/org/repo-a.git',
        depth: 1,
        disableHooks: true,
      },
    ]);

    const cleanup = withEnvCleanup('POLYREPO_HASH_REPO_A');

    try {
      await preTasksExecution(
        { repos: { 'repo-a': 'https://github.com/org/repo-a.git' } },
        baseContext,
      );

      expect(process.env['POLYREPO_HASH_REPO_A']).toBe('dirty-hash');
      expect(mockedHashArray).toHaveBeenCalledWith(['abc123', 'dirty']);
    } finally {
      cleanup();
    }
  });

  it('returns early when options is undefined (no env vars set)', async () => {
    expect.hasAssertions();

    setupPreTasksExecution();

    await preTasksExecution(undefined, baseContext);

    expect(mockedNormalizeRepos).not.toHaveBeenCalled();
  });

  it('returns early when options has no repos key', async () => {
    expect.hasAssertions();

    setupPreTasksExecution();

    await preTasksExecution(
      {} as Parameters<typeof preTasksExecution>[0],
      baseContext,
    );

    expect(mockedNormalizeRepos).not.toHaveBeenCalled();
  });

  it('sets env var to random UUID when getHeadSha throws', async () => {
    expect.hasAssertions();

    setupPreTasksExecution();
    mockedGetHeadSha.mockRejectedValue(new Error('git failed'));
    mockedNormalizeRepos.mockReturnValue([
      {
        type: 'remote',
        alias: 'repo-a',
        url: 'https://github.com/org/repo-a.git',
        depth: 1,
        disableHooks: true,
      },
    ]);

    const cleanup = withEnvCleanup('POLYREPO_HASH_REPO_A');

    try {
      await preTasksExecution(
        { repos: { 'repo-a': 'https://github.com/org/repo-a.git' } },
        baseContext,
      );

      expect(process.env['POLYREPO_HASH_REPO_A']).toBe(
        '550e8400-e29b-41d4-a716-446655440000',
      );
    } finally {
      cleanup();
    }
  });

  it('sets env var to random UUID when .git directory does not exist', async () => {
    expect.hasAssertions();

    setupPreTasksExecution();
    mockedExistsSync.mockReturnValue(false);
    mockedNormalizeRepos.mockReturnValue([
      {
        type: 'remote',
        alias: 'repo-a',
        url: 'https://github.com/org/repo-a.git',
        depth: 1,
        disableHooks: true,
      },
    ]);

    const cleanup = withEnvCleanup('POLYREPO_HASH_REPO_A');

    try {
      await preTasksExecution(
        { repos: { 'repo-a': 'https://github.com/org/repo-a.git' } },
        baseContext,
      );

      expect(process.env['POLYREPO_HASH_REPO_A']).toBe(
        '550e8400-e29b-41d4-a716-446655440000',
      );
      expect(mockedGetHeadSha).not.toHaveBeenCalled();
    } finally {
      cleanup();
    }
  });

  it('logs warning with alias name when git fails', async () => {
    expect.hasAssertions();

    setupPreTasksExecution();
    mockedGetHeadSha.mockRejectedValue(new Error('git failed'));
    mockedNormalizeRepos.mockReturnValue([
      {
        type: 'remote',
        alias: 'repo-a',
        url: 'https://github.com/org/repo-a.git',
        depth: 1,
        disableHooks: true,
      },
    ]);

    const cleanup = withEnvCleanup('POLYREPO_HASH_REPO_A');

    try {
      await preTasksExecution(
        { repos: { 'repo-a': 'https://github.com/org/repo-a.git' } },
        baseContext,
      );

      expect(mockedLoggerWarn).toHaveBeenCalledWith(
        expect.stringContaining("'repo-a'"),
      );
      expect(mockedLoggerWarn).toHaveBeenCalledWith(
        expect.stringContaining('polyrepo-sync'),
      );
    } finally {
      cleanup();
    }
  });

  it('does not log warning twice for same alias', async () => {
    expect.hasAssertions();

    setupPreTasksExecution();
    mockedExistsSync.mockReturnValue(false);
    mockedNormalizeRepos.mockReturnValue([
      {
        type: 'remote',
        alias: 'repo-a',
        url: 'https://github.com/org/repo-a.git',
        depth: 1,
        disableHooks: true,
      },
    ]);

    const cleanupA = withEnvCleanup('POLYREPO_HASH_REPO_A');

    try {
      // Call twice with same alias
      await preTasksExecution(
        { repos: { 'repo-a': 'https://github.com/org/repo-a.git' } },
        baseContext,
      );
      await preTasksExecution(
        { repos: { 'repo-a': 'https://github.com/org/repo-a.git' } },
        baseContext,
      );

      // Warning should only appear once for repo-a
      const repoAWarnings = mockedLoggerWarn.mock.calls.filter(
        (call) => typeof call[0] === 'string' && call[0].includes("'repo-a'"),
      );

      expect(repoAWarnings).toHaveLength(1);
    } finally {
      cleanupA();
    }
  });

  it('continues to next repo when one repo fails (per-repo isolation)', async () => {
    expect.hasAssertions();

    setupPreTasksExecution();
    mockedNormalizeRepos.mockReturnValue([
      {
        type: 'remote',
        alias: 'repo-a',
        url: 'https://github.com/org/repo-a.git',
        depth: 1,
        disableHooks: true,
      },
      {
        type: 'remote',
        alias: 'repo-b',
        url: 'https://github.com/org/repo-b.git',
        depth: 1,
        disableHooks: true,
      },
    ]);
    mockedGetHeadSha.mockRejectedValueOnce(new Error('git failed'));
    mockedGetHeadSha.mockResolvedValueOnce('def456');

    const cleanupA = withEnvCleanup('POLYREPO_HASH_REPO_A');
    const cleanupB = withEnvCleanup('POLYREPO_HASH_REPO_B');

    try {
      await preTasksExecution(
        {
          repos: {
            'repo-a': 'https://github.com/org/repo-a.git',
            'repo-b': 'https://github.com/org/repo-b.git',
          },
        },
        baseContext,
      );

      // repo-a failed -> UUID
      expect(process.env['POLYREPO_HASH_REPO_A']).toBe(
        '550e8400-e29b-41d4-a716-446655440000',
      );
      // repo-b succeeded -> deterministic hash
      expect(process.env['POLYREPO_HASH_REPO_B']).toBe('deterministic-hash');
    } finally {
      cleanupA();
      cleanupB();
    }
  });

  it('computes repo path as join(workspaceRoot, .repos, alias) for remote repos', async () => {
    expect.hasAssertions();

    setupPreTasksExecution();
    mockedNormalizeRepos.mockReturnValue([
      {
        type: 'remote',
        alias: 'repo-a',
        url: 'https://github.com/org/repo-a.git',
        depth: 1,
        disableHooks: true,
      },
    ]);

    const cleanup = withEnvCleanup('POLYREPO_HASH_REPO_A');

    try {
      await preTasksExecution(
        { repos: { 'repo-a': 'https://github.com/org/repo-a.git' } },
        baseContext,
      );

      // existsSync should be called with path joining workspaceRoot/.repos/repo-a/.git
      expect(mockedExistsSync).toHaveBeenCalledWith(
        expect.stringContaining('.repos'),
      );
      expect(mockedGetHeadSha).toHaveBeenCalledWith(
        expect.stringContaining('.repos'),
      );
    } finally {
      cleanup();
    }
  });

  it('uses entry.path directly for local repos', async () => {
    expect.hasAssertions();

    setupPreTasksExecution();
    mockedNormalizeRepos.mockReturnValue([
      {
        type: 'local',
        alias: 'local-repo',
        path: 'D:/projects/local-repo',
      },
    ]);

    const cleanup = withEnvCleanup('POLYREPO_HASH_LOCAL_REPO');

    try {
      await preTasksExecution(
        { repos: { 'local-repo': { path: 'D:/projects/local-repo' } } },
        baseContext,
      );

      expect(mockedGetHeadSha).toHaveBeenCalledWith('D:/projects/local-repo');
    } finally {
      cleanup();
    }
  });
});
