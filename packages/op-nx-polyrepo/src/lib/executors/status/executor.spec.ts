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
  readJsonFile: vi.fn(),
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
  getWorkingTreeState: vi.fn(),
  getAheadBehind: vi.fn(),
}));

vi.mock('../../git/commands', () => ({
  gitFetch: vi.fn(),
}));

vi.mock('../../format/table', () => ({
  formatAlignedTable: vi.fn(),
}));

import { readFileSync } from 'node:fs';
import { logger, readJsonFile } from '@nx/devkit';
import { validateConfig } from '../../config/validate';
import { normalizeRepos } from '../../config/schema';
import type { NormalizedRepoEntry, PolyrepoConfig } from '../../config/schema';
import {
  detectRepoState,
  getCurrentBranch,
  getCurrentRef,
  getWorkingTreeState,
  getAheadBehind,
} from '../../git/detect';
import { gitFetch } from '../../git/commands';
import { formatAlignedTable } from '../../format/table';
import type { ColumnDef } from '../../format/table';
import statusExecutor from './executor';

const mockReadFileSync = vi.mocked(readFileSync);
const mockReadJsonFile = vi.mocked(readJsonFile);
const mockValidateConfig = vi.mocked(validateConfig);
const mockNormalizeRepos = vi.mocked(normalizeRepos);
const mockDetectRepoState = vi.mocked(detectRepoState);
const mockGetCurrentBranch = vi.mocked(getCurrentBranch);
const mockGetCurrentRef = vi.mocked(getCurrentRef);
const mockGetWorkingTreeState = vi.mocked(getWorkingTreeState);
const mockGetAheadBehind = vi.mocked(getAheadBehind);
const mockGitFetch = vi.mocked(gitFetch);
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

/**
 * Pass-through mock for formatAlignedTable: joins columns with '|' separator.
 */
function setupDefaultTableMock(): void {
  mockFormatAlignedTable.mockImplementation((rows: ColumnDef[][]) =>
    rows.map((row) => row.map((cell) => cell.value).join('|')),
  );
}

function setupDefaultSyncedState(): void {
  mockGetCurrentBranch.mockResolvedValue('main');
  mockGetCurrentRef.mockResolvedValue('abc1234');
  mockGetWorkingTreeState.mockResolvedValue({
    modified: 0,
    staged: 0,
    deleted: 0,
    untracked: 0,
    conflicts: 0,
  });
  mockGetAheadBehind.mockResolvedValue({ ahead: 0, behind: 0 });
  mockGitFetch.mockResolvedValue(undefined);
  mockReadJsonFile.mockImplementation(() => {
    throw new Error('no cache');
  });
}

function getAllLoggedLines(): string[] {
  return mockLoggerInfo.mock.calls
    .map((call) => call[0])
    .filter((msg): msg is string => typeof msg === 'string');
}

