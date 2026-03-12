import { createHash } from 'node:crypto';
import { describe, it, expect, vi } from 'vitest';
import type { ExecutorContext } from '@nx/devkit';

// Mock dependencies before importing executor
vi.mock('node:fs', () => ({
  readFileSync: vi.fn(),
  existsSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
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
  gitCheckoutBranch: vi.fn(),
}));

vi.mock('../../git/detect', () => ({
  detectRepoState: vi.fn(),
  getWorkingTreeState: vi.fn(),
  getCurrentBranch: vi.fn(),
  getCurrentRef: vi.fn(),
  isGitTag: vi.fn(),
}));

vi.mock('../../format/table', () => ({
  formatAlignedTable: vi.fn((rows: Array<Array<{ value: string }>>) =>
    rows.map((r) => r.map((c) => c.value).join(' | ')),
  ),
}));

import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { logger } from '@nx/devkit';
import { createMockChildProcess } from '../../testing/mock-child-process';
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
  gitCheckoutBranch,
} from '../../git/commands';
import {
  detectRepoState,
  getWorkingTreeState,
  getCurrentBranch,
  getCurrentRef,
  isGitTag,
} from '../../git/detect';
import { formatAlignedTable } from '../../format/table';
import syncExecutor from './executor';

const mockReadFileSync = vi.mocked(readFileSync);
const mockExistsSync = vi.mocked(existsSync);
const mockWriteFileSync = vi.mocked(writeFileSync);
const mockSpawn = vi.mocked(spawn);
const mockValidateConfig = vi.mocked(validateConfig);
const mockNormalizeRepos = vi.mocked(normalizeRepos);
const mockGitClone = vi.mocked(gitClone);
const mockGitPull = vi.mocked(gitPull);
const mockGitFetch = vi.mocked(gitFetch);
const mockGitPullRebase = vi.mocked(gitPullRebase);
const mockGitPullFfOnly = vi.mocked(gitPullFfOnly);
const mockGitFetchTag = vi.mocked(gitFetchTag);
const mockGitCheckoutBranch = vi.mocked(gitCheckoutBranch);
const mockDetectRepoState = vi.mocked(detectRepoState);
const mockGetWorkingTreeState = vi.mocked(getWorkingTreeState);
const mockGetCurrentBranch = vi.mocked(getCurrentBranch);
const mockGetCurrentRef = vi.mocked(getCurrentRef);
const mockIsGitTag = vi.mocked(isGitTag);
const mockFormatAlignedTable = vi.mocked(formatAlignedTable);
const mockLoggerInfo = vi.mocked(logger.info);
const mockLoggerWarn = vi.mocked(logger.warn);

