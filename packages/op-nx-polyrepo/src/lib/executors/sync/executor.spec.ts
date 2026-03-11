import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ExecutorContext } from '@nx/devkit';

// Mock dependencies before importing executor
vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  exec: vi.fn(),
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
  getWorkingTreeState: vi.fn(),
  getCurrentBranch: vi.fn(),
  getCurrentRef: vi.fn(),
}));

vi.mock('../../format/table', () => ({
  formatAlignedTable: vi.fn((rows: Array<Array<{ value: string }>>) =>
    rows.map((r) => r.map((c) => c.value).join(' | ')),
  ),
}));

import { readFileSync, existsSync } from 'node:fs';
import { exec } from 'node:child_process';
import type { ExecException } from 'node:child_process';
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
import { detectRepoState, getWorkingTreeState, getCurrentBranch, getCurrentRef } from '../../git/detect';
import { formatAlignedTable } from '../../format/table';
import syncExecutor from './executor';

const mockReadFileSync = vi.mocked(readFileSync);
const mockExistsSync = vi.mocked(existsSync);
const mockExec = vi.mocked(exec);
const mockValidateConfig = vi.mocked(validateConfig);
const mockNormalizeRepos = vi.mocked(normalizeRepos);
const mockGitClone = vi.mocked(gitClone);
const mockGitPull = vi.mocked(gitPull);
const mockGitFetch = vi.mocked(gitFetch);
const mockGitPullRebase = vi.mocked(gitPullRebase);
const mockGitPullFfOnly = vi.mocked(gitPullFfOnly);
const mockGitFetchTag = vi.mocked(gitFetchTag);
const mockDetectRepoState = vi.mocked(detectRepoState);
const mockGetWorkingTreeState = vi.mocked(getWorkingTreeState);
const mockGetCurrentBranch = vi.mocked(getCurrentBranch);
const mockGetCurrentRef = vi.mocked(getCurrentRef);
const mockFormatAlignedTable = vi.mocked(formatAlignedTable);
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
    // Default: getCurrentBranch returns a normal branch (not detached)
    mockGetCurrentBranch.mockResolvedValue('main');
    // Default: getWorkingTreeState returns clean state
    mockGetWorkingTreeState.mockResolvedValue({
      modified: 0,
      staged: 0,
      deleted: 0,
      untracked: 0,
      conflicts: 0,
    });
    // Default: existsSync returns false (no lock files detected -> npm)
    mockExistsSync.mockReturnValue(false);
    // Default: exec (used for install) succeeds immediately
    mockExec.mockImplementation(((
      _command: string,
      _options: unknown,
      callback?: (
        error: ExecException | null,
        stdout: string,
        stderr: string,
      ) => void,
    ) => {
      if (callback) {
        callback(null, '', '');
      }
    }) as typeof exec);
  });

  it('clones remote repo when .repos/<alias> does not exist', async () => {
    setupPluginConfig([
      {
        type: 'remote',
        alias: 'repo-a',
        url: 'https://github.com/org/repo-a.git',
        depth: 1,
        disableHooks: true,
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
        disableHooks: true,
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
        disableHooks: true,
      },
    ]);
    mockDetectRepoState.mockReturnValue('cloned');

    const result = await syncExecutor({}, createContext());

    expect(mockGitFetchTag).toHaveBeenCalledWith(
      expect.stringContaining('.repos'),
      'v1.2.3',
      1,
      true,
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

    expect(mockGitPull).toHaveBeenCalledWith('D:/projects/repo-b', undefined);
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
        disableHooks: true,
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
        disableHooks: true,
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
        disableHooks: true,
      },
      {
        type: 'remote',
        alias: 'repo-b',
        url: 'https://github.com/org/repo-b.git',
        depth: 1,
        disableHooks: true,
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
        disableHooks: true,
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
        disableHooks: true,
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
        disableHooks: true,
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
    function setupExecMockSuccess(): void {
      mockExec.mockImplementation(((
        _command: string,
        _options: unknown,
        callback?: (
          error: ExecException | null,
          stdout: string,
          stderr: string,
        ) => void,
      ) => {
        if (callback) {
          callback(null, '', '');
        }
      }) as typeof exec);
    }

    function setupExecMockFailure(errorMessage: string): void {
      mockExec.mockImplementation(((
        _command: string,
        _options: unknown,
        callback?: (
          error: ExecException | null,
          stdout: string,
          stderr: string,
        ) => void,
      ) => {
        if (callback) {
          const err = new Error(errorMessage) as ExecException;
          callback(err, '', errorMessage);
        }
      }) as typeof exec);
    }

    it('runs npm install after cloning when package-lock.json detected', async () => {
      setupPluginConfig([
        {
          type: 'remote',
          alias: 'repo-a',
          url: 'https://github.com/org/repo-a.git',
          depth: 1,
          disableHooks: true,
        },
      ]);
      mockDetectRepoState.mockReturnValue('not-synced');
      mockExistsSync.mockReturnValue(false); // no pnpm-lock.yaml, no yarn.lock
      setupExecMockSuccess();

      await syncExecutor({}, createContext());

      expect(mockExec).toHaveBeenCalledWith(
        'npm install',
        expect.objectContaining({
          cwd: expect.stringContaining('.repos'),
          windowsHide: true,
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
          disableHooks: true,
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
      setupExecMockSuccess();

      await syncExecutor({}, createContext());

      expect(mockExec).toHaveBeenCalledWith(
        'pnpm install',
        expect.objectContaining({
          cwd: expect.stringContaining('.repos'),
          windowsHide: true,
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
          disableHooks: true,
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
      setupExecMockSuccess();

      await syncExecutor({}, createContext());

      expect(mockExec).toHaveBeenCalledWith(
        'yarn install',
        expect.objectContaining({
          cwd: expect.stringContaining('.repos'),
          windowsHide: true,
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
          disableHooks: true,
        },
      ]);
      mockDetectRepoState.mockReturnValue('cloned');
      mockExistsSync.mockReturnValue(false);
      setupExecMockSuccess();

      await syncExecutor({}, createContext());

      expect(mockExec).toHaveBeenCalledWith(
        'npm install',
        expect.objectContaining({
          cwd: expect.stringContaining('.repos'),
          windowsHide: true,
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
      setupExecMockSuccess();

      await syncExecutor({}, createContext());

      expect(mockExec).toHaveBeenCalledWith(
        'npm install',
        expect.objectContaining({
          cwd: 'D:/projects/repo-b',
          windowsHide: true,
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
          disableHooks: true,
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
      setupExecMockSuccess();

      await syncExecutor({}, createContext());

      expect(mockExec).toHaveBeenCalledWith(
        'corepack pnpm install',
        expect.objectContaining({
          cwd: expect.stringContaining('.repos'),
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
          disableHooks: true,
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
      setupExecMockSuccess();

      await syncExecutor({}, createContext());

      expect(mockExec).toHaveBeenCalledWith(
        'corepack yarn install',
        expect.objectContaining({
          cwd: expect.stringContaining('.repos'),
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
          disableHooks: true,
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
      setupExecMockSuccess();

      await syncExecutor({}, createContext());

      expect(mockExec).toHaveBeenCalledWith(
        'pnpm install',
        expect.objectContaining({
          cwd: expect.stringContaining('.repos'),
          windowsHide: true,
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
          disableHooks: true,
        },
      ]);
      mockDetectRepoState.mockReturnValue('not-synced');
      mockExistsSync.mockReturnValue(false);
      setupExecMockFailure('install failed');

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
          disableHooks: true,
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
          disableHooks: true,
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
          disableHooks: true,
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
          disableHooks: true,
        },
      ]);
      mockDetectRepoState.mockReturnValue('cloned');

      await syncExecutor({ strategy: 'ff-only' }, createContext());

      expect(mockGitPullFfOnly).toHaveBeenCalled();
      expect(mockGitPull).not.toHaveBeenCalled();
    });
  });

  describe('dry-run mode', () => {
    it('shows "would clone" for unsynced remote repos', async () => {
      setupPluginConfig([
        {
          type: 'remote',
          alias: 'repo-a',
          url: 'https://github.com/org/repo-a.git',
          depth: 1,
          disableHooks: true,
        },
      ]);
      mockDetectRepoState.mockReturnValue('not-synced');

      await syncExecutor({ dryRun: true }, createContext());

      const infoCalls = mockLoggerInfo.mock.calls.map((c) => String(c[0]));
      const hasWouldClone = infoCalls.some(
        (msg) => msg.includes('repo-a') && msg.includes('would clone'),
      );

      expect(hasWouldClone).toBe(true);
      expect(mockGitClone).not.toHaveBeenCalled();
    });

    it('shows "would pull" for synced remote repos with branch ref', async () => {
      setupPluginConfig([
        {
          type: 'remote',
          alias: 'repo-a',
          url: 'https://github.com/org/repo-a.git',
          ref: 'main',
          depth: 1,
          disableHooks: true,
        },
      ]);
      mockDetectRepoState.mockReturnValue('cloned');

      await syncExecutor({ dryRun: true }, createContext());

      const infoCalls = mockLoggerInfo.mock.calls.map((c) => String(c[0]));
      const hasWouldPull = infoCalls.some(
        (msg) => msg.includes('repo-a') && msg.includes('would pull'),
      );

      expect(hasWouldPull).toBe(true);
      expect(mockGitPull).not.toHaveBeenCalled();
    });

    it('shows "would fetch tag" for synced remote repos with tag ref', async () => {
      setupPluginConfig([
        {
          type: 'remote',
          alias: 'repo-a',
          url: 'https://github.com/org/repo-a.git',
          ref: 'v1.2.3',
          depth: 1,
          disableHooks: true,
        },
      ]);
      mockDetectRepoState.mockReturnValue('cloned');

      await syncExecutor({ dryRun: true }, createContext());

      const infoCalls = mockLoggerInfo.mock.calls.map((c) => String(c[0]));
      const hasWouldFetchTag = infoCalls.some(
        (msg) => msg.includes('repo-a') && msg.includes('would fetch tag'),
      );

      expect(hasWouldFetchTag).toBe(true);
      expect(mockGitFetchTag).not.toHaveBeenCalled();
    });

    it('shows dirty warning in dry-run when working tree is dirty', async () => {
      setupPluginConfig([
        {
          type: 'remote',
          alias: 'repo-a',
          url: 'https://github.com/org/repo-a.git',
          ref: 'main',
          depth: 1,
          disableHooks: true,
        },
      ]);
      mockDetectRepoState.mockReturnValue('cloned');
      mockGetWorkingTreeState.mockResolvedValue({
        modified: 3,
        staged: 0,
        deleted: 0,
        untracked: 1,
        conflicts: 0,
      });

      await syncExecutor({ dryRun: true }, createContext());

      const infoCalls = mockLoggerInfo.mock.calls.map((c) => String(c[0]));
      const hasDirtyWarning = infoCalls.some(
        (msg) => msg.includes('[WARN: dirty, may fail]'),
      );

      expect(hasDirtyWarning).toBe(true);
    });

    it('shows "would skip" for local repos that do not exist', async () => {
      setupPluginConfig([
        { type: 'local', alias: 'repo-b', path: 'D:/projects/repo-b' },
      ]);
      mockDetectRepoState.mockReturnValue('not-synced');

      await syncExecutor({ dryRun: true }, createContext());

      const infoCalls = mockLoggerInfo.mock.calls.map((c) => String(c[0]));
      const hasWouldSkip = infoCalls.some(
        (msg) => msg.includes('repo-b') && msg.includes('would skip'),
      );

      expect(hasWouldSkip).toBe(true);
    });

    it('returns success:true in dry-run mode', async () => {
      setupPluginConfig([
        {
          type: 'remote',
          alias: 'repo-a',
          url: 'https://github.com/org/repo-a.git',
          depth: 1,
          disableHooks: true,
        },
      ]);
      mockDetectRepoState.mockReturnValue('not-synced');

      const result = await syncExecutor({ dryRun: true }, createContext());

      expect(result).toEqual({ success: true });
    });

    it('shows [WARN: detached HEAD] in dry-run when repo has detached HEAD (non-tag)', async () => {
      setupPluginConfig([
        {
          type: 'remote',
          alias: 'repo-a',
          url: 'https://github.com/org/repo-a.git',
          ref: 'main',
          depth: 1,
          disableHooks: true,
        },
      ]);
      mockDetectRepoState.mockReturnValue('cloned');
      mockGetCurrentBranch.mockResolvedValue(null);
      mockGetCurrentRef.mockResolvedValue('abc1234');

      await syncExecutor({ dryRun: true }, createContext());

      const infoCalls = mockLoggerInfo.mock.calls.map((c) => String(c[0]));
      const hasDetachedWarning = infoCalls.some(
        (msg) => msg.includes('[WARN: detached HEAD]'),
      );

      expect(hasDetachedWarning).toBe(true);
    });

    it('shows [WARN: tag-pinned] in dry-run when repo is at a tag ref', async () => {
      setupPluginConfig([
        {
          type: 'remote',
          alias: 'repo-a',
          url: 'https://github.com/org/repo-a.git',
          ref: 'v1.2.3',
          depth: 1,
          disableHooks: true,
        },
      ]);
      mockDetectRepoState.mockReturnValue('cloned');
      mockGetCurrentBranch.mockResolvedValue(null);
      mockGetCurrentRef.mockResolvedValue('v1.2.3');

      await syncExecutor({ dryRun: true }, createContext());

      const infoCalls = mockLoggerInfo.mock.calls.map((c) => String(c[0]));
      const hasTagPinnedWarning = infoCalls.some(
        (msg) => msg.includes('[WARN: tag-pinned]'),
      );

      expect(hasTagPinnedWarning).toBe(true);
    });

    it('shows both dirty and detached HEAD warnings in dry-run', async () => {
      setupPluginConfig([
        {
          type: 'remote',
          alias: 'repo-a',
          url: 'https://github.com/org/repo-a.git',
          ref: 'main',
          depth: 1,
          disableHooks: true,
        },
      ]);
      mockDetectRepoState.mockReturnValue('cloned');
      mockGetWorkingTreeState.mockResolvedValue({
        modified: 2,
        staged: 0,
        deleted: 0,
        untracked: 0,
        conflicts: 0,
      });
      mockGetCurrentBranch.mockResolvedValue(null);
      mockGetCurrentRef.mockResolvedValue('abc1234');

      await syncExecutor({ dryRun: true }, createContext());

      const infoCalls = mockLoggerInfo.mock.calls.map((c) => String(c[0]));
      const hasBothWarnings = infoCalls.some(
        (msg) =>
          msg.includes('[WARN: dirty, may fail]') &&
          msg.includes('[WARN: detached HEAD]'),
      );

      expect(hasBothWarnings).toBe(true);
    });

    it('shows both dirty and tag-pinned warnings in dry-run', async () => {
      setupPluginConfig([
        {
          type: 'remote',
          alias: 'repo-a',
          url: 'https://github.com/org/repo-a.git',
          ref: 'v1.2.3',
          depth: 1,
          disableHooks: true,
        },
      ]);
      mockDetectRepoState.mockReturnValue('cloned');
      mockGetWorkingTreeState.mockResolvedValue({
        modified: 1,
        staged: 0,
        deleted: 0,
        untracked: 1,
        conflicts: 0,
      });
      mockGetCurrentBranch.mockResolvedValue(null);
      mockGetCurrentRef.mockResolvedValue('v1.2.3');

      await syncExecutor({ dryRun: true }, createContext());

      const infoCalls = mockLoggerInfo.mock.calls.map((c) => String(c[0]));
      const hasBothWarnings = infoCalls.some(
        (msg) =>
          msg.includes('[WARN: dirty, may fail]') &&
          msg.includes('[WARN: tag-pinned]'),
      );

      expect(hasBothWarnings).toBe(true);
    });

    it('does not call any git commands in dry-run mode', async () => {
      setupPluginConfig([
        {
          type: 'remote',
          alias: 'repo-a',
          url: 'https://github.com/org/repo-a.git',
          ref: 'main',
          depth: 1,
          disableHooks: true,
        },
        {
          type: 'remote',
          alias: 'repo-b',
          url: 'https://github.com/org/repo-b.git',
          ref: 'v1.2.3',
          depth: 1,
          disableHooks: true,
        },
      ]);
      mockDetectRepoState.mockReturnValue('cloned');

      await syncExecutor({ dryRun: true }, createContext());

      expect(mockGitClone).not.toHaveBeenCalled();
      expect(mockGitPull).not.toHaveBeenCalled();
      expect(mockGitFetch).not.toHaveBeenCalled();
      expect(mockGitPullRebase).not.toHaveBeenCalled();
      expect(mockGitPullFfOnly).not.toHaveBeenCalled();
      expect(mockGitFetchTag).not.toHaveBeenCalled();
    });
  });

  describe('summary table', () => {
    it('prints aligned Results table after sync completes', async () => {
      setupPluginConfig([
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
      mockDetectRepoState.mockReturnValue('not-synced');

      await syncExecutor({}, createContext());

      const infoCalls = mockLoggerInfo.mock.calls.map((c) => String(c[0]));
      const hasResults = infoCalls.some((msg) => msg === 'Results:');

      expect(hasResults).toBe(true);
      expect(mockFormatAlignedTable).toHaveBeenCalled();
    });

    it('shows [OK] for successful repos and [ERROR] for failed repos', async () => {
      setupPluginConfig([
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
      mockDetectRepoState.mockReturnValue('not-synced');
      mockGitClone
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('auth denied'));

      await syncExecutor({}, createContext());

      const tableCallArgs = mockFormatAlignedTable.mock.calls[0][0];
      const hasOk = tableCallArgs.some((row: Array<{ value: string }>) =>
        row.some((cell) => cell.value === '[OK]'),
      );
      const hasError = tableCallArgs.some((row: Array<{ value: string }>) =>
        row.some((cell) => cell.value.includes('[ERROR]')),
      );

      expect(hasOk).toBe(true);
      expect(hasError).toBe(true);
    });

    it('summary table appears after streaming progress lines', async () => {
      setupPluginConfig([
        {
          type: 'remote',
          alias: 'repo-a',
          url: 'https://github.com/org/repo-a.git',
          depth: 1,
          disableHooks: true,
        },
      ]);
      mockDetectRepoState.mockReturnValue('not-synced');

      await syncExecutor({}, createContext());

      const infoCalls = mockLoggerInfo.mock.calls.map((c) => String(c[0]));
      const cloningIndex = infoCalls.findIndex((msg) =>
        msg.includes('Cloning'),
      );
      const doneIndex = infoCalls.findIndex((msg) =>
        msg.includes('Done:'),
      );
      const resultsIndex = infoCalls.findIndex((msg) => msg === 'Results:');

      expect(cloningIndex).toBeGreaterThanOrEqual(0);
      expect(doneIndex).toBeGreaterThan(cloningIndex);
      expect(resultsIndex).toBeGreaterThan(doneIndex);
    });

    it('summary line still shows N synced, M failed', async () => {
      setupPluginConfig([
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
      mockDetectRepoState.mockReturnValue('not-synced');
      mockGitClone
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error('failed'));

      await syncExecutor({}, createContext());

      const infoCalls = mockLoggerInfo.mock.calls.map((c) => String(c[0]));
      const summaryLine = infoCalls.find(
        (msg) => msg.includes('synced') && msg.includes('failed'),
      );

      expect(summaryLine).toBeDefined();
      expect(summaryLine).toContain('1 synced');
      expect(summaryLine).toContain('1 failed');
    });
  });

  describe('disableHooks', () => {
    it('passes disableHooks=true to gitClone by default for remote repos', async () => {
      setupPluginConfig([
        {
          type: 'remote',
          alias: 'repo-a',
          url: 'https://github.com/org/repo-a.git',
          depth: 1,
          disableHooks: true,
        },
      ]);
      mockDetectRepoState.mockReturnValue('not-synced');

      await syncExecutor({}, createContext());

      expect(mockGitClone).toHaveBeenCalledWith(
        'https://github.com/org/repo-a.git',
        expect.stringContaining('.repos'),
        expect.objectContaining({ disableHooks: true }),
      );
    });

    it('passes disableHooks=true to gitPull by default for synced remote repos', async () => {
      setupPluginConfig([
        {
          type: 'remote',
          alias: 'repo-a',
          url: 'https://github.com/org/repo-a.git',
          depth: 1,
          disableHooks: true,
        },
      ]);
      mockDetectRepoState.mockReturnValue('cloned');

      await syncExecutor({}, createContext());

      expect(mockGitPull).toHaveBeenCalledWith(
        expect.stringContaining('.repos'),
        true,
      );
    });

    it('passes disableHooks=true to gitFetchTag for tag ref repos', async () => {
      setupPluginConfig([
        {
          type: 'remote',
          alias: 'repo-a',
          url: 'https://github.com/org/repo-a.git',
          ref: 'v1.2.3',
          depth: 1,
          disableHooks: true,
        },
      ]);
      mockDetectRepoState.mockReturnValue('cloned');

      await syncExecutor({}, createContext());

      expect(mockGitFetchTag).toHaveBeenCalledWith(
        expect.stringContaining('.repos'),
        'v1.2.3',
        1,
        true,
      );
    });

    it('does not pass disableHooks for local repos', async () => {
      setupPluginConfig([
        { type: 'local', alias: 'repo-b', path: 'D:/projects/repo-b' },
      ]);
      mockDetectRepoState.mockReturnValue('referenced');

      await syncExecutor({}, createContext());

      expect(mockGitPull).toHaveBeenCalledWith(
        'D:/projects/repo-b',
        undefined,
      );
    });

    it('passes disableHooks=false when explicitly set to false', async () => {
      setupPluginConfig([
        {
          type: 'remote',
          alias: 'repo-a',
          url: 'https://github.com/org/repo-a.git',
          depth: 1,
          disableHooks: false,
        },
      ]);
      mockDetectRepoState.mockReturnValue('cloned');

      await syncExecutor({}, createContext());

      expect(mockGitPull).toHaveBeenCalledWith(
        expect.stringContaining('.repos'),
        false,
      );
    });
  });
});
