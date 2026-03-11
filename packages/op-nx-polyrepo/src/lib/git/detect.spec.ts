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
  getHeadSha,
  getDirtyFiles,
  getWorkingTreeState,
  getAheadBehind,
  isGitTag,
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

describe('getHeadSha', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns trimmed SHA string for a repo directory', async () => {
    setupExecFileMock('abc1234567890def\n');

    const result = await getHeadSha('/workspace/.repos/repo');

    expect(result).toBe('abc1234567890def');
    expect(mockExecFile).toHaveBeenCalledWith(
      'git',
      ['rev-parse', 'HEAD'],
      expect.objectContaining({ cwd: '/workspace/.repos/repo' }),
      expect.any(Function),
    );
  });

  it('rejects when git command fails', async () => {
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
        const err = new Error('not a git repo') as ExecFileException;
        callback(err, '', 'not a git repo');
      }
    }) as typeof execFile);

    await expect(getHeadSha('/workspace/.repos/repo')).rejects.toThrow(
      'not a git repo',
    );
  });
});

describe('getDirtyFiles', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns trimmed output of git diff --name-only HEAD', async () => {
    setupExecFileMock('src/file1.ts\nsrc/file2.ts\n');

    const result = await getDirtyFiles('/workspace/.repos/repo');

    expect(result).toBe('src/file1.ts\nsrc/file2.ts');
    expect(mockExecFile).toHaveBeenCalledWith(
      'git',
      ['diff', '--name-only', 'HEAD'],
      expect.objectContaining({ cwd: '/workspace/.repos/repo' }),
      expect.any(Function),
    );
  });

  it('returns empty string when no dirty files', async () => {
    setupExecFileMock('\n');

    const result = await getDirtyFiles('/workspace/.repos/repo');

    expect(result).toBe('');
  });

  it('rejects when git command fails', async () => {
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
        const err = new Error('git failed') as ExecFileException;
        callback(err, '', 'git failed');
      }
    }) as typeof execFile);

    await expect(getDirtyFiles('/workspace/.repos/repo')).rejects.toThrow(
      'git failed',
    );
  });
});

describe('getWorkingTreeState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns all zeros for empty porcelain output', async () => {
    setupExecFileMock('');

    const result = await getWorkingTreeState('/workspace/.repos/repo');

    expect(result).toEqual({
      modified: 0,
      staged: 0,
      deleted: 0,
      untracked: 0,
      conflicts: 0,
    });
  });

  it('counts ?? lines as untracked', async () => {
    setupExecFileMock('?? newfile.ts\n?? another.ts\n');

    const result = await getWorkingTreeState('/workspace/.repos/repo');

    expect(result.untracked).toBe(2);
    expect(result.modified).toBe(0);
    expect(result.staged).toBe(0);
  });

  it('counts lines where Y=M as modified (working tree changes)', async () => {
    // ' M' = modified in working tree only
    setupExecFileMock(' M src/file.ts\n M src/other.ts\n');

    const result = await getWorkingTreeState('/workspace/.repos/repo');

    expect(result.modified).toBe(2);
    expect(result.staged).toBe(0);
  });

  it('counts lines where X in MADRC as staged', async () => {
    // 'M ' = staged modification
    // 'A ' = staged addition
    // 'D ' = staged deletion
    setupExecFileMock('M  src/changed.ts\nA  src/added.ts\nD  src/deleted.ts\n');

    const result = await getWorkingTreeState('/workspace/.repos/repo');

    expect(result.staged).toBe(3);
  });

  it('counts X=D as deleted when Y is not D', async () => {
    // 'D ' = staged deletion
    setupExecFileMock('D  src/removed.ts\n');

    const result = await getWorkingTreeState('/workspace/.repos/repo');

    expect(result.deleted).toBe(1);
    expect(result.staged).toBe(1);
  });

  it('counts Y=D as deleted', async () => {
    // ' D' = deleted in working tree
    setupExecFileMock(' D src/removed.ts\n');

    const result = await getWorkingTreeState('/workspace/.repos/repo');

    expect(result.deleted).toBe(1);
    expect(result.modified).toBe(0);
  });

  it('handles MM (both staged and modified) incrementing both counts', async () => {
    // 'MM' = staged modification + working tree modification
    setupExecFileMock('MM src/file.ts\n');

    const result = await getWorkingTreeState('/workspace/.repos/repo');

    expect(result.staged).toBe(1);
    expect(result.modified).toBe(1);
  });

  it('counts conflict patterns as conflicts', async () => {
    setupExecFileMock('UU src/conflict1.ts\nAA src/conflict2.ts\nDD src/conflict3.ts\n');

    const result = await getWorkingTreeState('/workspace/.repos/repo');

    expect(result.conflicts).toBe(3);
    expect(result.staged).toBe(0);
    expect(result.modified).toBe(0);
  });

  it('counts AU, UA, DU, UD conflict patterns', async () => {
    setupExecFileMock('AU src/c1.ts\nUA src/c2.ts\nDU src/c3.ts\nUD src/c4.ts\n');

    const result = await getWorkingTreeState('/workspace/.repos/repo');

    expect(result.conflicts).toBe(4);
  });

  it('handles mixed statuses correctly', async () => {
    const porcelain = [
      'M  src/staged.ts',       // staged
      ' M src/modified.ts',     // modified
      '?? src/new.ts',          // untracked
      'UU src/conflict.ts',     // conflict
      ' D src/deleted.ts',      // deleted in working tree
      'A  src/added.ts',        // staged addition
    ].join('\n') + '\n';

    setupExecFileMock(porcelain);

    const result = await getWorkingTreeState('/workspace/.repos/repo');

    expect(result.staged).toBe(2);
    expect(result.modified).toBe(1);
    expect(result.untracked).toBe(1);
    expect(result.conflicts).toBe(1);
    expect(result.deleted).toBe(1);
  });

  it('calls git status with --porcelain=v1', async () => {
    setupExecFileMock('');

    await getWorkingTreeState('/workspace/.repos/repo');

    expect(mockExecFile).toHaveBeenCalledWith(
      'git',
      ['status', '--porcelain=v1'],
      expect.objectContaining({ cwd: '/workspace/.repos/repo' }),
      expect.any(Function),
    );
  });
});

