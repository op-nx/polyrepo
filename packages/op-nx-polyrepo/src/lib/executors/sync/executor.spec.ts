import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ExecutorContext } from '@nx/devkit';

// Mock dependencies before importing executor
vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
}));

vi.mock('@nx/devkit', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../config/validate', () => ({
  validateConfig: vi.fn(),
}));

vi.mock('../../config/schema', () => ({
  normalizeRepos: vi.fn(),
}));

vi.mock('../../git/commands', () => ({
  gitClone: vi.fn(),
  gitPull: vi.fn(),
  gitFetch: vi.fn(),
  gitPullRebase: vi.fn(),
  gitPullFfOnly: vi.fn(),
  gitFetchTag: vi.fn(),
}));

vi.mock('../../git/detect', () => ({
  detectRepoState: vi.fn(),
}));

import { readFileSync } from 'node:fs';
import { logger } from '@nx/devkit';
import { validateConfig } from '../../config/validate';
import { normalizeRepos } from '../../config/schema';
import type { NormalizedRepoEntry, PolyrepoConfig } from '../../config/schema';
import {
  gitClone,
  gitPull,
  gitFetch,
  gitPullRebase,
  gitPullFfOnly,
  gitFetchTag,
} from '../../git/commands';
import { detectRepoState } from '../../git/detect';
import syncExecutor from './executor';

const mockReadFileSync = vi.mocked(readFileSync);
const mockValidateConfig = vi.mocked(validateConfig);
const mockNormalizeRepos = vi.mocked(normalizeRepos);
const mockGitClone = vi.mocked(gitClone);
const mockGitPull = vi.mocked(gitPull);
const mockGitFetch = vi.mocked(gitFetch);
const mockGitPullRebase = vi.mocked(gitPullRebase);
const mockGitPullFfOnly = vi.mocked(gitPullFfOnly);
const mockGitFetchTag = vi.mocked(gitFetchTag);
const mockDetectRepoState = vi.mocked(detectRepoState);
const mockLoggerInfo = vi.mocked(logger.info);
const mockLoggerWarn = vi.mocked(logger.warn);

function createContext(root = '/workspace'): ExecutorContext {
  return {
    root,
    cwd: root,
    isVerbose: false,
  } as ExecutorContext;
}

const fakeConfig: PolyrepoConfig = {
  repos: { 'repo-a': 'https://github.com/org/repo-a.git' },
};

function setupPluginConfig(entries: NormalizedRepoEntry[]): void {
  mockReadFileSync.mockReturnValue(
    JSON.stringify({
      plugins: [
        {
          plugin: '@op-nx/polyrepo',
          options: fakeConfig,
        },
      ],
    }),
  );
  mockValidateConfig.mockReturnValue(fakeConfig);
  mockNormalizeRepos.mockReturnValue(entries);
}

