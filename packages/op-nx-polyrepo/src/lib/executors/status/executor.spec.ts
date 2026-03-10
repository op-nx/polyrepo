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

vi.mock('../../git/detect', () => ({
  detectRepoState: vi.fn(),
  getCurrentBranch: vi.fn(),
  getCurrentRef: vi.fn(),
}));

import { readFileSync } from 'node:fs';
import { logger } from '@nx/devkit';
import { validateConfig } from '../../config/validate';
import { normalizeRepos } from '../../config/schema';
import type { NormalizedRepoEntry, PolyrepoConfig } from '../../config/schema';
import {
  detectRepoState,
  getCurrentBranch,
  getCurrentRef,
} from '../../git/detect';
import statusExecutor from './executor';

const mockReadFileSync = vi.mocked(readFileSync);
const mockValidateConfig = vi.mocked(validateConfig);
const mockNormalizeRepos = vi.mocked(normalizeRepos);
const mockDetectRepoState = vi.mocked(detectRepoState);
const mockGetCurrentBranch = vi.mocked(getCurrentBranch);
const mockGetCurrentRef = vi.mocked(getCurrentRef);
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

describe('statusExecutor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCurrentBranch.mockResolvedValue('main');
    mockGetCurrentRef.mockResolvedValue('abc1234');
  });

  it('shows "cloned" state with path for synced remote repos', async () => {
    setupPluginConfig([
      {
        type: 'remote',
        alias: 'repo-a',
        url: 'https://github.com/org/repo-a.git',
        depth: 1,
      },
    ]);
    mockDetectRepoState.mockReturnValue('cloned');

    await statusExecutor({}, createContext());

    const clonedCall = mockLoggerInfo.mock.calls.find(
      (call) =>
        typeof call[0] === 'string' &&
        call[0].includes('repo-a') &&
        call[0].includes('cloned'),
    );

    expect(clonedCall).toBeDefined();
    expect(clonedCall![0]).toContain('.repos/repo-a');
  });

  it('shows "referenced" state with path for local repos that exist', async () => {
    setupPluginConfig([
      { type: 'local', alias: 'repo-b', path: 'D:/projects/repo-b' },
    ]);
    mockDetectRepoState.mockReturnValue('referenced');

    await statusExecutor({}, createContext());

    const refCall = mockLoggerInfo.mock.calls.find(
      (call) =>
        typeof call[0] === 'string' &&
        call[0].includes('repo-b') &&
        call[0].includes('referenced'),
    );

    expect(refCall).toBeDefined();
    expect(refCall![0]).toContain('D:/projects/repo-b');
  });

  it('shows "not synced" state with URL for remote repos not yet cloned', async () => {
    setupPluginConfig([
      {
        type: 'remote',
        alias: 'repo-c',
        url: 'git@github.com:org/repo-c.git',
        depth: 1,
      },
    ]);
    mockDetectRepoState.mockReturnValue('not-synced');

    await statusExecutor({}, createContext());

    const notSyncedCall = mockLoggerInfo.mock.calls.find(
      (call) =>
        typeof call[0] === 'string' &&
        call[0].includes('repo-c') &&
        call[0].includes('not synced'),
    );

    expect(notSyncedCall).toBeDefined();

    const urlCall = mockLoggerInfo.mock.calls.find(
      (call) =>
        typeof call[0] === 'string' &&
        call[0].includes('git@github.com:org/repo-c.git'),
    );

    expect(urlCall).toBeDefined();
  });

  it('shows current branch for synced repos', async () => {
    setupPluginConfig([
      {
        type: 'remote',
        alias: 'repo-a',
        url: 'https://github.com/org/repo-a.git',
        depth: 1,
      },
    ]);
    mockDetectRepoState.mockReturnValue('cloned');
    mockGetCurrentBranch.mockResolvedValue('main');

    await statusExecutor({}, createContext());

    const branchCall = mockLoggerInfo.mock.calls.find(
      (call) =>
        typeof call[0] === 'string' &&
        call[0].includes('branch:') &&
        call[0].includes('main'),
    );

    expect(branchCall).toBeDefined();
  });

  it('shows configured ref alongside current branch', async () => {
    setupPluginConfig([
      {
        type: 'remote',
        alias: 'repo-a',
        url: 'https://github.com/org/repo-a.git',
        ref: 'develop',
        depth: 1,
      },
    ]);
    mockDetectRepoState.mockReturnValue('cloned');
    mockGetCurrentBranch.mockResolvedValue('develop');

    await statusExecutor({}, createContext());

    const configuredCall = mockLoggerInfo.mock.calls.find(
      (call) =>
        typeof call[0] === 'string' && call[0].includes('configured: develop'),
    );

    expect(configuredCall).toBeDefined();
  });

  it('shows [DRIFT] marker when current branch differs from configured ref', async () => {
    setupPluginConfig([
      {
        type: 'remote',
        alias: 'repo-a',
        url: 'https://github.com/org/repo-a.git',
        ref: 'develop',
        depth: 1,
      },
    ]);
    mockDetectRepoState.mockReturnValue('cloned');
    mockGetCurrentBranch.mockResolvedValue('feature-x');

    await statusExecutor({}, createContext());

    const driftCall = mockLoggerInfo.mock.calls.find(
      (call) => typeof call[0] === 'string' && call[0].includes('[DRIFT]'),
    );

    expect(driftCall).toBeDefined();
  });

  it('does not show [DRIFT] when configured ref is undefined (default branch)', async () => {
    setupPluginConfig([
      {
        type: 'remote',
        alias: 'repo-a',
        url: 'https://github.com/org/repo-a.git',
        depth: 1,
      },
    ]);
    mockDetectRepoState.mockReturnValue('cloned');
    mockGetCurrentBranch.mockResolvedValue('main');

    await statusExecutor({}, createContext());

    const allCalls = mockLoggerInfo.mock.calls.map((call) => call[0]);
    const hasDrift = allCalls.some(
      (msg) => typeof msg === 'string' && msg.includes('[DRIFT]'),
    );

    expect(hasDrift).toBe(false);
  });

  it('does not show [DRIFT] when current branch matches configured ref', async () => {
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
    mockGetCurrentBranch.mockResolvedValue('main');

    await statusExecutor({}, createContext());

    const allCalls = mockLoggerInfo.mock.calls.map((call) => call[0]);
    const hasDrift = allCalls.some(
      (msg) => typeof msg === 'string' && msg.includes('[DRIFT]'),
    );

    expect(hasDrift).toBe(false);
  });

  it('always returns { success: true } (informational command)', async () => {
    setupPluginConfig([
      {
        type: 'remote',
        alias: 'repo-a',
        url: 'https://github.com/org/repo-a.git',
        depth: 1,
      },
    ]);
    mockDetectRepoState.mockReturnValue('cloned');

    const result = await statusExecutor({}, createContext());

    expect(result).toEqual({ success: true });
  });

  it('handles errors in individual repo detection gracefully (logs warning, continues)', async () => {
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
    mockDetectRepoState
      .mockImplementationOnce(() => {
        throw new Error('detect failed');
      })
      .mockReturnValueOnce('cloned');
    mockGetCurrentBranch.mockResolvedValue('main');

    const result = await statusExecutor({}, createContext());

    expect(result).toEqual({ success: true });
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.stringContaining('repo-a'),
    );
    // repo-b should still be processed
    const repoBCall = mockLoggerInfo.mock.calls.find(
      (call) => typeof call[0] === 'string' && call[0].includes('repo-b'),
    );

    expect(repoBCall).toBeDefined();
  });
});
