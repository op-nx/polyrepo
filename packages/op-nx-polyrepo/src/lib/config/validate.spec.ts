import { describe, it, expect, vi } from 'vitest';
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

vi.mock('@nx/devkit', () => ({
  logger: {
    warn: vi.fn<(...args: unknown[]) => void>(),
    info: vi.fn<(...args: unknown[]) => void>(),
    error: vi.fn<(...args: unknown[]) => void>(),
  },
}));

import {
  validateConfig,
  warnIfReposNotGitignored,
  warnUnsyncedRepos,
} from './validate';
import type { PolyrepoConfig } from './schema';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { logger } from '@nx/devkit';

function setup() {
  vi.clearAllMocks();

  const mockedReadFile = vi.mocked(readFile);
  const mockedExistsSync = vi.mocked(existsSync);
  const mockedLoggerWarn = vi.mocked(logger.warn);

  return { mockedReadFile, mockedExistsSync, mockedLoggerWarn };
}

describe(validateConfig, () => {
  it('returns parsed config for valid input', () => {
    setup();

    const input = {
      repos: { 'repo-a': 'git@github.com:org/repo-a.git' },
    };

    const result = validateConfig(input);

    expect(result).toStrictEqual(input);
  });

  it('throws with zod error details for invalid input', () => {
    setup();

    expect(() => validateConfig({})).toThrowError('Invalid @op-nx/polyrepo config');
  });
});

describe(warnIfReposNotGitignored, () => {
  it('warns when .repos/ is not in .gitignore', async () => {
    expect.hasAssertions();

    const { mockedReadFile, mockedLoggerWarn } = setup();

    mockedReadFile.mockResolvedValue('node_modules\ndist\n');

    await warnIfReposNotGitignored('/workspace');

    expect(mockedLoggerWarn).toHaveBeenCalledWith(
      expect.stringContaining('.repos'),
    );
  });

  it('does not warn when .repos/ is in .gitignore', async () => {
    expect.hasAssertions();

    const { mockedReadFile, mockedLoggerWarn } = setup();

    mockedReadFile.mockResolvedValue('node_modules\n.repos/\ndist\n');

    await warnIfReposNotGitignored('/workspace');

    expect(mockedLoggerWarn).not.toHaveBeenCalled();
  });
});

describe(warnUnsyncedRepos, () => {
  it('emits single grouped warning for one unsynced remote repo', () => {
    const { mockedExistsSync, mockedLoggerWarn } = setup();

    const config: PolyrepoConfig = {
      repos: { 'repo-a': 'git@github.com:org/repo-a.git' },
    };

    mockedExistsSync.mockReturnValue(false);

    warnUnsyncedRepos(config, '/workspace');

    expect(mockedLoggerWarn).toHaveBeenCalledTimes(1);
    expect(mockedLoggerWarn).toHaveBeenCalledWith(
      expect.stringContaining('repo-a'),
    );
    expect(mockedLoggerWarn).toHaveBeenCalledWith(
      expect.stringContaining('polyrepo-sync'),
    );
  });

  it('emits single grouped warning listing all unsynced repos', () => {
    const { mockedExistsSync, mockedLoggerWarn } = setup();

    const config: PolyrepoConfig = {
      repos: {
        'repo-a': 'git@github.com:org/repo-a.git',
        'repo-b': 'git@github.com:org/repo-b.git',
        'repo-c': 'git@github.com:org/repo-c.git',
      },
    };

    mockedExistsSync.mockReturnValue(false);

    warnUnsyncedRepos(config, '/workspace');

    // Single warning, not three
    expect(mockedLoggerWarn).toHaveBeenCalledTimes(1);

    const message = mockedLoggerWarn.mock.calls[0]?.[0];

    expect(message).toContain('repo-a');
    expect(message).toContain('repo-b');
    expect(message).toContain('repo-c');
  });

  it('does not warn for local path repos', () => {
    const { mockedLoggerWarn } = setup();

    const config: PolyrepoConfig = {
      repos: { 'repo-b': 'D:/projects/repo-b' },
    };

    warnUnsyncedRepos(config, '/workspace');

    expect(mockedLoggerWarn).not.toHaveBeenCalled();
  });

  it('does not warn when all remote repos are synced', () => {
    const { mockedExistsSync, mockedLoggerWarn } = setup();

    const config: PolyrepoConfig = {
      repos: { 'repo-a': 'git@github.com:org/repo-a.git' },
    };

    mockedExistsSync.mockReturnValue(true);

    warnUnsyncedRepos(config, '/workspace');

    expect(mockedLoggerWarn).not.toHaveBeenCalled();
  });
});
