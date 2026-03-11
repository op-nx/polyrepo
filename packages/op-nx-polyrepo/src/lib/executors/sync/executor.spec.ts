import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ExecutorContext } from '@nx/devkit';

// Mock dependencies before importing executor
vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
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

import { readFileSync, existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import type { ExecFileException } from 'node:child_process';
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
const mockExistsSync = vi.mocked(existsSync);
const mockExecFile = vi.mocked(execFile);
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
    // Default: existsSync returns false (no lock files detected -> npm)
    mockExistsSync.mockReturnValue(false);
    // Default: execFile (used for install) succeeds immediately
    mockExecFile.mockImplementation(((
      _file: string,
      _args: readonly string[],
      _options: unknown,
      callback?: (
        error: ExecFileException | null,
        stdout: string,
        stderr: string,
      ) => void,
    ) => {
      if (callback) {
        callback(null, '', '');
      }
    }) as typeof execFile);
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

  describe('dependency installation', () => {
    function setupExecFileMockSuccess(): void {
      mockExecFile.mockImplementation(((
        _file: string,
        _args: readonly string[],
        _options: unknown,
        callback?: (
          error: ExecFileException | null,
          stdout: string,
          stderr: string,
        ) => void,
      ) => {
        if (callback) {
          callback(null, '', '');
        }
      }) as typeof execFile);
    }

    function setupExecFileMockFailure(errorMessage: string): void {
      mockExecFile.mockImplementation(((
        _file: string,
        _args: readonly string[],
        _options: unknown,
        callback?: (
          error: ExecFileException | null,
          stdout: string,
          stderr: string,
        ) => void,
      ) => {
        if (callback) {
          const err = new Error(errorMessage) as ExecFileException;
          callback(err, '', errorMessage);
        }
      }) as typeof execFile);
    }

    it('runs npm install after cloning when package-lock.json detected', async () => {
      setupPluginConfig([
        {
          type: 'remote',
          alias: 'repo-a',
          url: 'https://github.com/org/repo-a.git',
          depth: 1,
        },
      ]);
      mockDetectRepoState.mockReturnValue('not-synced');
      mockExistsSync.mockReturnValue(false); // no pnpm-lock.yaml, no yarn.lock
      setupExecFileMockSuccess();

      await syncExecutor({}, createContext());

      expect(mockExecFile).toHaveBeenCalledWith(
        'npm',
        ['install'],
        expect.objectContaining({
          cwd: expect.stringContaining('.repos'),
        }),
        expect.any(Function),
      );
    });

    it('runs pnpm install after cloning when pnpm-lock.yaml detected', async () => {
      setupPluginConfig([
        {
          type: 'remote',
          alias: 'repo-a',
          url: 'https://github.com/org/repo-a.git',
          depth: 1,
        },
      ]);
      mockDetectRepoState.mockReturnValue('not-synced');
      // pnpm-lock.yaml exists
      mockExistsSync.mockImplementation((path: unknown) => {
        if (typeof path === 'string' && path.includes('pnpm-lock.yaml')) {
          return true;
        }

        return false;
      });
      setupExecFileMockSuccess();

      await syncExecutor({}, createContext());

      expect(mockExecFile).toHaveBeenCalledWith(
        'pnpm',
        ['install'],
        expect.objectContaining({
          cwd: expect.stringContaining('.repos'),
        }),
        expect.any(Function),
      );
    });

    it('runs yarn after cloning when yarn.lock detected', async () => {
      setupPluginConfig([
        {
          type: 'remote',
          alias: 'repo-a',
          url: 'https://github.com/org/repo-a.git',
          depth: 1,
        },
      ]);
      mockDetectRepoState.mockReturnValue('not-synced');
      // yarn.lock exists but not pnpm-lock.yaml
      mockExistsSync.mockImplementation((path: unknown) => {
        if (typeof path === 'string' && path.includes('yarn.lock')) {
          return true;
        }

        return false;
      });
      setupExecFileMockSuccess();

      await syncExecutor({}, createContext());

      expect(mockExecFile).toHaveBeenCalledWith(
        'yarn',
        ['install'],
        expect.objectContaining({
          cwd: expect.stringContaining('.repos'),
        }),
        expect.any(Function),
      );
    });

    it('runs install after pulling an existing remote repo', async () => {
      setupPluginConfig([
        {
          type: 'remote',
          alias: 'repo-a',
          url: 'https://github.com/org/repo-a.git',
          depth: 1,
        },
      ]);
      mockDetectRepoState.mockReturnValue('cloned');
      mockExistsSync.mockReturnValue(false);
      setupExecFileMockSuccess();

      await syncExecutor({}, createContext());

      expect(mockExecFile).toHaveBeenCalledWith(
        'npm',
        ['install'],
        expect.objectContaining({
          cwd: expect.stringContaining('.repos'),
        }),
        expect.any(Function),
      );
    });

    it('runs install for local path repos that are updated', async () => {
      setupPluginConfig([
        { type: 'local', alias: 'repo-b', path: 'D:/projects/repo-b' },
      ]);
      mockDetectRepoState.mockReturnValue('referenced');
      mockExistsSync.mockReturnValue(false);
      setupExecFileMockSuccess();

      await syncExecutor({}, createContext());

      expect(mockExecFile).toHaveBeenCalledWith(
        'npm',
        ['install'],
        expect.objectContaining({
          cwd: 'D:/projects/repo-b',
        }),
        expect.any(Function),
      );
    });

    it('uses corepack when package.json has packageManager field', async () => {
      setupPluginConfig([
        {
          type: 'remote',
          alias: 'repo-a',
          url: 'https://github.com/org/repo-a.git',
          depth: 1,
        },
      ]);
      mockDetectRepoState.mockReturnValue('not-synced');
      mockExistsSync.mockReturnValue(false);

      // Override readFileSync to return packageManager for the repo's package.json
      mockReadFileSync.mockImplementation((filePath: unknown) => {
        if (typeof filePath === 'string' && filePath.includes('package.json')) {
          return JSON.stringify({ packageManager: 'pnpm@10.28.2' });
        }

        return JSON.stringify({
          plugins: [
            { plugin: '@op-nx/polyrepo', options: fakeConfig },
          ],
        });
      });
      // package.json exists in repo
      mockExistsSync.mockImplementation((path: unknown) => {
        if (typeof path === 'string' && path.includes('package.json')) {
          return true;
        }

        return false;
      });
      setupExecFileMockSuccess();

      await syncExecutor({}, createContext());

      expect(mockExecFile).toHaveBeenCalledWith(
        'corepack',
        ['pnpm', 'install'],
        expect.objectContaining({
          cwd: expect.stringContaining('.repos'),
          shell: true,
          windowsHide: true,
        }),
        expect.any(Function),
      );
    });

    it('uses corepack for yarn when package.json specifies yarn', async () => {
      setupPluginConfig([
        {
          type: 'remote',
          alias: 'repo-a',
          url: 'https://github.com/org/repo-a.git',
          depth: 1,
        },
      ]);
      mockDetectRepoState.mockReturnValue('not-synced');

      mockReadFileSync.mockImplementation((filePath: unknown) => {
        if (typeof filePath === 'string' && filePath.includes('package.json')) {
          return JSON.stringify({ packageManager: 'yarn@4.1.0' });
        }

        return JSON.stringify({
          plugins: [
            { plugin: '@op-nx/polyrepo', options: fakeConfig },
          ],
        });
      });
      mockExistsSync.mockImplementation((path: unknown) => {
        if (typeof path === 'string' && path.includes('package.json')) {
          return true;
        }

        return false;
      });
      setupExecFileMockSuccess();

      await syncExecutor({}, createContext());

      expect(mockExecFile).toHaveBeenCalledWith(
        'corepack',
        ['yarn', 'install'],
        expect.objectContaining({
          cwd: expect.stringContaining('.repos'),
          shell: true,
          windowsHide: true,
        }),
        expect.any(Function),
      );
    });

    it('falls back to lock file detection when no packageManager field', async () => {
      setupPluginConfig([
        {
          type: 'remote',
          alias: 'repo-a',
          url: 'https://github.com/org/repo-a.git',
          depth: 1,
        },
      ]);
      mockDetectRepoState.mockReturnValue('not-synced');

      mockReadFileSync.mockImplementation((filePath: unknown) => {
        if (typeof filePath === 'string' && filePath.includes('package.json')) {
          return JSON.stringify({ name: 'some-repo' });
        }

        return JSON.stringify({
          plugins: [
            { plugin: '@op-nx/polyrepo', options: fakeConfig },
          ],
        });
      });
      mockExistsSync.mockImplementation((path: unknown) => {
        if (typeof path === 'string' && path.includes('package.json')) {
          return true;
        }

        if (typeof path === 'string' && path.includes('pnpm-lock.yaml')) {
          return true;
        }

        return false;
      });
      setupExecFileMockSuccess();

      await syncExecutor({}, createContext());

      expect(mockExecFile).toHaveBeenCalledWith(
        'pnpm',
        ['install'],
        expect.objectContaining({
          cwd: expect.stringContaining('.repos'),
        }),
        expect.any(Function),
      );
    });

    it('install failure logs warning but does not fail the sync', async () => {
      setupPluginConfig([
        {
          type: 'remote',
          alias: 'repo-a',
          url: 'https://github.com/org/repo-a.git',
          depth: 1,
        },
      ]);
      mockDetectRepoState.mockReturnValue('not-synced');
      mockExistsSync.mockReturnValue(false);
      setupExecFileMockFailure('install failed');

      const result = await syncExecutor({}, createContext());

      expect(mockLoggerWarn).toHaveBeenCalledWith(
        expect.stringContaining('repo-a'),
      );
      expect(result).toEqual({ success: true });
    });
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
