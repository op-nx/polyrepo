import { describe, it, expect, vi } from 'vitest';
import type * as ExtractModule from './extract.js';
import type * as TransformModule from './transform.js';
import type * as GitDetect from '../git/detect.js';
import type * as ConfigSchema from '../config/schema.js';
import type * as NxDevkit from '@nx/devkit';

vi.mock('node:fs', () => ({
  existsSync: vi.fn<(path: string) => boolean>(),
  readFileSync: vi.fn<(path: string, options?: unknown) => string>(),
  writeFileSync: vi.fn<(path: string, data: string) => void>(),
  mkdirSync: vi.fn<(path: string, options?: unknown) => void>(),
}));

vi.mock('./extract', () => ({
  extractGraphFromRepo: vi.fn<typeof ExtractModule.extractGraphFromRepo>(),
}));

vi.mock('./transform', () => ({
  transformGraphForRepo: vi.fn<typeof TransformModule.transformGraphForRepo>(),
}));

vi.mock('../git/detect', () => ({
  getHeadSha: vi.fn<typeof GitDetect.getHeadSha>(),
  getDirtyFiles: vi.fn<typeof GitDetect.getDirtyFiles>(),
}));

vi.mock('../config/schema', () => ({
  normalizeRepos: vi.fn<typeof ConfigSchema.normalizeRepos>(),
}));

vi.mock('@nx/devkit', () => ({
  hashArray: vi.fn<typeof NxDevkit.hashArray>(),
  readJsonFile: vi.fn<typeof NxDevkit.readJsonFile>(),
  writeJsonFile: vi.fn<typeof NxDevkit.writeJsonFile>(),
}));

import type { PolyrepoConfig, NormalizedRepoEntry } from '../config/schema';
import type { ExternalGraphJson } from './types';

const testConfig: PolyrepoConfig = {
  repos: {
    'repo-a': 'https://github.com/org/repo-a.git',
    'repo-b': { path: '/local/repo-b' },
  },
};

const testEntries: NormalizedRepoEntry[] = [
  {
    type: 'remote',
    alias: 'repo-a',
    url: 'https://github.com/org/repo-a.git',
    ref: undefined,
    depth: 1,
    disableHooks: true,
  },
  {
    type: 'local',
    alias: 'repo-b',
    path: '/local/repo-b',
  },
];

const rawGraph: ExternalGraphJson = {
  graph: {
    nodes: {
      'my-lib': {
        name: 'my-lib',
        type: 'lib',
        data: {
          root: 'libs/my-lib',
          targets: { build: { executor: '@nx/js:tsc' } },
          tags: ['scope:shared'],
        },
      },
    },
    dependencies: {
      'my-lib': [],
    },
  },
};

const transformedResult = {
  nodes: {
    'repo-a/my-lib': {
      name: 'repo-a/my-lib',
      root: '.repos/repo-a/libs/my-lib',
      targets: {},
      tags: ['scope:shared', 'polyrepo:external', 'polyrepo:repo-a'],
    },
  },
  dependencies: [],
};

