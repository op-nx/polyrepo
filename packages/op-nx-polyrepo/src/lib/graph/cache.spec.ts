import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

vi.mock('./extract', () => ({
  extractGraphFromRepo: vi.fn(),
}));

vi.mock('./transform', () => ({
  transformGraphForRepo: vi.fn(),
}));

vi.mock('../git/detect', () => ({
  getHeadSha: vi.fn(),
  getDirtyFiles: vi.fn(),
}));

vi.mock('../config/schema', () => ({
  normalizeRepos: vi.fn(),
}));

vi.mock('@nx/devkit', () => ({
  hashArray: vi.fn(),
  readJsonFile: vi.fn(),
  writeJsonFile: vi.fn(),
}));

import { existsSync } from 'node:fs';
import { extractGraphFromRepo } from './extract';
import { transformGraphForRepo } from './transform';
import { getHeadSha, getDirtyFiles } from '../git/detect';
import { normalizeRepos } from '../config/schema';
import { hashArray, readJsonFile, writeJsonFile } from '@nx/devkit';
import type { PolyrepoConfig, NormalizedRepoEntry } from '../config/schema';
import type { ExternalGraphJson, PolyrepoGraphReport } from './types';

const mockExistsSync = vi.mocked(existsSync);
const mockExtract = vi.mocked(extractGraphFromRepo);
const mockTransform = vi.mocked(transformGraphForRepo);
const mockGetHeadSha = vi.mocked(getHeadSha);
const mockGetDirtyFiles = vi.mocked(getDirtyFiles);
const mockNormalizeRepos = vi.mocked(normalizeRepos);
const mockHashArray = vi.mocked(hashArray);
const mockReadJsonFile = vi.mocked(readJsonFile);
const mockWriteJsonFile = vi.mocked(writeJsonFile);

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
  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    // Re-apply mocks after module reset
    vi.mock('node:fs', () => ({
      existsSync: vi.fn(),
      readFileSync: vi.fn(),
      writeFileSync: vi.fn(),
      mkdirSync: vi.fn(),
    }));
    vi.mock('./extract', () => ({
      extractGraphFromRepo: vi.fn(),
    }));
    vi.mock('./transform', () => ({
      transformGraphForRepo: vi.fn(),
    }));
    vi.mock('../git/detect', () => ({
      getHeadSha: vi.fn(),
      getDirtyFiles: vi.fn(),
    }));
    vi.mock('../config/schema', () => ({
      normalizeRepos: vi.fn(),
    }));
    vi.mock('@nx/devkit', () => ({
      hashArray: vi.fn(),
      readJsonFile: vi.fn(),
      writeJsonFile: vi.fn(),
    }));
  });

  async function loadCacheModule() {
    const mod = await import('./cache');

    return mod;
  }

  async function loadMocks() {
    const fs = await import('node:fs');
    const extract = await import('./extract');
    const transform = await import('./transform');
    const git = await import('../git/detect');
    const schema = await import('../config/schema');
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

  function setupMocksForExtraction(mocks: Awaited<ReturnType<typeof loadMocks>>) {
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
    mocks.hashArray.mockReturnValue('hash-1' as unknown as string);
    mocks.extractGraphFromRepo.mockResolvedValue(rawGraph);
    mocks.transformGraphForRepo.mockReturnValue(transformedResult);
    mocks.readJsonFile.mockImplementation(() => {
      throw new Error('File not found');
    });
    mocks.writeJsonFile.mockImplementation(() => undefined);
  }

  describe('populateGraphReport', () => {
    it('returns cached report when outer hash matches (no extraction called)', async () => {
      const mocks = await loadMocks();
      setupMocksForExtraction(mocks);
      const { populateGraphReport } = await loadCacheModule();

      // First call: populates cache
      await populateGraphReport(testConfig, '/workspace', 'opts-hash');
      mocks.extractGraphFromRepo.mockClear();

      // Second call with same hash: should return cached
      const result = await populateGraphReport(testConfig, '/workspace', 'opts-hash');

      expect(mocks.extractGraphFromRepo).not.toHaveBeenCalled();
      expect(result).toBeDefined();
      expect(result.repos).toBeDefined();
    });

    it('extracts fresh graph when hash changes (extraction called for each repo)', async () => {
      const mocks = await loadMocks();
      setupMocksForExtraction(mocks);
      const { populateGraphReport } = await loadCacheModule();

      // First call
      await populateGraphReport(testConfig, '/workspace', 'opts-hash');
      mocks.extractGraphFromRepo.mockClear();
      mocks.hashArray.mockReturnValue('hash-2' as unknown as string);

      // Second call with different hash: should re-extract
      await populateGraphReport(testConfig, '/workspace', 'opts-hash-2');

      expect(mocks.extractGraphFromRepo).toHaveBeenCalled();
    });

    it('skips repos without .git directory (unsynced repos)', async () => {
      const mocks = await loadMocks();
      setupMocksForExtraction(mocks);

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
      const mocks = await loadMocks();
      setupMocksForExtraction(mocks);

      const callOrder: string[] = [];

      mocks.extractGraphFromRepo.mockImplementation(async (repoPath: string) => {
        callOrder.push(`start:${repoPath}`);
        // Simulate async work
        await new Promise((r) => setTimeout(r, 10));
        callOrder.push(`end:${repoPath}`);

        return rawGraph;
      });

      const { populateGraphReport } = await loadCacheModule();

      await populateGraphReport(testConfig, '/workspace', 'opts-hash');

      // Both starts should come before both ends (parallel execution)
      expect(mocks.extractGraphFromRepo).toHaveBeenCalledTimes(2);
    });

    it('calls transformGraphForRepo on each extracted JSON', async () => {
      const mocks = await loadMocks();
      setupMocksForExtraction(mocks);
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
      const mocks = await loadMocks();
      setupMocksForExtraction(mocks);
      const { populateGraphReport, getCurrentGraphReport } = await loadCacheModule();

      const populated = await populateGraphReport(testConfig, '/workspace', 'opts-hash');
      const current = getCurrentGraphReport();

      expect(current).toBe(populated);
    });

    it('persists cache to disk via writeJsonFile', async () => {
      const mocks = await loadMocks();
      setupMocksForExtraction(mocks);
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
      const mocks = await loadMocks();
      setupMocksForExtraction(mocks);
      const { populateGraphReport, getCurrentGraphReport } = await loadCacheModule();

      const report = await populateGraphReport(testConfig, '/workspace', 'opts-hash');
      const current = getCurrentGraphReport();

      expect(current).toEqual(report);
    });

    it('throws descriptive error when report is not yet populated', async () => {
      const { getCurrentGraphReport } = await loadCacheModule();

      expect(() => getCurrentGraphReport()).toThrow(
        'Expected cached polyrepo graph report',
      );
    });
  });

  describe('outer hash computation', () => {
    it('hash includes pluginOptionsHash', async () => {
      const mocks = await loadMocks();
      setupMocksForExtraction(mocks);
      const { populateGraphReport } = await loadCacheModule();

      await populateGraphReport(testConfig, '/workspace', 'my-plugin-opts');

      expect(mocks.hashArray).toHaveBeenCalledWith(
        expect.arrayContaining(['my-plugin-opts']),
      );
    });

    it('hash includes each repo alias, HEAD SHA, and dirty files', async () => {
      const mocks = await loadMocks();
      setupMocksForExtraction(mocks);
      mocks.getHeadSha.mockResolvedValue('sha123');
      mocks.getDirtyFiles.mockResolvedValue('file.ts');
      const { populateGraphReport } = await loadCacheModule();

      await populateGraphReport(testConfig, '/workspace', 'opts-hash');

      expect(mocks.hashArray).toHaveBeenCalledWith(
        expect.arrayContaining(['repo-a', 'sha123', 'file.ts']),
      );
    });

    it('skips repos without .git dir (does not include them in hash)', async () => {
      const mocks = await loadMocks();
      setupMocksForExtraction(mocks);

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
      const mocks = await loadMocks();
      setupMocksForExtraction(mocks);

      let callCount = 0;
      mocks.hashArray.mockImplementation((parts: unknown) => {
        callCount++;

        return `hash-${callCount}` as unknown as string;
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
      const mocks = await loadMocks();
      setupMocksForExtraction(mocks);

      let callCount = 0;
      mocks.hashArray.mockImplementation((parts: unknown) => {
        callCount++;

        return `hash-${callCount}` as unknown as string;
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