describe('statusExecutor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupDefaultTableMock();
    setupDefaultSyncedState();
  });

  it('shows branch, ahead/behind, clean status, and project count for synced remote repo', async () => {
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
    mockGetAheadBehind.mockResolvedValue({ ahead: 0, behind: 0 });
    mockReadJsonFile.mockReturnValue({
      hash: 'x',
      report: {
        repos: {
          'repo-a': {
            nodes: {
              p1: {} as never,
              p2: {} as never,
              p3: {} as never,
              p4: {} as never,
              p5: {} as never,
              p6: {} as never,
              p7: {} as never,
              p8: {} as never,
              p9: {} as never,
              p10: {} as never,
              p11: {} as never,
              p12: {} as never,
            },
            dependencies: [],
          },
        },
      },
    });

    await statusExecutor({}, createContext());

    // formatAlignedTable should have been called with row data
    expect(mockFormatAlignedTable).toHaveBeenCalledTimes(1);
    const rows = mockFormatAlignedTable.mock.calls[0][0];
    expect(rows).toHaveLength(1);

    const row = rows[0];
    const values = row.map((c: ColumnDef) => c.value);
    expect(values).toContain('main');
    expect(values).toContain('+0 -0');
    expect(values).toContain('clean');
    expect(values).toContain('12 projects');
  });

  it('shows file counts with M/A/D/?? labels for dirty repo', async () => {
    setupPluginConfig([
      {
        type: 'remote',
        alias: 'repo-a',
        url: 'https://github.com/org/repo-a.git',
        depth: 1,
      },
    ]);
    mockDetectRepoState.mockReturnValue('cloned');
    mockGetWorkingTreeState.mockResolvedValue({
      modified: 3,
      staged: 1,
      deleted: 0,
      untracked: 2,
      conflicts: 0,
    });

    await statusExecutor({}, createContext());

    const rows = mockFormatAlignedTable.mock.calls[0][0];
    const dirtyCol = rows[0].map((c: ColumnDef) => c.value);
    expect(dirtyCol).toContain('3M 1A 2??');
  });

  it('shows [not synced] and ? projects for unsynced repo', async () => {
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

    const rows = mockFormatAlignedTable.mock.calls[0][0];
    const values = rows[0].map((c: ColumnDef) => c.value);
    expect(values).toContain('[not synced]');
    expect(values).toContain('? projects');
  });

  it('omits ahead/behind for tag-pinned repo', async () => {
    setupPluginConfig([
      {
        type: 'remote',
        alias: 'repo-c',
        url: 'https://github.com/org/repo-c.git',
        ref: 'v2.1.0',
        depth: 1,
      },
    ]);
    mockDetectRepoState.mockReturnValue('cloned');
    mockGetCurrentBranch.mockResolvedValue(null);
    mockGetCurrentRef.mockResolvedValue('v2.1.0');

    await statusExecutor({}, createContext());

    const rows = mockFormatAlignedTable.mock.calls[0][0];
    const values = rows[0].map((c: ColumnDef) => c.value);
    // Tag name should be displayed
    expect(values).toContain('v2.1.0');
    // Ahead/behind column should be empty
    const aheadBehindCol = rows[0][2];
    expect(aheadBehindCol.value).toBe('');
    // getAheadBehind should NOT have been called (tag-pinned)
    expect(mockGetAheadBehind).not.toHaveBeenCalled();
  });

  it('runs auto-fetch in parallel for all synced repos', async () => {
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
    mockDetectRepoState.mockReturnValue('cloned');

    await statusExecutor({}, createContext());

    expect(mockGitFetch).toHaveBeenCalledTimes(2);
  });

  it('logs warning but continues when auto-fetch fails for a repo', async () => {
    setupPluginConfig([
      {
        type: 'remote',
        alias: 'repo-a',
        url: 'https://github.com/org/repo-a.git',
        depth: 1,
      },
    ]);
    mockDetectRepoState.mockReturnValue('cloned');
    mockGitFetch.mockRejectedValue(new Error('network error'));

    await statusExecutor({}, createContext());

    expect(mockLoggerWarn).toHaveBeenCalledWith(
      expect.stringContaining('repo-a'),
    );
    // Table should still be rendered
    expect(mockFormatAlignedTable).toHaveBeenCalledTimes(1);
  });

  it('shows [WARN: dirty, sync may fail] for dirty repo', async () => {
    setupPluginConfig([
      {
        type: 'remote',
        alias: 'repo-a',
        url: 'https://github.com/org/repo-a.git',
        depth: 1,
      },
    ]);
    mockDetectRepoState.mockReturnValue('cloned');
    mockGetWorkingTreeState.mockResolvedValue({
      modified: 1,
      staged: 0,
      deleted: 0,
      untracked: 0,
      conflicts: 0,
    });

    await statusExecutor({}, createContext());

    const rows = mockFormatAlignedTable.mock.calls[0][0];
    const warningCol = rows[0].map((c: ColumnDef) => c.value);
    expect(warningCol).toEqual(
      expect.arrayContaining([
        expect.stringContaining('[WARN: dirty, sync may fail]'),
      ]),
    );
  });

  it('shows [WARN: detached HEAD] for detached non-tag repo', async () => {
    setupPluginConfig([
      {
        type: 'remote',
        alias: 'repo-d',
        url: 'https://github.com/org/repo-d.git',
        depth: 1,
      },
    ]);
    mockDetectRepoState.mockReturnValue('cloned');
    mockGetCurrentBranch.mockResolvedValue(null);
    mockGetCurrentRef.mockResolvedValue('abc1234'); // short SHA, not a tag

    await statusExecutor({}, createContext());

    const rows = mockFormatAlignedTable.mock.calls[0][0];
    const values = rows[0].map((c: ColumnDef) => c.value);
    expect(values).toContain('(detached)');
    expect(values).toEqual(
      expect.arrayContaining([
        expect.stringContaining('[WARN: detached HEAD]'),
      ]),
    );
  });

  it('shows [WARN: merge conflicts] when conflicts exist', async () => {
    setupPluginConfig([
      {
        type: 'remote',
        alias: 'repo-a',
        url: 'https://github.com/org/repo-a.git',
        depth: 1,
      },
    ]);
    mockDetectRepoState.mockReturnValue('cloned');
    mockGetWorkingTreeState.mockResolvedValue({
      modified: 0,
      staged: 0,
      deleted: 0,
      untracked: 0,
      conflicts: 2,
    });

    await statusExecutor({}, createContext());

    const rows = mockFormatAlignedTable.mock.calls[0][0];
    const warningValues = rows[0].map((c: ColumnDef) => c.value);
    expect(warningValues).toEqual(
      expect.arrayContaining([
        expect.stringContaining('[WARN: merge conflicts]'),
      ]),
    );
  });

  it('shows [WARN: drift] and (expected ref) when branch differs from configured ref', async () => {
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

    const rows = mockFormatAlignedTable.mock.calls[0][0];
    const values = rows[0].map((c: ColumnDef) => c.value);

    // Branch display should show expected ref
    expect(values).toEqual(
      expect.arrayContaining([
        expect.stringContaining('(expected develop)'),
      ]),
    );
    // Warning column should contain drift warning
    expect(values).toEqual(
      expect.arrayContaining([
        expect.stringContaining('[WARN: drift]'),
      ]),
    );
  });

  it('shows ? projects when graph cache is missing', async () => {
    setupPluginConfig([
      {
        type: 'remote',
        alias: 'repo-a',
        url: 'https://github.com/org/repo-a.git',
        depth: 1,
      },
    ]);
    mockDetectRepoState.mockReturnValue('cloned');
    mockReadJsonFile.mockImplementation(() => {
      throw new Error('ENOENT');
    });

    await statusExecutor({}, createContext());

    const rows = mockFormatAlignedTable.mock.calls[0][0];
    const values = rows[0].map((c: ColumnDef) => c.value);
    expect(values).toContain('? projects');
  });

  it('shows summary line with configured/synced/not-synced totals', async () => {
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
      {
        type: 'remote',
        alias: 'repo-c',
        url: 'git@github.com:org/repo-c.git',
        depth: 1,
      },
    ]);
    mockDetectRepoState
      .mockReturnValueOnce('cloned')
      .mockReturnValueOnce('cloned')
      .mockReturnValueOnce('not-synced');

    await statusExecutor({}, createContext());

    const lines = getAllLoggedLines();
    const summaryLine = lines.find(
      (line) =>
        line.includes('configured') &&
        line.includes('synced') &&
        line.includes('not synced'),
    );
    expect(summaryLine).toBeDefined();
    expect(summaryLine).toContain('3 configured');
    expect(summaryLine).toContain('2 synced');
    expect(summaryLine).toContain('1 not synced');
  });

  it('always prints legend', async () => {
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

    const lines = getAllLoggedLines();
    expect(lines).toEqual(expect.arrayContaining([
      expect.stringContaining('Legend:'),
    ]));
    expect(lines).toEqual(expect.arrayContaining([
      expect.stringContaining('M  ='),
    ]));
    expect(lines).toEqual(expect.arrayContaining([
      expect.stringContaining('A  ='),
    ]));
    expect(lines).toEqual(expect.arrayContaining([
      expect.stringContaining('?? ='),
    ]));
    expect(lines).toEqual(expect.arrayContaining([
      expect.stringContaining('+N ='),
    ]));
    expect(lines).toEqual(expect.arrayContaining([
      expect.stringContaining('-N ='),
    ]));
  });

  it('always returns { success: true }', async () => {
    setupPluginConfig([
      {
        type: 'remote',
        alias: 'repo-a',
        url: 'https://github.com/org/repo-a.git',
        depth: 1,
      },
    ]);
    mockDetectRepoState.mockReturnValue('cloned');
    mockGitFetch.mockRejectedValue(new Error('network'));
    mockGetWorkingTreeState.mockResolvedValue({
      modified: 5,
      staged: 0,
      deleted: 0,
      untracked: 0,
      conflicts: 3,
    });

    const result = await statusExecutor({}, createContext());

    expect(result).toEqual({ success: true });
  });

  it('does not call getAheadBehind for detached HEAD (non-tag)', async () => {
    setupPluginConfig([
      {
        type: 'remote',
        alias: 'repo-d',
        url: 'https://github.com/org/repo-d.git',
        depth: 1,
      },
    ]);
    mockDetectRepoState.mockReturnValue('cloned');
    mockGetCurrentBranch.mockResolvedValue(null);
    mockGetCurrentRef.mockResolvedValue('abc1234');

    await statusExecutor({}, createContext());

    expect(mockGetAheadBehind).not.toHaveBeenCalled();
  });

  it('shows clean when all working tree counts are zero and repo is even', async () => {
    setupPluginConfig([
      {
        type: 'remote',
        alias: 'repo-a',
        url: 'https://github.com/org/repo-a.git',
        depth: 1,
      },
    ]);
    mockDetectRepoState.mockReturnValue('cloned');
    mockGetWorkingTreeState.mockResolvedValue({
      modified: 0,
      staged: 0,
      deleted: 0,
      untracked: 0,
      conflicts: 0,
    });
    mockGetAheadBehind.mockResolvedValue({ ahead: 0, behind: 0 });

    await statusExecutor({}, createContext());

    const rows = mockFormatAlignedTable.mock.calls[0][0];
    const values = rows[0].map((c: ColumnDef) => c.value);
    expect(values).toContain('clean');
  });

  it('shows behind/ahead instead of clean when repo is clean but not even', async () => {
    setupPluginConfig([
      {
        type: 'remote',
        alias: 'repo-a',
        url: 'https://github.com/org/repo-a.git',
        depth: 1,
      },
    ]);
    mockDetectRepoState.mockReturnValue('cloned');
    mockGetWorkingTreeState.mockResolvedValue({
      modified: 0,
      staged: 0,
      deleted: 0,
      untracked: 0,
      conflicts: 0,
    });
    mockGetAheadBehind.mockResolvedValue({ ahead: 2, behind: 3 });

    await statusExecutor({}, createContext());

    const rows = mockFormatAlignedTable.mock.calls[0][0];
    const values = rows[0].map((c: ColumnDef) => c.value);
    expect(values).not.toContain('clean');
    expect(values).toContain('behind, ahead');
    expect(values).not.toContain('3 behind');
    expect(values).not.toContain('2 ahead');
  });

  it('shows just "behind" without count when clean and only behind', async () => {
    setupPluginConfig([
      {
        type: 'remote',
        alias: 'repo-a',
        url: 'https://github.com/org/repo-a.git',
        depth: 1,
      },
    ]);
    mockDetectRepoState.mockReturnValue('cloned');
    mockGetWorkingTreeState.mockResolvedValue({
      modified: 0,
      staged: 0,
      deleted: 0,
      untracked: 0,
      conflicts: 0,
    });
    mockGetAheadBehind.mockResolvedValue({ ahead: 0, behind: 5 });

    await statusExecutor({}, createContext());

    const rows = mockFormatAlignedTable.mock.calls[0][0];
    const values = rows[0].map((c: ColumnDef) => c.value);
    expect(values).toContain('behind');
    expect(values).not.toContain('5 behind');
  });

  it('shows just "ahead" without count when clean and only ahead', async () => {
    setupPluginConfig([
      {
        type: 'remote',
        alias: 'repo-a',
        url: 'https://github.com/org/repo-a.git',
        depth: 1,
      },
    ]);
    mockDetectRepoState.mockReturnValue('cloned');
    mockGetWorkingTreeState.mockResolvedValue({
      modified: 0,
      staged: 0,
      deleted: 0,
      untracked: 0,
      conflicts: 0,
    });
    mockGetAheadBehind.mockResolvedValue({ ahead: 3, behind: 0 });

    await statusExecutor({}, createContext());

    const rows = mockFormatAlignedTable.mock.calls[0][0];
    const values = rows[0].map((c: ColumnDef) => c.value);
    expect(values).toContain('ahead');
    expect(values).not.toContain('3 ahead');
  });

  it('summary line includes behind count when repos are behind remote', async () => {
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
    mockDetectRepoState.mockReturnValue('cloned');
    mockGetCurrentBranch.mockResolvedValue('main');
    // repo-a: behind=3, repo-b: behind=0
    mockGetAheadBehind
      .mockResolvedValueOnce({ ahead: 0, behind: 3 })
      .mockResolvedValueOnce({ ahead: 0, behind: 0 });

    await statusExecutor({}, createContext());

    const lines = getAllLoggedLines();
    const summaryLine = lines.find(
      (line) => line.includes('configured') && line.includes('synced'),
    );
    expect(summaryLine).toBeDefined();
    expect(summaryLine).toContain('1 behind');
  });

  it('summary line includes ahead count when repos are ahead of remote', async () => {
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
    mockGetAheadBehind.mockResolvedValue({ ahead: 2, behind: 0 });

    await statusExecutor({}, createContext());

    const lines = getAllLoggedLines();
    const summaryLine = lines.find(
      (line) => line.includes('configured') && line.includes('synced'),
    );
    expect(summaryLine).toBeDefined();
    expect(summaryLine).toContain('1 ahead');
  });

  it('summary line omits behind/ahead when all repos are even', async () => {
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
    mockGetAheadBehind.mockResolvedValue({ ahead: 0, behind: 0 });

    await statusExecutor({}, createContext());

    const lines = getAllLoggedLines();
    const summaryLine = lines.find(
      (line) => line.includes('configured') && line.includes('synced'),
    );
    expect(summaryLine).toBeDefined();
    expect(summaryLine).not.toContain('behind');
    expect(summaryLine).not.toContain('ahead');
  });

  it('shows [WARN: tag-pinned] for tag-pinned repo', async () => {
    setupPluginConfig([
      {
        type: 'remote',
        alias: 'repo-c',
        url: 'https://github.com/org/repo-c.git',
        ref: 'v2.1.0',
        depth: 1,
      },
    ]);
    mockDetectRepoState.mockReturnValue('cloned');
    mockGetCurrentBranch.mockResolvedValue(null);
    mockGetCurrentRef.mockResolvedValue('v2.1.0');
    mockGetWorkingTreeState.mockResolvedValue({
      modified: 0,
      staged: 0,
      deleted: 0,
      untracked: 0,
      conflicts: 0,
    });

    await statusExecutor({}, createContext());

    const rows = mockFormatAlignedTable.mock.calls[0][0];
    const values = rows[0].map((c: ColumnDef) => c.value);
    expect(values).toEqual(
      expect.arrayContaining([
        expect.stringContaining('[WARN: tag-pinned]'),
      ]),
    );
  });

  it('shows both dirty and tag-pinned warnings when tag-pinned repo is dirty', async () => {
    setupPluginConfig([
      {
        type: 'remote',
        alias: 'repo-c',
        url: 'https://github.com/org/repo-c.git',
        ref: 'v2.1.0',
        depth: 1,
      },
    ]);
    mockDetectRepoState.mockReturnValue('cloned');
    mockGetCurrentBranch.mockResolvedValue(null);
    mockGetCurrentRef.mockResolvedValue('v2.1.0');
    mockGetWorkingTreeState.mockResolvedValue({
      modified: 2,
      staged: 0,
      deleted: 0,
      untracked: 0,
      conflicts: 0,
    });

    await statusExecutor({}, createContext());

    const rows = mockFormatAlignedTable.mock.calls[0][0];
    const values = rows[0].map((c: ColumnDef) => c.value);
    // Should have both warnings
    const warningsCell = values.find(
      (v: string) => v.includes('[WARN:'),
    );
    expect(warningsCell).toBeDefined();
    expect(warningsCell).toContain('[WARN: dirty, sync may fail]');
    expect(warningsCell).toContain('[WARN: tag-pinned]');
  });
});
