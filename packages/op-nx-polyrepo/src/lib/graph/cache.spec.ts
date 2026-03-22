import { describe, it, expect, expectTypeOf, vi } from 'vitest';
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
  unlinkSync: vi.fn<(path: string) => void>(),
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
  logger: {
    warn: vi.fn<(message: string) => void>(),
    info: vi.fn<(message: string) => void>(),
  },
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

const transformedResultA = {
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

const transformedResultB = {
  nodes: {
    'repo-b/my-lib': {
      name: 'repo-b/my-lib',
      root: '.repos/repo-b/libs/my-lib',
      targets: {},
      tags: ['scope:shared', 'polyrepo:external', 'polyrepo:repo-b'],
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
      unlinkSync: vi.mocked(fs.unlinkSync),
      extractGraphFromRepo: vi.mocked(extract.extractGraphFromRepo),
      transformGraphForRepo: vi.mocked(transform.transformGraphForRepo),
      getHeadSha: vi.mocked(git.getHeadSha),
      getDirtyFiles: vi.mocked(git.getDirtyFiles),
      normalizeRepos: vi.mocked(schema.normalizeRepos),
      hashArray: vi.mocked(devkit.hashArray),
      readJsonFile: vi.mocked(devkit.readJsonFile),
      writeJsonFile: vi.mocked(devkit.writeJsonFile),
      loggerWarn: vi.mocked(devkit.logger.warn),
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

      // Old cache file and per-repo cache files do not exist by default
      return false;
    });

    mocks.getHeadSha.mockResolvedValue('abc123');
    mocks.getDirtyFiles.mockResolvedValue('');

    // Deterministic hash: same inputs produce same output across calls
    mocks.hashArray.mockImplementation((parts: unknown) => {
      return `hash-${JSON.stringify(parts)}`;
    });

    mocks.extractGraphFromRepo.mockResolvedValue(rawGraph);

    mocks.transformGraphForRepo.mockImplementation(
      (alias: string, _raw: unknown, _ws: string) => {
        if (alias === 'repo-a') {
          return transformedResultA;
        }

        return transformedResultB;
      },
    );

    mocks.readJsonFile.mockImplementation((path: unknown) => {
      const ps = String(path);

      // Return plugin version when cache.ts reads its own package.json
      if (
        ps.includes('package.json') &&
        !ps.includes('.polyrepo-graph-cache')
      ) {
        return { version: '1.0.0' };
      }

      throw new Error('File not found');
    });

    mocks.writeJsonFile.mockImplementation(() => undefined);
  }

  describe('global gate (DAEMON-01)', () => {
    it('returns instantly without disk reads or extraction when global hash unchanged', async () => {
      expect.hasAssertions();

      const { mocks } = await setup();
      const { populateGraphReport } = await loadCacheModule();

      // First call: populates cache
      await populateGraphReport(testConfig, '/workspace', 'opts-hash');

      mocks.extractGraphFromRepo.mockClear();
      mocks.readJsonFile.mockClear();

      // Second call with same hash: should return cached (no disk or extraction)
      const result = await populateGraphReport(
        testConfig,
        '/workspace',
        'opts-hash',
      );

      expect(mocks.extractGraphFromRepo).not.toHaveBeenCalled();
      expect(mocks.readJsonFile).not.toHaveBeenCalled();
      expect(result).toBeDefined();
      expect(result.repos).toBeDefined();
    });
  });

  describe('per-repo selective invalidation (DAEMON-03)', () => {
    it('only re-extracts the changed repo while unchanged repo stays cached', async () => {
      expect.hasAssertions();

      const { mocks } = await setup();
      const { populateGraphReport } = await loadCacheModule();

      // First call: extracts both repos
      await populateGraphReport(testConfig, '/workspace', 'opts-hash');

      expect(mocks.extractGraphFromRepo).toHaveBeenCalledTimes(2);

      mocks.extractGraphFromRepo.mockClear();

      // Change only repo-a's SHA (simulate a commit in repo-a)
      mocks.getHeadSha.mockImplementation((repoPath: string) => {
        if (repoPath.includes('repo-a')) {
          return Promise.resolve('new-sha-for-a');
        }

        return Promise.resolve('abc123');
      });

      // Second call: only repo-a should re-extract
      const result = await populateGraphReport(
        testConfig,
        '/workspace',
        'opts-hash',
      );

      expect(mocks.extractGraphFromRepo).toHaveBeenCalledTimes(1);
      expect(mocks.extractGraphFromRepo).toHaveBeenCalledWith(
        expect.stringContaining('repo-a'),
      );

      // Both repos should be in the result
      expect(result.repos['repo-a']).toBeDefined();
      expect(result.repos['repo-b']).toBeDefined();
    });
  });

  describe('per-repo disk cache (DAEMON-02)', () => {
    it('restores per-repo data from disk on cold start without extraction', async () => {
      expect.hasAssertions();

      const { mocks } = await setup();

      // Use a stable hash so we can match it
      mocks.hashArray.mockReturnValue('stable-hash');

      // Mock per-repo disk cache for repo-a only (and plugin version)
      mocks.readJsonFile.mockImplementation((path: unknown) => {
        const ps = String(path);

        if (
          ps.includes('package.json') &&
          !ps.includes('.polyrepo-graph-cache')
        ) {
          return { version: '1.0.0' };
        }

        if (
          ps.includes('repo-a') &&
          ps.includes('.polyrepo-graph-cache.json')
        ) {
          return { hash: 'stable-hash', report: transformedResultA };
        }

        throw new Error('File not found');
      });

      const { populateGraphReport } = await loadCacheModule();

      const result = await populateGraphReport(
        testConfig,
        '/workspace',
        'opts-hash',
      );

      // repo-a should NOT be extracted (disk hit)
      // repo-b should be extracted (no disk cache)
      expect(mocks.extractGraphFromRepo).toHaveBeenCalledTimes(1);
      expect(mocks.extractGraphFromRepo).toHaveBeenCalledWith(
        expect.stringContaining('repo-b'),
      );
      expect(result.repos['repo-a']).toBeDefined();
      expect(result.repos['repo-b']).toBeDefined();
    });

    it('falls through to extraction on disk cache miss', async () => {
      expect.hasAssertions();

      const { mocks } = await setup();

      // All readJsonFile calls throw (no disk cache)
      mocks.readJsonFile.mockImplementation(() => {
        throw new Error('File not found');
      });

      const { populateGraphReport } = await loadCacheModule();

      await populateGraphReport(testConfig, '/workspace', 'opts-hash');

      // Both repos should be extracted
      expect(mocks.extractGraphFromRepo).toHaveBeenCalledTimes(2);
    });
  });

  describe('disk write', () => {
    it('writes per-repo cache file to .repos/ALIAS/.polyrepo-graph-cache.json after extraction', async () => {
      expect.hasAssertions();

      const { mocks } = await setup();
      const { populateGraphReport } = await loadCacheModule();

      await populateGraphReport(testConfig, '/workspace', 'opts-hash');

      // Should write per-repo cache for each repo
      expect(mocks.writeJsonFile).toHaveBeenCalledWith(
        expect.stringContaining('repo-a'),
        expect.objectContaining({ hash: expect.any(String) }),
      );
      expect(mocks.writeJsonFile).toHaveBeenCalledWith(
        expect.stringContaining('repo-b'),
        expect.objectContaining({ hash: expect.any(String) }),
      );
    });
  });

  describe('extraction failure isolation', () => {
    it('continues serving other repos when one repo extraction fails', async () => {
      expect.hasAssertions();

      const { mocks } = await setup();

      // repo-a extraction fails
      mocks.extractGraphFromRepo.mockImplementation((repoPath: string) => {
        if (repoPath.includes('repo-a')) {
          return Promise.reject(new Error('extraction failed'));
        }

        return Promise.resolve(rawGraph);
      });

      const { populateGraphReport } = await loadCacheModule();

      const result = await populateGraphReport(
        testConfig,
        '/workspace',
        'opts-hash',
      );

      // repo-b should still be in the report
      expect(result.repos['repo-b']).toBeDefined();

      // repo-a should not be in the report (extraction failed)
      expect(result.repos['repo-a']).toBeUndefined();
    });
  });

  describe('backoff (DAEMON-06)', () => {
    it('skips extraction during backoff cooldown after failure', async () => {
      expect.hasAssertions();

      const { mocks } = await setup();

      // repo-a extraction always fails
      mocks.extractGraphFromRepo.mockImplementation((repoPath: string) => {
        if (repoPath.includes('repo-a')) {
          return Promise.reject(new Error('extraction failed'));
        }

        return Promise.resolve(rawGraph);
      });

      const { populateGraphReport } = await loadCacheModule();

      // First call: both repos attempted, repo-a fails
      await populateGraphReport(testConfig, '/workspace', 'opts-hash');

      expect(mocks.extractGraphFromRepo).toHaveBeenCalledTimes(2);

      mocks.extractGraphFromRepo.mockClear();

      // Second call (within 2s cooldown): repo-a extraction should be skipped
      await populateGraphReport(testConfig, '/workspace', 'opts-hash');

      // Only repo-b should be re-extracted (or served from cache)
      // repo-a should NOT be extracted due to backoff
      const calls = mocks.extractGraphFromRepo.mock.calls;

      for (const call of calls) {
        expect(call[0]).not.toContain('repo-a');
      }
    });

    it('allows extraction after cooldown expires', async () => {
      expect.hasAssertions();

      const { mocks } = await setup();
      const originalDateNow = Date.now;

      // repo-a extraction fails
      mocks.extractGraphFromRepo.mockImplementation((repoPath: string) => {
        if (repoPath.includes('repo-a')) {
          return Promise.reject(new Error('extraction failed'));
        }

        return Promise.resolve(rawGraph);
      });

      const { populateGraphReport } = await loadCacheModule();

      // First call: records failure
      await populateGraphReport(testConfig, '/workspace', 'opts-hash');

      mocks.extractGraphFromRepo.mockClear();

      // Simulate time passing beyond 2s cooldown
      Date.now = () => originalDateNow() + 3000;

      try {
        await populateGraphReport(testConfig, '/workspace', 'opts-hash');

        // repo-a extraction should be attempted again
        const repoACalls = mocks.extractGraphFromRepo.mock.calls.filter(
          (call) => call[0].includes('repo-a'),
        );

        expect(repoACalls.length).toBeGreaterThanOrEqual(1);
      } finally {
        Date.now = originalDateNow;
      }
    });
  });

  describe('hash-change resets backoff (DAEMON-07)', () => {
    it('resets backoff when repo hash changes after failure', async () => {
      expect.hasAssertions();

      const { mocks } = await setup();

      // repo-a extraction fails initially
      mocks.extractGraphFromRepo.mockImplementation((repoPath: string) => {
        if (repoPath.includes('repo-a')) {
          return Promise.reject(new Error('extraction failed'));
        }

        return Promise.resolve(rawGraph);
      });

      const { populateGraphReport } = await loadCacheModule();

      // First call: records failure for repo-a
      await populateGraphReport(testConfig, '/workspace', 'opts-hash');

      mocks.extractGraphFromRepo.mockClear();

      // Change repo-a's hash (simulate a file edit)
      mocks.getHeadSha.mockImplementation((repoPath: string) => {
        if (repoPath.includes('repo-a')) {
          return Promise.resolve('fixed-sha');
        }

        return Promise.resolve('abc123');
      });

      // Make extraction succeed now
      mocks.extractGraphFromRepo.mockResolvedValue(rawGraph);

      // Second call (still within cooldown but hash changed): should attempt extraction
      await populateGraphReport(testConfig, '/workspace', 'opts-hash');

      const repoACalls = mocks.extractGraphFromRepo.mock.calls.filter((call) =>
        call[0].includes('repo-a'),
      );

      expect(repoACalls.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('backoff cap', () => {
    it('caps backoff at 30 seconds', async () => {
      expect.hasAssertions();

      const { mocks } = await setup();
      const originalDateNow = Date.now;
      let fakeTime = originalDateNow();

      Date.now = () => fakeTime;

      // repo-a extraction always fails
      mocks.extractGraphFromRepo.mockImplementation((repoPath: string) => {
        if (repoPath.includes('repo-a')) {
          return Promise.reject(new Error('extraction failed'));
        }

        return Promise.resolve(rawGraph);
      });

      const { populateGraphReport } = await loadCacheModule();

      try {
        // Fail 6 times with increasing cooldowns
        // Attempt 1: fail, backoff = 2s
        await populateGraphReport(testConfig, '/workspace', 'opts-hash');
        fakeTime += 2001;

        // Attempt 2: fail, backoff = 4s
        await populateGraphReport(testConfig, '/workspace', 'opts-hash');
        fakeTime += 4001;

        // Attempt 3: fail, backoff = 8s
        await populateGraphReport(testConfig, '/workspace', 'opts-hash');
        fakeTime += 8001;

        // Attempt 4: fail, backoff = 16s
        await populateGraphReport(testConfig, '/workspace', 'opts-hash');
        fakeTime += 16001;

        // Attempt 5: fail, backoff = 30s (capped)
        await populateGraphReport(testConfig, '/workspace', 'opts-hash');
        fakeTime += 30001;

        // Attempt 6: fail, backoff should still be 30s (capped)
        await populateGraphReport(testConfig, '/workspace', 'opts-hash');

        mocks.extractGraphFromRepo.mockClear();

        // After 29s: should still be in cooldown
        fakeTime += 29000;
        await populateGraphReport(testConfig, '/workspace', 'opts-hash');

        const callsDuringCooldown =
          mocks.extractGraphFromRepo.mock.calls.filter((call) =>
            call[0].includes('repo-a'),
          );

        expect(callsDuringCooldown).toHaveLength(0);

        // After 31s total from last attempt: should allow extraction
        fakeTime += 2000;

        mocks.extractGraphFromRepo.mockClear();

        await populateGraphReport(testConfig, '/workspace', 'opts-hash');

        const callsAfterCooldown = mocks.extractGraphFromRepo.mock.calls.filter(
          (call) => call[0].includes('repo-a'),
        );

        expect(callsAfterCooldown.length).toBeGreaterThanOrEqual(1);
      } finally {
        Date.now = originalDateNow;
      }
    });
  });

  describe('actionable warning (DAEMON-08)', () => {
    it('logs actionable troubleshooting steps on extraction failure', async () => {
      expect.hasAssertions();

      const { mocks } = await setup();

      mocks.extractGraphFromRepo.mockImplementation((repoPath: string) => {
        if (repoPath.includes('repo-a')) {
          return Promise.reject(new Error('extraction failed'));
        }

        return Promise.resolve(rawGraph);
      });

      const { populateGraphReport } = await loadCacheModule();

      await populateGraphReport(testConfig, '/workspace', 'opts-hash');

      const warnCalls: string[] = mocks.loggerWarn.mock.calls.map(
        (call: [string]) => call[0],
      );
      const allWarnings = warnCalls.join('\n');

      expect(allWarnings).toContain('polyrepo-sync');
      expect(allWarnings).toContain('NX_DAEMON=false');
      expect(allWarnings).toContain('NX_PLUGIN_NO_TIMEOUTS');
    });
  });

  describe('old cache cleanup', () => {
    it('attempts to delete old monolithic cache file on first invocation', async () => {
      expect.hasAssertions();

      const { mocks } = await setup();

      // Old cache file exists
      mocks.existsSync.mockImplementation((p: unknown) => {
        const ps = String(p);

        if (ps.includes('.git')) {
          return true;
        }

        // The old monolithic cache path: .repos/.polyrepo-graph-cache.json
        // Must NOT match per-repo paths like .repos/repo-a/.polyrepo-graph-cache.json
        if (
          ps.includes('.polyrepo-graph-cache.json') &&
          !ps.includes('repo-a') &&
          !ps.includes('repo-b')
        ) {
          return true;
        }

        return false;
      });

      const { populateGraphReport } = await loadCacheModule();

      await populateGraphReport(testConfig, '/workspace', 'opts-hash');

      expect(mocks.unlinkSync).toHaveBeenCalledWith(
        expect.stringContaining('.polyrepo-graph-cache.json'),
      );
    });
  });

  describe('unsynced repos', () => {
    it('skips repos without .git directory in both hash computation and extraction', async () => {
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
      expect(mocks.extractGraphFromRepo).toHaveBeenCalledWith(
        expect.stringContaining('repo-a'),
      );

      // getHeadSha should only be called for repo-a
      expect(mocks.getHeadSha).toHaveBeenCalledTimes(1);
    });
  });

  describe('plugin version in cache key (PROXY-01)', () => {
    it('computeRepoHash includes plugin version in hash input', async () => {
      expect.hasAssertions();

      const { mocks } = await setup();

      // Plugin version 1.0.0 (set by setupMocksForExtraction)
      const { computeRepoHash } = await loadCacheModule();

      await computeRepoHash('opts-hash', 'repo-a', '/workspace/.repos/repo-a');

      // hashArray should have been called with the plugin version as first element
      expect(mocks.hashArray).toHaveBeenCalledWith(
        expect.arrayContaining(['1.0.0']),
      );

      // Verify the version is the first element (convention from plan)
      const callArgs = mocks.hashArray.mock.calls.find(
        (call) => Array.isArray(call[0]) && call[0].includes('1.0.0'),
      );

      expect(callArgs).toBeDefined();
      expect(callArgs![0][0]).toBe('1.0.0');
    });

    it('produces different hash when plugin version changes', async () => {
      expect.hasAssertions();

      // First module load with version 1.0.0
      const mocks1 = await (async () => {
        vi.clearAllMocks();
        vi.resetModules();

        const m = await loadMocks();
        setupMocksForExtraction(m);

        return m;
      })();

      const mod1 = await loadCacheModule();
      const hash1 = await mod1.computeRepoHash(
        'opts-hash',
        'repo-a',
        '/workspace/.repos/repo-a',
      );

      // Second module load with version 2.0.0
      vi.clearAllMocks();
      vi.resetModules();

      const mocks2 = await loadMocks();
      setupMocksForExtraction(mocks2);

      // Override version to 2.0.0
      mocks2.readJsonFile.mockImplementation((path: unknown) => {
        const ps = String(path);

        if (
          ps.includes('package.json') &&
          !ps.includes('.polyrepo-graph-cache')
        ) {
          return { version: '2.0.0' };
        }

        throw new Error('File not found');
      });

      const mod2 = await loadCacheModule();
      const hash2 = await mod2.computeRepoHash(
        'opts-hash',
        'repo-a',
        '/workspace/.repos/repo-a',
      );

      expect(hash1).not.toBe(hash2);
    });

    it('produces stable hash when called twice with same plugin version', async () => {
      expect.hasAssertions();

      await setup();

      const { computeRepoHash } = await loadCacheModule();

      const hash1 = await computeRepoHash(
        'opts-hash',
        'repo-a',
        '/workspace/.repos/repo-a',
      );
      const hash2 = await computeRepoHash(
        'opts-hash',
        'repo-a',
        '/workspace/.repos/repo-a',
      );

      expect(hash1).toBe(hash2);
    });

    it('falls back to dev timestamp when package.json is unreadable', async () => {
      expect.hasAssertions();

      vi.clearAllMocks();
      vi.resetModules();

      const mocks = await loadMocks();
      setupMocksForExtraction(mocks);

      // Override readJsonFile to throw for package.json (simulating unreadable)
      mocks.readJsonFile.mockImplementation(() => {
        throw new Error('File not found');
      });

      const { computeRepoHash } = await loadCacheModule();

      // Should still work (uses fallback version)
      const hash = await computeRepoHash(
        'opts-hash',
        'repo-a',
        '/workspace/.repos/repo-a',
      );

      expect(hash).toBeDefined();
      expect(typeof hash).toBe('string');

      // hashArray should still have been called (fallback version included)
      expect(mocks.hashArray).toHaveBeenCalled();
    });
  });

  describe('exports', () => {
    it('exports computeRepoHash', async () => {
      expect.hasAssertions();

      await setup();

      const mod = await loadCacheModule();

      expectTypeOf(mod.computeRepoHash).toBeFunction();

      expect(mod.computeRepoHash).toBeDefined();
    });

    it('exports writePerRepoCache', async () => {
      expect.hasAssertions();

      await setup();

      const mod = await loadCacheModule();

      expectTypeOf(mod.writePerRepoCache).toBeFunction();

      expect(mod.writePerRepoCache).toBeDefined();
    });

    it('exports CACHE_FILENAME', async () => {
      expect.hasAssertions();

      await setup();

      const mod = await loadCacheModule();

      expect(mod.CACHE_FILENAME).toBe('.polyrepo-graph-cache.json');
    });
  });
});