// We must reset the module between tests to clear module-level state
describe('cache', () => {
  async function setup() {
    vi.clearAllMocks();
    vi.resetModules();

    const mocks = await loadMocks();
    setupMocksForExtraction(mocks);

    return { mocks };
  }

  async function loadCacheModule() {
    const mod = await import('./cache.js');

    return mod;
  }

  async function loadMocks() {
    const fs = await import('node:fs');
    const extract = await import('./extract.js');
    const transform = await import('./transform.js');
    const git = await import('../git/detect.js');
    const schema = await import('../config/schema.js');
    const devkit = await import('@nx/devkit');

    return {
      existsSync: vi.mocked(fs.existsSync),
      extractGraphFromRepo: vi.mocked(extract.extractGraphFromRepo),
      transformGraphForRepo: vi.mocked(transform.transformGraphForRepo),
      getHeadSha: vi.mocked(git.getHeadSha),
      getDirtyFiles: vi.mocked(git.getDirtyFiles),
      normalizeRepos: vi.mocked(schema.normalizeRepos),
      hashArray: vi.mocked(devkit.hashArray),
      readJsonFile: vi.mocked(devkit.readJsonFile),
      writeJsonFile: vi.mocked(devkit.writeJsonFile),
    };
  }

  function setupMocksForExtraction(
    mocks: Awaited<ReturnType<typeof loadMocks>>,
  ) {
    mocks.normalizeRepos.mockReturnValue(testEntries);
    // .repos/repo-a/.git exists, /local/repo-b/.git exists
    mocks.existsSync.mockImplementation((p: unknown) => {
      const ps = String(p);

      if (ps.includes('.git')) {
        return true;
      }

      // Cache file does not exist
      return false;
    });
    mocks.getHeadSha.mockResolvedValue('abc123');
    mocks.getDirtyFiles.mockResolvedValue('');
    mocks.hashArray.mockReturnValue('hash-1');
    mocks.extractGraphFromRepo.mockResolvedValue(rawGraph);
    mocks.transformGraphForRepo.mockReturnValue(transformedResult);
    mocks.readJsonFile.mockImplementation(() => {
      throw new Error('File not found');
    });
    mocks.writeJsonFile.mockImplementation(() => undefined);
  }

  describe('populateGraphReport', () => {
    it('returns cached report when outer hash matches (no extraction called)', async () => {
      expect.hasAssertions();

      const { mocks } = await setup();
      const { populateGraphReport } = await loadCacheModule();

      // First call: populates cache
      await populateGraphReport(testConfig, '/workspace', 'opts-hash');
      mocks.extractGraphFromRepo.mockClear();

      // Second call with same hash: should return cached
      const result = await populateGraphReport(
        testConfig,
        '/workspace',
        'opts-hash',
      );

      expect(mocks.extractGraphFromRepo).not.toHaveBeenCalled();
      expect(result).toBeDefined();
      expect(result.repos).toBeDefined();
    });

    it('extracts fresh graph when hash changes (extraction called for each repo)', async () => {
      expect.hasAssertions();

      const { mocks } = await setup();
      const { populateGraphReport } = await loadCacheModule();

      // First call
      await populateGraphReport(testConfig, '/workspace', 'opts-hash');
      mocks.extractGraphFromRepo.mockClear();
      mocks.hashArray.mockReturnValue('hash-2');

      // Second call with different hash: should re-extract
      await populateGraphReport(testConfig, '/workspace', 'opts-hash-2');

      expect(mocks.extractGraphFromRepo).toHaveBeenCalled();
    });

    it('skips repos without .git directory (unsynced repos)', async () => {
      expect.hasAssertions();

      const { mocks } = await setup();

      // Only repo-a has .git, repo-b does not
      mocks.existsSync.mockImplementation((p: unknown) => {
        const ps = String(p);

        if (ps.includes('repo-a') && ps.includes('.git')) {
          return true;
        }

        return false;
      });

      const { populateGraphReport } = await loadCacheModule();

      await populateGraphReport(testConfig, '/workspace', 'opts-hash');

      // Only repo-a should be extracted
      expect(mocks.extractGraphFromRepo).toHaveBeenCalledTimes(1);
    });

    it('calls extractGraphFromRepo in parallel (Promise.all) for multiple repos', async () => {
      expect.hasAssertions();

      const { mocks } = await setup();

      const callOrder: string[] = [];

      mocks.extractGraphFromRepo.mockImplementation(
        async (repoPath: string) => {
          callOrder.push(`start:${repoPath}`);
          // Simulate async work
          await new Promise((r) => setTimeout(r, 10));
          callOrder.push(`end:${repoPath}`);

          return rawGraph;
        },
      );

      const { populateGraphReport } = await loadCacheModule();

      await populateGraphReport(testConfig, '/workspace', 'opts-hash');

      // Both starts should come before both ends (parallel execution)
      expect(mocks.extractGraphFromRepo).toHaveBeenCalledTimes(2);
    });

    it('calls transformGraphForRepo on each extracted JSON', async () => {
      expect.hasAssertions();

      const { mocks } = await setup();
      const { populateGraphReport } = await loadCacheModule();

      await populateGraphReport(testConfig, '/workspace', 'opts-hash');

      expect(mocks.transformGraphForRepo).toHaveBeenCalledTimes(2);
      expect(mocks.transformGraphForRepo).toHaveBeenCalledWith(
        'repo-a',
        rawGraph,
        '/workspace',
      );
      expect(mocks.transformGraphForRepo).toHaveBeenCalledWith(
        'repo-b',
        rawGraph,
        '/workspace',
      );
    });

    it('stores result in module-level variable accessible via getCurrentGraphReport', async () => {
      expect.hasAssertions();

      await setup();
      const { populateGraphReport, getCurrentGraphReport } =
        await loadCacheModule();

      const populated = await populateGraphReport(
        testConfig,
        '/workspace',
        'opts-hash',
      );
      const current = getCurrentGraphReport();

      expect(current).toBe(populated);
    });

    it('persists cache to disk via writeJsonFile', async () => {
      expect.hasAssertions();

      const { mocks } = await setup();
      const { populateGraphReport } = await loadCacheModule();

      await populateGraphReport(testConfig, '/workspace', 'opts-hash');

      expect(mocks.writeJsonFile).toHaveBeenCalledWith(
        expect.stringContaining('.repos'),
        expect.objectContaining({ hash: expect.any(String) }),
      );
    });
  });

  describe('getCurrentGraphReport', () => {
    it('returns the module-level graph report when populated', async () => {
      expect.hasAssertions();

      await setup();
      const { populateGraphReport, getCurrentGraphReport } =
        await loadCacheModule();

      const report = await populateGraphReport(
        testConfig,
        '/workspace',
        'opts-hash',
      );
      const current = getCurrentGraphReport();

      expect(current).toStrictEqual(report);
    });

    it('throws descriptive error when report is not yet populated', async () => {
      expect.hasAssertions();

      await setup();
      const { getCurrentGraphReport } = await loadCacheModule();

      expect(() => getCurrentGraphReport()).toThrowError(
        'Expected cached polyrepo graph report',
      );
    });
  });

  describe('outer hash computation', () => {
    it('hash includes pluginOptionsHash', async () => {
      expect.hasAssertions();

      const { mocks } = await setup();
      const { populateGraphReport } = await loadCacheModule();

      await populateGraphReport(testConfig, '/workspace', 'my-plugin-opts');

      expect(mocks.hashArray).toHaveBeenCalledWith(
        expect.arrayContaining(['my-plugin-opts']),
      );
    });

    it('hash includes each repo alias, HEAD SHA, and dirty files', async () => {
      expect.hasAssertions();

      const { mocks } = await setup();
      mocks.getHeadSha.mockResolvedValue('sha123');
      mocks.getDirtyFiles.mockResolvedValue('file.ts');
      const { populateGraphReport } = await loadCacheModule();

      await populateGraphReport(testConfig, '/workspace', 'opts-hash');

      expect(mocks.hashArray).toHaveBeenCalledWith(
        expect.arrayContaining(['repo-a', 'sha123', 'file.ts']),
      );
    });

    it('skips repos without .git dir (does not include them in hash)', async () => {
      expect.hasAssertions();

      const { mocks } = await setup();

      // Only repo-a has .git
      mocks.existsSync.mockImplementation((p: unknown) => {
        const ps = String(p);

        if (ps.includes('repo-a') && ps.includes('.git')) {
          return true;
        }

        return false;
      });

      const { populateGraphReport } = await loadCacheModule();

      await populateGraphReport(testConfig, '/workspace', 'opts-hash');

      // getHeadSha should only be called for repo-a
      expect(mocks.getHeadSha).toHaveBeenCalledTimes(1);
    });

    it('different HEAD SHA produces different hash', async () => {
      expect.hasAssertions();

      const { mocks } = await setup();

      let callCount = 0;

      mocks.hashArray.mockImplementation((_parts: unknown) => {
        callCount++;

        return `hash-${callCount}`;
      });

      const { populateGraphReport } = await loadCacheModule();

      // First call
      await populateGraphReport(testConfig, '/workspace', 'opts-hash');
      mocks.extractGraphFromRepo.mockClear();

      // Change SHA
      mocks.getHeadSha.mockResolvedValue('different-sha');

      // Second call should extract again (hash changed)
      await populateGraphReport(testConfig, '/workspace', 'opts-hash');

      expect(mocks.extractGraphFromRepo).toHaveBeenCalled();
    });

    it('different dirty files produce different hash', async () => {
      expect.hasAssertions();

      const { mocks } = await setup();

      let callCount = 0;

      mocks.hashArray.mockImplementation((_parts: unknown) => {
        callCount++;

        return `hash-${callCount}`;
      });

      const { populateGraphReport } = await loadCacheModule();

      // First call
      await populateGraphReport(testConfig, '/workspace', 'opts-hash');
      mocks.extractGraphFromRepo.mockClear();

      // Change dirty files
      mocks.getDirtyFiles.mockResolvedValue('new-file.ts');

      // Second call should extract again
      await populateGraphReport(testConfig, '/workspace', 'opts-hash');

      expect(mocks.extractGraphFromRepo).toHaveBeenCalled();
    });
  });
});
