import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ExecFileException } from 'node:child_process';

vi.mock('node:fs', () => ({
  existsSync: vi.fn(),
}));

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import {
  isGitUrl,
  detectRepoState,
  getCurrentBranch,
  getCurrentRef,
} from './detect';

const mockExistsSync = vi.mocked(existsSync);
const mockExecFile = vi.mocked(execFile);

function setupExecFileMock(stdout: string, stderr = ''): void {
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
      callback(null, stdout, stderr);
    }
  }) as typeof execFile);
}

function setupExecFileError(message: string): void {
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
      const err = new Error(message) as ExecFileException;
      err.code = 'ERR';
      callback(err, '', message);
    }
  }) as typeof execFile);
}

describe('isGitUrl', () => {
  it('returns true for git@ URLs', () => {
    expect(isGitUrl('git@github.com:org/repo.git')).toBe(true);
  });

  it('returns true for https:// URLs', () => {
    expect(isGitUrl('https://github.com/org/repo.git')).toBe(true);
  });

  it('returns true for http:// URLs', () => {
    expect(isGitUrl('http://github.com/org/repo.git')).toBe(true);
  });

  it('returns true for ssh:// URLs', () => {
    expect(isGitUrl('ssh://git@github.com/org/repo.git')).toBe(true);
  });

  it('returns true for file:// URLs', () => {
    expect(isGitUrl('file:///path/to/repo')).toBe(true);
  });

  it('returns false for Windows absolute path', () => {
    expect(isGitUrl('D:/projects/repo')).toBe(false);
  });

  it('returns false for relative path', () => {
    expect(isGitUrl('../repo')).toBe(false);
  });

  it('returns false for Unix absolute path', () => {
    expect(isGitUrl('/home/user/repo')).toBe(false);
  });
});

describe('detectRepoState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns "cloned" when .repos/<alias>/.git exists for remote repo', () => {
    mockExistsSync.mockReturnValue(true);

    const result = detectRepoState(
      'repo-a',
      {
        type: 'remote',
        alias: 'repo-a',
        url: 'https://github.com/org/repo-a.git',
        depth: 1,
      },
      '/workspace',
    );

    expect(result).toBe('cloned');
    expect(mockExistsSync).toHaveBeenCalledWith(
      expect.stringContaining('.repos'),
    );
  });

  it('returns "not-synced" when .repos/<alias> does not exist for remote repo', () => {
    mockExistsSync.mockReturnValue(false);

    const result = detectRepoState(
      'repo-a',
      {
        type: 'remote',
        alias: 'repo-a',
        url: 'https://github.com/org/repo-a.git',
        depth: 1,
      },
      '/workspace',
    );

    expect(result).toBe('not-synced');
  });

  it('returns "referenced" for local path repos that exist', () => {
    mockExistsSync.mockReturnValue(true);

    const result = detectRepoState(
      'repo-b',
      {
        type: 'local',
        alias: 'repo-b',
        path: 'D:/projects/repo-b',
      },
      '/workspace',
    );

    expect(result).toBe('referenced');
  });

  it('returns "not-synced" for local path repos that do not exist', () => {
    mockExistsSync.mockReturnValue(false);

    const result = detectRepoState(
      'repo-b',
      {
        type: 'local',
        alias: 'repo-b',
        path: 'D:/projects/repo-b',
      },
      '/workspace',
    );

    expect(result).toBe('not-synced');
  });
});

describe('getCurrentBranch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns branch name from git rev-parse', async () => {
    setupExecFileMock('main\n');

    const result = await getCurrentBranch('/workspace/.repos/repo');

    expect(result).toBe('main');
    expect(mockExecFile).toHaveBeenCalledWith(
      'git',
      ['rev-parse', '--abbrev-ref', 'HEAD'],
      expect.objectContaining({ cwd: '/workspace/.repos/repo' }),
      expect.any(Function),
    );
  });

  it('returns null when HEAD is detached', async () => {
    setupExecFileMock('HEAD\n');

    const result = await getCurrentBranch('/workspace/.repos/repo');

    expect(result).toBeNull();
  });
});

describe('getCurrentRef', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns tag name when HEAD is at a tag', async () => {
    setupExecFileMock('v1.0.0\n');

    const result = await getCurrentRef('/workspace/.repos/repo');

    expect(result).toBe('v1.0.0');
  });

  it('returns short SHA when HEAD is not at a tag', async () => {
    let callCount = 0;
    mockExecFile.mockImplementation(((
      _file: string,
      args: readonly string[],
      _options: unknown,
      callback?: (
        error: ExecFileException | null,
        stdout: string,
        stderr: string,
      ) => void,
    ) => {
      if (callback) {
        callCount++;

        if (callCount === 1) {
          // First call: git describe --tags fails
          const err = new Error('no tag') as ExecFileException;
          err.code = 'ERR';
          callback(err, '', 'no tag');
        } else {
          // Second call: git rev-parse --short HEAD
          callback(null, 'abc1234\n', '');
        }
      }
    }) as typeof execFile);

    const result = await getCurrentRef('/workspace/.repos/repo');

    expect(result).toBe('abc1234');
  });
});