describe('getAheadBehind', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('parses ahead and behind counts from rev-list output', async () => {
    setupExecFileMock('2\t3\n');

    const result = await getAheadBehind('/workspace/.repos/repo');

    expect(result).toEqual({ ahead: 2, behind: 3 });
  });

  it('returns { ahead: 0, behind: 0 } for "0\\t0" output', async () => {
    setupExecFileMock('0\t0\n');

    const result = await getAheadBehind('/workspace/.repos/repo');

    expect(result).toEqual({ ahead: 0, behind: 0 });
  });

  it('returns null when command fails (detached HEAD)', async () => {
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
        const err = new Error('fatal: no upstream') as ExecFileException;
        callback(err, '', 'fatal: no upstream');
      }
    }) as typeof execFile);

    const result = await getAheadBehind('/workspace/.repos/repo');

    expect(result).toBeNull();
  });

  it('returns null when command fails (no upstream)', async () => {
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
        const err = new Error(
          'fatal: no upstream configured',
        ) as ExecFileException;
        callback(err, '', 'fatal: no upstream configured');
      }
    }) as typeof execFile);

    const result = await getAheadBehind('/workspace/.repos/repo');

    expect(result).toBeNull();
  });

  it('calls git rev-list with correct args', async () => {
    setupExecFileMock('0\t0\n');

    await getAheadBehind('/workspace/.repos/repo');

    expect(mockExecFile).toHaveBeenCalledWith(
      'git',
      ['rev-list', '--left-right', '--count', 'HEAD...@{u}'],
      expect.objectContaining({ cwd: '/workspace/.repos/repo' }),
      expect.any(Function),
    );
  });
});

describe('isGitTag', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns true when git show-ref --verify refs/tags/<ref> succeeds', async () => {
    setupExecFileMock('abc123 refs/tags/v1.0.0\n');

    const result = await isGitTag('/workspace/.repos/repo', 'v1.0.0');

    expect(result).toBe(true);
    expect(mockExecFile).toHaveBeenCalledWith(
      'git',
      ['show-ref', '--verify', 'refs/tags/v1.0.0'],
      expect.objectContaining({ cwd: '/workspace/.repos/repo' }),
      expect.any(Function),
    );
  });

  it('returns true for non-version tag name like 20.x', async () => {
    setupExecFileMock('abc123 refs/tags/20.x\n');

    const result = await isGitTag('/workspace/.repos/repo', '20.x');

    expect(result).toBe(true);
    expect(mockExecFile).toHaveBeenCalledWith(
      'git',
      ['show-ref', '--verify', 'refs/tags/20.x'],
      expect.objectContaining({ cwd: '/workspace/.repos/repo' }),
      expect.any(Function),
    );
  });

  it('returns true when tag not found locally but found on remote', async () => {
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
          // Local show-ref fails
          const err = new Error('fatal: not a valid ref') as ExecFileException;
          callback(err, '', 'fatal: not a valid ref');
        } else {
          // Remote ls-remote succeeds
          callback(null, 'abc123\trefs/tags/21.0.0\n', '');
        }
      }
    }) as typeof execFile);

    const result = await isGitTag('/workspace/.repos/repo', '21.0.0');

    expect(result).toBe(true);
    expect(callCount).toBe(2);
  });

  it('returns false when tag not found locally or on remote', async () => {
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
        const err = new Error('fatal: not a valid ref') as ExecFileException;
        callback(err, '', 'fatal: not a valid ref');
      }
    }) as typeof execFile);

    const result = await isGitTag('/workspace/.repos/repo', 'main');

    expect(result).toBe(false);
  });

  it('returns false when local check fails and remote returns empty', async () => {
    let callCount = 0;
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
        callCount++;

        if (callCount === 1) {
          const err = new Error('fatal: not a valid ref') as ExecFileException;
          callback(err, '', 'fatal: not a valid ref');
        } else {
          // Remote returns empty (ref exists but is not a tag)
          callback(null, '', '');
        }
      }
    }) as typeof execFile);

    const result = await isGitTag('/workspace/.repos/repo', 'main');

    expect(result).toBe(false);
  });

  it('returns false for undefined ref without calling git', async () => {
    const result = await isGitTag('/workspace/.repos/repo', undefined);

    expect(result).toBe(false);
    expect(mockExecFile).not.toHaveBeenCalled();
  });
});