function createTestContext(
  overrides?: Partial<ExecutorContext>,
): ExecutorContext {
  return {
    root: '/workspace',
    cwd: '/workspace',
    isVerbose: false,
    projectsConfigurations: { version: 2, projects: {} },
    nxJsonConfiguration: {},
    projectGraph: { nodes: {}, dependencies: {} },
    ...overrides,
  };
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

function setup(): void {
  vi.clearAllMocks();
  mockGitClone.mockResolvedValue(undefined);
  mockGitPull.mockResolvedValue(undefined);
  mockGitFetch.mockResolvedValue(undefined);
  mockGitPullRebase.mockResolvedValue(undefined);
  mockGitPullFfOnly.mockResolvedValue(undefined);
  mockGitFetchTag.mockResolvedValue(undefined);
  // Default: isGitTag returns false (most tests don't involve tags)
  mockIsGitTag.mockResolvedValue(false);
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
  // Default: spawn (used for install) succeeds immediately
  mockSpawn.mockImplementation(() => createMockChildProcess(0));
}

describe('syncExecutor', () => {
  it('clones remote repo when .repos/<alias> does not exist', async () => {
    setup();
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

    const result = await syncExecutor({}, createTestContext());

    expect(mockGitClone).toHaveBeenCalledWith(
      'https://github.com/org/repo-a.git',
      expect.stringContaining('.repos'),
      expect.objectContaining({ depth: 1 }),
    );
    expect(result).toEqual({ success: true });
  });

  it('pulls remote repo when .repos/<alias> already exists and ref is a branch', async () => {
    setup();
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

    const result = await syncExecutor({}, createTestContext());

    expect(mockGitPull).toHaveBeenCalled();
    expect(mockGitClone).not.toHaveBeenCalled();
    expect(result).toEqual({ success: true });
  });

  it('re-fetches tag when .repos/<alias> already exists and ref looks like a tag', async () => {
    setup();
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
    mockIsGitTag.mockResolvedValue(true);

    const result = await syncExecutor({}, createTestContext());

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
    setup();
    setupPluginConfig([
      { type: 'local', alias: 'repo-b', path: 'D:/projects/repo-b' },
    ]);
    mockDetectRepoState.mockReturnValue('referenced');

    const result = await syncExecutor({}, createTestContext());

    expect(mockGitPull).toHaveBeenCalledWith('D:/projects/repo-b', undefined);
    expect(result).toEqual({ success: true });
  });

  it('skips local path repo pull when path does not exist (warns)', async () => {
    setup();
    setupPluginConfig([
      { type: 'local', alias: 'repo-b', path: 'D:/projects/repo-b' },
    ]);
    mockDetectRepoState.mockReturnValue('not-synced');

    const result = await syncExecutor({}, createTestContext());

    expect(mockGitPull).not.toHaveBeenCalled();
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.stringContaining('repo-b'),
    );
    expect(result).toEqual({ success: true });
  });

  it('uses configured depth for clone (depth:0 = full)', async () => {
    setup();
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

    await syncExecutor({}, createTestContext());

    expect(mockGitClone).toHaveBeenCalledWith(
      'https://github.com/org/repo-a.git',
      expect.any(String),
      expect.objectContaining({ depth: 0 }),
    );
  });

  it('uses configured ref as --branch during clone', async () => {
    setup();
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

    await syncExecutor({}, createTestContext());

    expect(mockGitClone).toHaveBeenCalledWith(
      'https://github.com/org/repo-a.git',
      expect.any(String),
      expect.objectContaining({ ref: 'develop' }),
    );
  });

  it('processes all repos in parallel (Promise.allSettled)', async () => {
    setup();
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

    const result = await syncExecutor({}, createTestContext());

    // All three repos processed
    expect(mockGitClone).toHaveBeenCalledTimes(2);
    expect(mockLoggerWarn).toHaveBeenCalled(); // local repo not found
    expect(result).toEqual({ success: true });
  });

  it('returns { success: true } when all repos succeed', async () => {
    setup();
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

    const result = await syncExecutor({}, createTestContext());

    expect(result).toEqual({ success: true });
  });

  it('returns { success: false } when any repo fails', async () => {
    setup();
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

    const result = await syncExecutor({}, createTestContext());

    expect(result).toEqual({ success: false });
  });

  it('logs per-repo results (cloning/pulling/done/failed)', async () => {
    setup();
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

    await syncExecutor({}, createTestContext());

    expect(mockLoggerInfo).toHaveBeenCalledWith(
      expect.stringContaining('repo-a'),
    );
  });

  it('logs summary at end (N synced, M failed)', async () => {
    setup();
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

    await syncExecutor({}, createTestContext());

    const summaryCall = mockLoggerInfo.mock.calls.find(
      (call) => typeof call[0] === 'string' && call[0].includes('synced'),
    );

    expect(summaryCall).toBeDefined();
  });

  describe('dependency installation', () => {
    function setupSpawnMockSuccess(): void {
      mockSpawn.mockImplementation(() => createMockChildProcess(0));
    }

    function setupSpawnMockFailure(): void {
      mockSpawn.mockImplementation(() => createMockChildProcess(1));
    }

    it('runs npm install after cloning when package-lock.json detected', async () => {
      setup();
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
      setupSpawnMockSuccess();

      await syncExecutor({}, createTestContext());

      expect(mockSpawn).toHaveBeenCalledWith(
        'npm install --loglevel=error',
        expect.objectContaining({
          cwd: expect.stringContaining('.repos'),
          shell: true,
          windowsHide: true,
        }),
      );
    });

    it('runs pnpm install after cloning when pnpm-lock.yaml detected', async () => {
      setup();
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
      setupSpawnMockSuccess();

      await syncExecutor({}, createTestContext());

      expect(mockSpawn).toHaveBeenCalledWith(
        'pnpm install --reporter=silent',
        expect.objectContaining({
          cwd: expect.stringContaining('.repos'),
          shell: true,
          windowsHide: true,
        }),
      );
    });

    it('runs yarn after cloning when yarn.lock detected', async () => {
      setup();
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
      setupSpawnMockSuccess();

      await syncExecutor({}, createTestContext());

      expect(mockSpawn).toHaveBeenCalledWith(
        'yarn install --silent',
        expect.objectContaining({
          cwd: expect.stringContaining('.repos'),
          shell: true,
          windowsHide: true,
        }),
      );
    });

    it('runs install after pulling an existing remote repo', async () => {
      setup();
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
      setupSpawnMockSuccess();

      await syncExecutor({}, createTestContext());

      expect(mockSpawn).toHaveBeenCalledWith(
        'npm install --loglevel=error',
        expect.objectContaining({
          cwd: expect.stringContaining('.repos'),
          shell: true,
          windowsHide: true,
        }),
      );
    });

    it('runs install for local path repos that are updated', async () => {
      setup();
      setupPluginConfig([
        { type: 'local', alias: 'repo-b', path: 'D:/projects/repo-b' },
      ]);
      mockDetectRepoState.mockReturnValue('referenced');
      mockExistsSync.mockReturnValue(false);
      setupSpawnMockSuccess();

      await syncExecutor({}, createTestContext());

      expect(mockSpawn).toHaveBeenCalledWith(
        'npm install --loglevel=error',
        expect.objectContaining({
          cwd: 'D:/projects/repo-b',
          shell: true,
          windowsHide: true,
        }),
      );
    });

    it('uses corepack when package.json has packageManager field', async () => {
      setup();
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
          plugins: [{ plugin: '@op-nx/polyrepo', options: fakeConfig }],
        });
      });
      // package.json exists in repo
      mockExistsSync.mockImplementation((path: unknown) => {
        if (typeof path === 'string' && path.includes('package.json')) {
          return true;
        }

        return false;
      });
      setupSpawnMockSuccess();

      await syncExecutor({}, createTestContext());

      expect(mockSpawn).toHaveBeenCalledWith(
        'corepack pnpm install --reporter=silent',
        expect.objectContaining({
          cwd: expect.stringContaining('.repos'),
          shell: true,
          windowsHide: true,
        }),
      );
    });

    it('uses corepack for yarn when package.json specifies yarn', async () => {
      setup();
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
          plugins: [{ plugin: '@op-nx/polyrepo', options: fakeConfig }],
        });
      });
      mockExistsSync.mockImplementation((path: unknown) => {
        if (typeof path === 'string' && path.includes('package.json')) {
          return true;
        }

        return false;
      });
      setupSpawnMockSuccess();

      await syncExecutor({}, createTestContext());

      expect(mockSpawn).toHaveBeenCalledWith(
        'corepack yarn install --silent',
        expect.objectContaining({
          cwd: expect.stringContaining('.repos'),
          shell: true,
          windowsHide: true,
        }),
      );
    });

    it('falls back to lock file detection when no packageManager field', async () => {
      setup();
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
          plugins: [{ plugin: '@op-nx/polyrepo', options: fakeConfig }],
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
      setupSpawnMockSuccess();

      await syncExecutor({}, createTestContext());

      expect(mockSpawn).toHaveBeenCalledWith(
        'pnpm install --reporter=silent',
        expect.objectContaining({
          cwd: expect.stringContaining('.repos'),
          shell: true,
          windowsHide: true,
        }),
      );
    });

    it('closes stdin to suppress interactive prompts and pipes stdout/stderr', async () => {
      setup();
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
      setupSpawnMockSuccess();

      await syncExecutor({}, createTestContext());

      expect(mockSpawn).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          stdio: ['ignore', 'pipe', 'pipe'],
          env: expect.objectContaining({
            COREPACK_ENABLE_DOWNLOAD_PROMPT: '0',
          }),
        }),
      );
    });

    it('install failure logs warning but does not fail the sync', async () => {
      setup();
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
      setupSpawnMockFailure();

      const result = await syncExecutor({}, createTestContext());

      expect(mockLoggerWarn).toHaveBeenCalledWith(
        expect.stringContaining('repo-a'),
      );
      expect(result).toEqual({ success: true });
    });
  });

  describe('strategy option', () => {
    it('defaults to pull strategy', async () => {
      setup();
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

      await syncExecutor({}, createTestContext());

      expect(mockGitPull).toHaveBeenCalled();
    });

    it('strategy "fetch" calls gitFetch instead of gitPull', async () => {
      setup();
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

      await syncExecutor({ strategy: 'fetch' }, createTestContext());

      expect(mockGitFetch).toHaveBeenCalled();
      expect(mockGitPull).not.toHaveBeenCalled();
    });

    it('strategy "rebase" calls gitPullRebase', async () => {
      setup();
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

      await syncExecutor({ strategy: 'rebase' }, createTestContext());

      expect(mockGitPullRebase).toHaveBeenCalled();
      expect(mockGitPull).not.toHaveBeenCalled();
    });

    it('strategy "ff-only" calls gitPullFfOnly', async () => {
      setup();
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

      await syncExecutor({ strategy: 'ff-only' }, createTestContext());

      expect(mockGitPullFfOnly).toHaveBeenCalled();
      expect(mockGitPull).not.toHaveBeenCalled();
    });
  });

  describe('dry-run mode', () => {
    it('shows "would clone" for unsynced remote repos', async () => {
      setup();
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

      await syncExecutor({ dryRun: true }, createTestContext());

      const infoCalls = mockLoggerInfo.mock.calls.map((c) => String(c[0]));
      const hasWouldClone = infoCalls.some(
        (msg) => msg.includes('repo-a') && msg.includes('would clone'),
      );

      expect(hasWouldClone).toBe(true);
      expect(mockGitClone).not.toHaveBeenCalled();
    });

    it('shows "would pull" for synced remote repos with branch ref', async () => {
      setup();
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

      await syncExecutor({ dryRun: true }, createTestContext());

      const infoCalls = mockLoggerInfo.mock.calls.map((c) => String(c[0]));
      const hasWouldPull = infoCalls.some(
        (msg) => msg.includes('repo-a') && msg.includes('would pull'),
      );

      expect(hasWouldPull).toBe(true);
      expect(mockGitPull).not.toHaveBeenCalled();
    });

    it('shows "would sync to tag" for synced remote repos with tag ref', async () => {
      setup();
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
      mockIsGitTag.mockResolvedValue(true);

      await syncExecutor({ dryRun: true }, createTestContext());

      const infoCalls = mockLoggerInfo.mock.calls.map((c) => String(c[0]));
      const hasWouldSwitchToTag = infoCalls.some(
        (msg) => msg.includes('repo-a') && msg.includes('would sync to tag'),
      );

      expect(hasWouldSwitchToTag).toBe(true);
      expect(mockGitFetchTag).not.toHaveBeenCalled();
    });

    it('shows dirty warning in dry-run when working tree is dirty', async () => {
      setup();
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

      await syncExecutor({ dryRun: true }, createTestContext());

      const infoCalls = mockLoggerInfo.mock.calls.map((c) => String(c[0]));
      const hasDirtyWarning = infoCalls.some((msg) =>
        msg.includes('[WARN: dirty, may fail]'),
      );

      expect(hasDirtyWarning).toBe(true);
    });

    it('shows "would skip" for local repos that do not exist', async () => {
      setup();
      setupPluginConfig([
        { type: 'local', alias: 'repo-b', path: 'D:/projects/repo-b' },
      ]);
      mockDetectRepoState.mockReturnValue('not-synced');

      await syncExecutor({ dryRun: true }, createTestContext());

      const infoCalls = mockLoggerInfo.mock.calls.map((c) => String(c[0]));
      const hasWouldSkip = infoCalls.some(
        (msg) => msg.includes('repo-b') && msg.includes('would skip'),
      );

      expect(hasWouldSkip).toBe(true);
    });

    it('returns success:true in dry-run mode', async () => {
      setup();
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

      const result = await syncExecutor({ dryRun: true }, createTestContext());

      expect(result).toEqual({ success: true });
    });

    it('shows [WARN: detached HEAD] in dry-run when repo has detached HEAD (non-tag)', async () => {
      setup();
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

      await syncExecutor({ dryRun: true }, createTestContext());

      const infoCalls = mockLoggerInfo.mock.calls.map((c) => String(c[0]));
      const hasDetachedWarning = infoCalls.some((msg) =>
        msg.includes('[WARN: detached HEAD]'),
      );

      expect(hasDetachedWarning).toBe(true);
    });

    it('shows [WARN: tag-pinned] in dry-run when repo is at a tag ref', async () => {
      setup();
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
      mockIsGitTag.mockResolvedValue(true);

      await syncExecutor({ dryRun: true }, createTestContext());

      const infoCalls = mockLoggerInfo.mock.calls.map((c) => String(c[0]));
      const hasTagPinnedWarning = infoCalls.some((msg) =>
        msg.includes('[WARN: tag-pinned]'),
      );

      expect(hasTagPinnedWarning).toBe(true);
    });

    it('shows both dirty and detached HEAD warnings in dry-run', async () => {
      setup();
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

      await syncExecutor({ dryRun: true }, createTestContext());

      const infoCalls = mockLoggerInfo.mock.calls.map((c) => String(c[0]));
      const hasBothWarnings = infoCalls.some(
        (msg) =>
          msg.includes('[WARN: dirty, may fail]') &&
          msg.includes('[WARN: detached HEAD]'),
      );

      expect(hasBothWarnings).toBe(true);
    });

    it('shows both dirty and tag-pinned warnings in dry-run', async () => {
      setup();
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
      mockIsGitTag.mockResolvedValue(true);

      await syncExecutor({ dryRun: true }, createTestContext());

      const infoCalls = mockLoggerInfo.mock.calls.map((c) => String(c[0]));
      const hasBothWarnings = infoCalls.some(
        (msg) =>
          msg.includes('[WARN: dirty, may fail]') &&
          msg.includes('[WARN: tag-pinned]'),
      );

      expect(hasBothWarnings).toBe(true);
    });

    it('does not call any git commands in dry-run mode', async () => {
      setup();
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

      await syncExecutor({ dryRun: true }, createTestContext());

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
      setup();
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

      await syncExecutor({}, createTestContext());

      const infoCalls = mockLoggerInfo.mock.calls.map((c) => String(c[0]));
      const hasResults = infoCalls.some((msg) => msg === 'Results:');

      expect(hasResults).toBe(true);
      expect(mockFormatAlignedTable).toHaveBeenCalled();
    });

    it('shows [OK] for successful repos and [ERROR] for failed repos', async () => {
      setup();
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

      await syncExecutor({}, createTestContext());

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
      setup();
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

      await syncExecutor({}, createTestContext());

      const infoCalls = mockLoggerInfo.mock.calls.map((c) => String(c[0]));
      const cloningIndex = infoCalls.findIndex((msg) =>
        msg.includes('Cloning'),
      );
      const doneIndex = infoCalls.findIndex((msg) => msg.includes('Done:'));
      const resultsIndex = infoCalls.findIndex((msg) => msg === 'Results:');

      expect(cloningIndex).toBeGreaterThanOrEqual(0);
      expect(doneIndex).toBeGreaterThan(cloningIndex);
      expect(resultsIndex).toBeGreaterThan(doneIndex);
    });

    it('summary line still shows N synced, M failed', async () => {
      setup();
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

      await syncExecutor({}, createTestContext());

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
      setup();
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

      await syncExecutor({}, createTestContext());

      expect(mockGitClone).toHaveBeenCalledWith(
        'https://github.com/org/repo-a.git',
        expect.stringContaining('.repos'),
        expect.objectContaining({ disableHooks: true }),
      );
    });

    it('passes disableHooks=true to gitPull by default for synced remote repos', async () => {
      setup();
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

      await syncExecutor({}, createTestContext());

      expect(mockGitPull).toHaveBeenCalledWith(
        expect.stringContaining('.repos'),
        true,
      );
    });

    it('passes disableHooks=true to gitFetchTag for tag ref repos', async () => {
      setup();
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
      mockIsGitTag.mockResolvedValue(true);

      await syncExecutor({}, createTestContext());

      expect(mockGitFetchTag).toHaveBeenCalledWith(
        expect.stringContaining('.repos'),
        'v1.2.3',
        1,
        true,
      );
    });

    it('does not pass disableHooks for local repos', async () => {
      setup();
      setupPluginConfig([
        { type: 'local', alias: 'repo-b', path: 'D:/projects/repo-b' },
      ]);
      mockDetectRepoState.mockReturnValue('referenced');

      await syncExecutor({}, createTestContext());

      expect(mockGitPull).toHaveBeenCalledWith('D:/projects/repo-b', undefined);
    });

    it('passes disableHooks=false when explicitly set to false', async () => {
      setup();
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

      await syncExecutor({}, createTestContext());

      expect(mockGitPull).toHaveBeenCalledWith(
        expect.stringContaining('.repos'),
        false,
      );
    });
  });

  describe('branch transition (tag-to-branch, branch-to-branch)', () => {
    it('checks out target branch when repo is on detached HEAD (tag-to-branch)', async () => {
      setup();
      setupPluginConfig([
        {
          type: 'remote',
          alias: 'repo-a',
          url: 'https://github.com/org/repo-a.git',
          ref: 'master',
          depth: 1,
          disableHooks: true,
        },
      ]);
      mockDetectRepoState.mockReturnValue('cloned');
      mockIsGitTag.mockResolvedValue(false);
      mockGetCurrentBranch.mockResolvedValue(null); // detached HEAD

      await syncExecutor({}, createTestContext());

      expect(mockGitCheckoutBranch).toHaveBeenCalledWith(
        expect.stringContaining('.repos'),
        'master',
        true,
      );
      expect(mockGitPull).toHaveBeenCalled();
    });

    it('checks out target branch when repo is on wrong branch', async () => {
      setup();
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
      mockIsGitTag.mockResolvedValue(false);
      mockGetCurrentBranch.mockResolvedValue('develop'); // wrong branch

      await syncExecutor({}, createTestContext());

      expect(mockGitCheckoutBranch).toHaveBeenCalledWith(
        expect.stringContaining('.repos'),
        'main',
        true,
      );
      expect(mockGitPull).toHaveBeenCalled();
    });

    it('skips checkout when already on the correct branch', async () => {
      setup();
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
      mockIsGitTag.mockResolvedValue(false);
      mockGetCurrentBranch.mockResolvedValue('main'); // already on correct branch

      await syncExecutor({}, createTestContext());

      expect(mockGitCheckoutBranch).not.toHaveBeenCalled();
      expect(mockGitPull).toHaveBeenCalled();
    });

    it('skips checkout when ref is undefined', async () => {
      setup();
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
      mockIsGitTag.mockResolvedValue(false);

      await syncExecutor({}, createTestContext());

      expect(mockGitCheckoutBranch).not.toHaveBeenCalled();
      expect(mockGitPull).toHaveBeenCalled();
    });

    it('dry-run shows "would switch to branch and pull" when on detached HEAD', async () => {
      setup();
      setupPluginConfig([
        {
          type: 'remote',
          alias: 'repo-a',
          url: 'https://github.com/org/repo-a.git',
          ref: 'master',
          depth: 1,
          disableHooks: true,
        },
      ]);
      mockDetectRepoState.mockReturnValue('cloned');
      mockIsGitTag.mockResolvedValue(false);
      mockGetCurrentBranch.mockResolvedValue(null); // detached HEAD

      await syncExecutor({ dryRun: true }, createTestContext());

      const infoCalls = mockLoggerInfo.mock.calls.map((c) => String(c[0]));
      const hasSwitch = infoCalls.some(
        (msg) =>
          msg.includes('repo-a') &&
          msg.includes('would switch to master and pull'),
      );

      expect(hasSwitch).toBe(true);
      expect(mockGitCheckoutBranch).not.toHaveBeenCalled();
    });

    it('logs switching message before checkout', async () => {
      setup();
      setupPluginConfig([
        {
          type: 'remote',
          alias: 'repo-a',
          url: 'https://github.com/org/repo-a.git',
          ref: 'master',
          depth: 1,
          disableHooks: true,
        },
      ]);
      mockDetectRepoState.mockReturnValue('cloned');
      mockIsGitTag.mockResolvedValue(false);
      mockGetCurrentBranch.mockResolvedValue(null);

      await syncExecutor({}, createTestContext());

      const infoCalls = mockLoggerInfo.mock.calls.map((c) => String(c[0]));
      const hasSwitchMsg = infoCalls.some((msg) =>
        msg.includes('Switching repo-a to branch master'),
      );

      expect(hasSwitchMsg).toBe(true);
    });
  });

  describe('conditional dependency installation', () => {
    function setupSpawnMockSuccess(): void {
      mockSpawn.mockImplementation(() => createMockChildProcess(0));
    }

    /**
     * Simulate deps already installed: lockfile exists and stored hash matches.
     * needsInstall() returns false.
     */
    function setupDepsInstalled(): void {
      const nxJsonContent = JSON.stringify({
        plugins: [{ plugin: '@op-nx/polyrepo', options: fakeConfig }],
      });
      const lockContent = Buffer.from('lockfile-content');
      const hash = createHash('sha256').update(lockContent).digest('hex');
      mockExistsSync.mockImplementation((p) => {
        const path = String(p);

        if (path.endsWith('pnpm-lock.yaml')) {
          return true;
        }

        if (path.endsWith('.lock-hash')) {
          return true;
        }

        return false;
      });
      mockReadFileSync.mockImplementation((p) => {
        const path = String(p);

        if (path.endsWith('nx.json')) {
          return nxJsonContent;
        }

        if (path.endsWith('pnpm-lock.yaml')) {
          return lockContent;
        }

        if (path.endsWith('.lock-hash')) {
          return hash;
        }

        return '';
      });
    }

    /**
     * Simulate deps need install: lockfile exists but no stored hash file.
     * needsInstall() returns true.
     */
    function setupDepsNotInstalled(): void {
      const nxJsonContent = JSON.stringify({
        plugins: [{ plugin: '@op-nx/polyrepo', options: fakeConfig }],
      });
      mockExistsSync.mockImplementation((p) => {
        if (String(p).endsWith('pnpm-lock.yaml')) {
          return true;
        }

        return false;
      });
      mockReadFileSync.mockImplementation((p) => {
        if (String(p).endsWith('nx.json')) {
          return nxJsonContent;
        }

        if (String(p).endsWith('pnpm-lock.yaml')) {
          return Buffer.from('lockfile-content');
        }

        return '';
      });
    }

    it('skips install when lockfile hash matches stored hash (deps up to date)', async () => {
      setup();
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
      mockIsGitTag.mockResolvedValue(true);
      setupDepsInstalled();
      setupSpawnMockSuccess();

      await syncExecutor({}, createTestContext());

      expect(mockSpawn).not.toHaveBeenCalled();
    });

    it('installs when no stored hash exists (first install or failed previous)', async () => {
      setup();
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
      mockIsGitTag.mockResolvedValue(true);
      setupDepsNotInstalled();
      setupSpawnMockSuccess();

      await syncExecutor({}, createTestContext());

      expect(mockSpawn).toHaveBeenCalledWith(
        expect.stringContaining('install'),
        expect.objectContaining({ shell: true, windowsHide: true }),
      );
    });

    it('installs after pull when no stored hash exists', async () => {
      setup();
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
      setupDepsNotInstalled();
      setupSpawnMockSuccess();

      await syncExecutor({}, createTestContext());

      expect(mockSpawn).toHaveBeenCalledWith(
        expect.stringContaining('install'),
        expect.objectContaining({ shell: true, windowsHide: true }),
      );
    });

    it('skips install after pull when deps already installed', async () => {
      setup();
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
      setupDepsInstalled();
      setupSpawnMockSuccess();

      await syncExecutor({}, createTestContext());

      expect(mockSpawn).not.toHaveBeenCalled();
    });

    it('always installs after clone (new repo)', async () => {
      setup();
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
      setupSpawnMockSuccess();

      await syncExecutor({}, createTestContext());

      expect(mockSpawn).toHaveBeenCalledWith(
        expect.stringContaining('install'),
        expect.objectContaining({ shell: true, windowsHide: true }),
      );
    });

    it('installs when no lockfile exists (cannot determine if deps changed)', async () => {
      setup();
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
      // Default existsSync returns false -> no lockfile found
      setupSpawnMockSuccess();

      await syncExecutor({}, createTestContext());

      expect(mockSpawn).toHaveBeenCalledWith(
        expect.stringContaining('install'),
        expect.objectContaining({ shell: true, windowsHide: true }),
      );
    });

    it('retries install when previous install failed (no stored hash written)', async () => {
      setup();
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
      mockIsGitTag.mockResolvedValue(true);
      // Lockfile exists but no stored hash -> needsInstall returns true
      setupDepsNotInstalled();
      setupSpawnMockSuccess();

      await syncExecutor({}, createTestContext());

      expect(mockSpawn).toHaveBeenCalledWith(
        expect.stringContaining('install'),
        expect.objectContaining({ shell: true, windowsHide: true }),
      );
    });

    it('writes stored hash after successful install', async () => {
      setup();
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
      setupDepsNotInstalled();
      setupSpawnMockSuccess();

      await syncExecutor({}, createTestContext());

      expect(mockWriteFileSync).toHaveBeenCalledWith(
        expect.stringContaining('.lock-hash'),
        expect.any(String),
      );
    });

    it('does not write stored hash when install fails', async () => {
      setup();
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
      mockSpawn.mockImplementation(() => createMockChildProcess(1));

      await syncExecutor({}, createTestContext());

      const hashWrites = mockWriteFileSync.mock.calls.filter((call) =>
        String(call[0]).endsWith('.lock-hash'),
      );

      expect(hashWrites).toHaveLength(0);
    });

    it('skips install for local repo when deps already installed', async () => {
      setup();
      setupPluginConfig([
        { type: 'local', alias: 'repo-b', path: 'D:/projects/repo-b' },
      ]);
      mockDetectRepoState.mockReturnValue('referenced');
      setupDepsInstalled();
      setupSpawnMockSuccess();

      await syncExecutor({}, createTestContext());

      expect(mockSpawn).not.toHaveBeenCalled();
    });
  });
});
