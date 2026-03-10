import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validateConfig, warnIfReposNotGitignored, warnUnsyncedRepos } from './validate';
import type { PolyrepoConfig } from './schema';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();

  return {
    ...actual,
    readFile: vi.fn(),
  };
});

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();

  return {
    ...actual,
    existsSync: vi.fn(),
  };
});

vi.mock('@nx/devkit', () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}));

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { logger } from '@nx/devkit';

const mockedReadFile = vi.mocked(readFile);
const mockedExistsSync = vi.mocked(existsSync);
const mockedLoggerWarn = vi.mocked(logger.warn);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('validateConfig', () => {
  it('returns parsed config for valid input', () => {
    const input = {
      repos: { 'repo-a': 'git@github.com:org/repo-a.git' },
    };

    const result = validateConfig(input);

    expect(result).toEqual(input);
  });

  it('throws with zod error details for invalid input', () => {
    expect(() => validateConfig({})).toThrow();
  });
});

describe('warnIfReposNotGitignored', () => {
  it('warns when .repos/ is not in .gitignore', async () => {
    mockedReadFile.mockResolvedValue('node_modules\ndist\n');

    await warnIfReposNotGitignored('/workspace');

    expect(mockedLoggerWarn).toHaveBeenCalledWith(
      expect.stringContaining('.repos')
    );
  });

  it('does not warn when .repos/ is in .gitignore', async () => {
    mockedReadFile.mockResolvedValue('node_modules\n.repos/\ndist\n');

    await warnIfReposNotGitignored('/workspace');

    expect(mockedLoggerWarn).not.toHaveBeenCalled();
  });
});

describe('warnUnsyncedRepos', () => {
  it('warns for remote repos missing from .repos/ directory', () => {
    const config: PolyrepoConfig = {
      repos: { 'repo-a': 'git@github.com:org/repo-a.git' },
    };

    mockedExistsSync.mockReturnValue(false);

    warnUnsyncedRepos(config, '/workspace');

    expect(mockedLoggerWarn).toHaveBeenCalledWith(
      expect.stringContaining('repo-a')
    );
  });

  it('does not warn for local path repos', () => {
    const config: PolyrepoConfig = {
      repos: { 'repo-b': 'D:/projects/repo-b' },
    };

    warnUnsyncedRepos(config, '/workspace');

    expect(mockedLoggerWarn).not.toHaveBeenCalled();
  });
});