describe('syncExecutor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGitClone.mockResolvedValue(undefined);
    mockGitPull.mockResolvedValue(undefined);
    mockGitFetch.mockResolvedValue(undefined);
    mockGitPullRebase.mockResolvedValue(undefined);
    mockGitPullFfOnly.mockResolvedValue(undefined);
    mockGitFetchTag.mockResolvedValue(undefined);
  });

  it('clones remote repo when .repos/<alias> does not exist', async () => {
    setupPluginConfig([
      {
        type: 'remote',
        alias: 'repo-a',
        url: 'https://github.com/org/repo-a.git',
        depth: 1,
      },
    ]);
    mockDetectRepoState.mockReturnValue('not-synced');

    const result = await syncExecutor({}, createContext());

    expect(mockGitClone).toHaveBeenCalledWith(
      'https://github.com/org/repo-a.git',
      expect.stringContaining('.repos'),
      expect.objectContaining({ depth: 1 }),
    );
    expect(result).toEqual({ success: true });
  });

  it('pulls remote repo when .repos/<alias> already exists and ref is a branch', async () => {
    setupPluginConfig([
      {
        type: 'remote',
        alias: 'repo-a',
        url: 'https://github.com/org/repo-a.git',
        ref: 'main',
        depth: 1,
      },
    ]);
    mockDetectRepoState.mockReturnValue('cloned');

    const result = await syncExecutor({}, createContext());

    expect(mockGitPull).toHaveBeenCalled();
    expect(mockGitClone).not.toHaveBeenCalled();
    expect(result).toEqual({ success: true });
  });

  it('re-fetches tag when .repos/<alias> already exists and ref looks like a tag', async () => {
    setupPluginConfig([
      {
        type: 'remote',
        alias: 'repo-a',
        url: 'https://github.com/org/repo-a.git',
        ref: 'v1.2.3',
        depth: 1,
      },
    ]);
    mockDetectRepoState.mockReturnValue('cloned');

    const result = await syncExecutor({}, createContext());

    expect(mockGitFetchTag).toHaveBeenCalledWith(
      expect.stringContaining('.repos'),
      'v1.2.3',
      1,
    );
    expect(mockGitPull).not.toHaveBeenCalled();
    expect(result).toEqual({ success: true });
  });

  it('pulls local path repo when it is a git repo', async () => {
    setupPluginConfig([
      { type: 'local', alias: 'repo-b', path: 'D:/projects/repo-b' },
    ]);
    mockDetectRepoState.mockReturnValue('referenced');

    const result = await syncExecutor({}, createContext());

    expect(mockGitPull).toHaveBeenCalledWith('D:/projects/repo-b');
    expect(result).toEqual({ success: true });
  });

  it('skips local path repo pull when path does not exist (warns)', async () => {
    setupPluginConfig([
      { type: 'local', alias: 'repo-b', path: 'D:/projects/repo-b' },
    ]);
    mockDetectRepoState.mockReturnValue('not-synced');

    const result = await syncExecutor({}, createContext());

    expect(mockGitPull).not.toHaveBeenCalled();
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.stringContaining('repo-b'),
    );
    expect(result).toEqual({ success: true });
  });

  it('uses configured depth for clone (depth:0 = full)', async () => {
    setupPluginConfig([
      {
        type: 'remote',
        alias: 'repo-a',
        url: 'https://github.com/org/repo-a.git',
        depth: 0,
      },
    ]);
    mockDetectRepoState.mockReturnValue('not-synced');

    await syncExecutor({}, createContext());

    expect(mockGitClone).toHaveBeenCalledWith(
      'https://github.com/org/repo-a.git',
      expect.any(String),
      expect.objectContaining({ depth: 0 }),
    );
  });

  it('uses configured ref as --branch during clone', async () => {
    setupPluginConfig([
      {
        type: 'remote',
        alias: 'repo-a',
        url: 'https://github.com/org/repo-a.git',
        ref: 'develop',
        depth: 1,
      },
    ]);
    mockDetectRepoState.mockReturnValue('not-synced');

    await syncExecutor({}, createContext());

    expect(mockGitClone).toHaveBeenCalledWith(
      'https://github.com/org/repo-a.git',
      expect.any(String),
      expect.objectContaining({ ref: 'develop' }),
    );
  });

  it('processes all repos in parallel (Promise.allSettled)', async () => {
    setupPluginConfig([
      {
        type: 'remote',
        alias: 'repo-a',
        url: 'https://github.com/org/repo-a.git',
        depth: 1,
      },
      {
        type: 'remote',
        alias: 'repo-b',
        url: 'https://github.com/org/repo-b.git',
        depth: 1,
      },
      { type: 'local', alias: 'repo-c', path: 'D:/projects/repo-c' },
    ]);
    mockDetectRepoState.mockReturnValue('not-synced');

    const result = await syncExecutor({}, createContext());

    // All three repos processed
    expect(mockGitClone).toHaveBeenCalledTimes(2);
    expect(mockLoggerWarn).toHaveBeenCalled(); // local repo not found
    expect(result).toEqual({ success: true });
  });

  it('returns { success: true } when all repos succeed', async () => {
    setupPluginConfig([
      {
        type: 'remote',
        alias: 'repo-a',
        url: 'https://github.com/org/repo-a.git',
        depth: 1,
      },
    ]);
    mockDetectRepoState.mockReturnValue('not-synced');

    const result = await syncExecutor({}, createContext());

    expect(result).toEqual({ success: true });
  });

  it('returns { success: false } when any repo fails', async () => {
    setupPluginConfig([
      {
        type: 'remote',
        alias: 'repo-a',
        url: 'https://github.com/org/repo-a.git',
        depth: 1,
      },
      {
        type: 'remote',
        alias: 'repo-b',
        url: 'https://github.com/org/repo-b.git',
        depth: 1,
      },
    ]);
    mockDetectRepoState.mockReturnValue('not-synced');
    mockGitClone
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('clone failed'));

    const result = await syncExecutor({}, createContext());

    expect(result).toEqual({ success: false });
  });

  it('logs per-repo results (cloning/pulling/done/failed)', async () => {
    setupPluginConfig([
      {
        type: 'remote',
        alias: 'repo-a',
        url: 'https://github.com/org/repo-a.git',
        depth: 1,
      },
    ]);
    mockDetectRepoState.mockReturnValue('not-synced');

    await syncExecutor({}, createContext());

    expect(mockLoggerInfo).toHaveBeenCalledWith(
      expect.stringContaining('repo-a'),
    );
  });

  it('logs summary at end (N synced, M failed)', async () => {
    setupPluginConfig([
      {
        type: 'remote',
        alias: 'repo-a',
        url: 'https://github.com/org/repo-a.git',
        depth: 1,
      },
    ]);
    mockDetectRepoState.mockReturnValue('not-synced');

    await syncExecutor({}, createContext());

    const summaryCall = mockLoggerInfo.mock.calls.find(
      (call) => typeof call[0] === 'string' && call[0].includes('synced'),
    );

    expect(summaryCall).toBeDefined();
  });

  describe('strategy option', () => {
    it('defaults to pull strategy', async () => {
      setupPluginConfig([
        {
          type: 'remote',
          alias: 'repo-a',
          url: 'https://github.com/org/repo-a.git',
          depth: 1,
        },
      ]);
      mockDetectRepoState.mockReturnValue('cloned');

      await syncExecutor({}, createContext());

      expect(mockGitPull).toHaveBeenCalled();
    });

    it('strategy "fetch" calls gitFetch instead of gitPull', async () => {
      setupPluginConfig([
        {
          type: 'remote',
          alias: 'repo-a',
          url: 'https://github.com/org/repo-a.git',
          depth: 1,
        },
      ]);
      mockDetectRepoState.mockReturnValue('cloned');

      await syncExecutor({ strategy: 'fetch' }, createContext());

      expect(mockGitFetch).toHaveBeenCalled();
      expect(mockGitPull).not.toHaveBeenCalled();
    });

    it('strategy "rebase" calls gitPullRebase', async () => {
      setupPluginConfig([
        {
          type: 'remote',
          alias: 'repo-a',
          url: 'https://github.com/org/repo-a.git',
          depth: 1,
        },
      ]);
      mockDetectRepoState.mockReturnValue('cloned');

      await syncExecutor({ strategy: 'rebase' }, createContext());

      expect(mockGitPullRebase).toHaveBeenCalled();
      expect(mockGitPull).not.toHaveBeenCalled();
    });

    it('strategy "ff-only" calls gitPullFfOnly', async () => {
      setupPluginConfig([
        {
          type: 'remote',
          alias: 'repo-a',
          url: 'https://github.com/org/repo-a.git',
          depth: 1,
        },
      ]);
      mockDetectRepoState.mockReturnValue('cloned');

      await syncExecutor({ strategy: 'ff-only' }, createContext());

      expect(mockGitPullFfOnly).toHaveBeenCalled();
      expect(mockGitPull).not.toHaveBeenCalled();
    });
  });
});
