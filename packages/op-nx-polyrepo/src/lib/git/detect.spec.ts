import { describe, it, expect, vi } from 'vitest';
import type { ChildProcess, ExecFileException } from 'node:child_process';
import { EventEmitter } from 'node:events';

vi.mock('node:fs', async () => {
  const { existsSync: _originalExistsSync } = await import('node:fs');

  return { existsSync: vi.fn<typeof _originalExistsSync>() };
});

vi.mock('node:child_process', async () => {
  const { execFile: _originalExecFile } = await import('node:child_process');

  return { execFile: vi.fn<typeof _originalExecFile>() };
});

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

function createExecError(message: string, code?: string): ExecFileException {
  const err: ExecFileException = new Error(message);
  err.killed = false;
  err.code = code;
  err.signal = undefined;
  err.cmd = '';

  return err;
}

/**
 * Create a minimal ChildProcess stub to satisfy the execFile return type.
 */
function createChildProcessStub(): ChildProcess {
  const emitter = new EventEmitter();

  return Object.assign(emitter, {
    stdin: null,
    stdout: null,
    stderr: null,
    stdio: [null, null, null, undefined, undefined] satisfies ChildProcess['stdio'],
    pid: undefined,
    connected: false,
    exitCode: null,
    signalCode: null,
    spawnargs: [],
    spawnfile: '',
    killed: false,
    kill: () => false,
    send: () => false,
    disconnect: () => undefined,
    unref: () => undefined,
    ref: () => undefined,
    [Symbol.dispose]: () => undefined,
  }) satisfies ChildProcess;
}

type ExecFileCallback = (
  error: ExecFileException | null,
  stdout: string,
  stderr: string,
) => void;

/**
 * Helper to mock execFile with correct overloaded types.
 */
function mockExecFileImpl(
  mock: ReturnType<typeof vi.mocked<typeof execFile>>,
  handler: (
    args: readonly string[] | null | undefined,
    callback: ExecFileCallback | undefined,
  ) => void,
): void {
  mock.mockImplementation((
    _file: string,
    _args: readonly string[] | null | undefined,
    _options: unknown,
    callback?: ExecFileCallback | null,
  ) => {
    handler(_args, callback ?? undefined);

    return createChildProcessStub();
  });
}

function setup(stdout: string, stderr = '') {
  vi.clearAllMocks();

  const mockExistsSync = vi.mocked(existsSync);
  const mockExecFile = vi.mocked(execFile);

  mockExecFileImpl(mockExecFile, (_args, callback) => {
    if (callback) {
      callback(null, stdout, stderr);
    }
  });

  return { mockExistsSync, mockExecFile };
}

describe(isGitUrl, () => {
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

describe(detectRepoState, () => {
  it('returns "cloned" when .repos/<alias>/.git exists for remote repo', () => {
    const { mockExistsSync } = setup('');

    mockExistsSync.mockReturnValue(true);

    const result = detectRepoState(
      'repo-a',
      {
        type: 'remote',
        alias: 'repo-a',
        url: 'https://github.com/org/repo-a.git',
        depth: 1,
        disableHooks: true,
      },
      '/workspace',
    );

    expect(result).toBe('cloned');
    expect(mockExistsSync).toHaveBeenCalledWith(
      expect.stringContaining('.repos'),
    );
  });

  it('returns "not-synced" when .repos/<alias> does not exist for remote repo', () => {
    const { mockExistsSync } = setup('');

    mockExistsSync.mockReturnValue(false);

    const result = detectRepoState(
      'repo-a',
      {
        type: 'remote',
        alias: 'repo-a',
        url: 'https://github.com/org/repo-a.git',
        depth: 1,
        disableHooks: true,
      },
      '/workspace',
    );

    expect(result).toBe('not-synced');
  });

  it('returns "referenced" for local path repos that exist', () => {
    const { mockExistsSync } = setup('');

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
    const { mockExistsSync } = setup('');

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

describe(getCurrentBranch, () => {
  it('returns branch name from git rev-parse', async () => {
    expect.hasAssertions();

    const { mockExecFile } = setup('main\n');

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
    expect.hasAssertions();

    setup('HEAD\n');

    const result = await getCurrentBranch('/workspace/.repos/repo');

    expect(result).toBeNull();
  });
});

describe(getCurrentRef, () => {
  it('returns tag name when HEAD is at a tag', async () => {
    expect.hasAssertions();

    setup('v1.0.0\n');

    const result = await getCurrentRef('/workspace/.repos/repo');

    expect(result).toBe('v1.0.0');
  });

  it('returns short SHA when HEAD is not at a tag', async () => {
    expect.hasAssertions();

    const { mockExecFile } = setup('');

    let callCount = 0;

    mockExecFileImpl(mockExecFile, (_args, callback) => {
      if (callback) {
        callCount++;

        if (callCount === 1) {
          // First call: git describe --tags fails
          const err = createExecError('no tag', 'ERR');
          callback(err, '', 'no tag');
        } else {
          // Second call: git rev-parse --short HEAD
          callback(null, 'abc1234\n', '');
        }
      }
    });

    const result = await getCurrentRef('/workspace/.repos/repo');

    expect(result).toBe('abc1234');
  });
});

describe(getHeadSha, () => {
  it('returns trimmed SHA string for a repo directory', async () => {
    expect.hasAssertions();

    const { mockExecFile } = setup('abc1234567890def\n');

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
    expect.hasAssertions();

    const { mockExecFile } = setup('');

    mockExecFileImpl(mockExecFile, (_args, callback) => {
      if (callback) {
        callback(createExecError('not a git repo'), '', 'not a git repo');
      }
    });

    await expect(getHeadSha('/workspace/.repos/repo')).rejects.toThrowError(
      'not a git repo',
    );
  });
});

describe(getDirtyFiles, () => {
  it('returns trimmed output of git diff --name-only HEAD', async () => {
    expect.hasAssertions();

    const { mockExecFile } = setup('src/file1.ts\nsrc/file2.ts\n');

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
    expect.hasAssertions();

    setup('\n');

    const result = await getDirtyFiles('/workspace/.repos/repo');

    expect(result).toBe('');
  });

  it('rejects when git command fails', async () => {
    expect.hasAssertions();

    const { mockExecFile } = setup('');

    mockExecFileImpl(mockExecFile, (_args, callback) => {
      if (callback) {
        callback(createExecError('git failed'), '', 'git failed');
      }
    });

    await expect(getDirtyFiles('/workspace/.repos/repo')).rejects.toThrowError(
      'git failed',
    );
  });
});

describe(getWorkingTreeState, () => {
  it('returns all zeros for empty porcelain output', async () => {
    expect.hasAssertions();

    setup('');

    const result = await getWorkingTreeState('/workspace/.repos/repo');

    expect(result).toStrictEqual({
      modified: 0,
      staged: 0,
      deleted: 0,
      untracked: 0,
      conflicts: 0,
    });
  });

  it('counts ?? lines as untracked', async () => {
    expect.hasAssertions();

    setup('?? newfile.ts\n?? another.ts\n');

    const result = await getWorkingTreeState('/workspace/.repos/repo');

    expect(result.untracked).toBe(2);
    expect(result.modified).toBe(0);
    expect(result.staged).toBe(0);
  });

  it('counts lines where Y=M as modified (working tree changes)', async () => {
    expect.hasAssertions();

    setup(' M src/file.ts\n M src/other.ts\n');

    const result = await getWorkingTreeState('/workspace/.repos/repo');

    expect(result.modified).toBe(2);
    expect(result.staged).toBe(0);
  });

  it('counts lines where X in MADRC as staged', async () => {
    expect.hasAssertions();

    setup(
      'M  src/changed.ts\nA  src/added.ts\nD  src/deleted.ts\n',
    );

    const result = await getWorkingTreeState('/workspace/.repos/repo');

    expect(result.staged).toBe(3);
  });

  it('counts X=D as deleted when Y is not D', async () => {
    expect.hasAssertions();

    setup('D  src/removed.ts\n');

    const result = await getWorkingTreeState('/workspace/.repos/repo');

    expect(result.deleted).toBe(1);
    expect(result.staged).toBe(1);
  });

  it('counts Y=D as deleted', async () => {
    expect.hasAssertions();

    setup(' D src/removed.ts\n');

    const result = await getWorkingTreeState('/workspace/.repos/repo');

    expect(result.deleted).toBe(1);
    expect(result.modified).toBe(0);
  });

  it('handles MM (both staged and modified) incrementing both counts', async () => {
    expect.hasAssertions();

    setup('MM src/file.ts\n');

    const result = await getWorkingTreeState('/workspace/.repos/repo');

    expect(result.staged).toBe(1);
    expect(result.modified).toBe(1);
  });

  it('counts conflict patterns as conflicts', async () => {
    expect.hasAssertions();

    setup(
      'UU src/conflict1.ts\nAA src/conflict2.ts\nDD src/conflict3.ts\n',
    );

    const result = await getWorkingTreeState('/workspace/.repos/repo');

    expect(result.conflicts).toBe(3);
    expect(result.staged).toBe(0);
    expect(result.modified).toBe(0);
  });

  it('counts AU, UA, DU, UD conflict patterns', async () => {
    expect.hasAssertions();

    setup(
      'AU src/c1.ts\nUA src/c2.ts\nDU src/c3.ts\nUD src/c4.ts\n',
    );

    const result = await getWorkingTreeState('/workspace/.repos/repo');

    expect(result.conflicts).toBe(4);
  });

  it('handles mixed statuses correctly', async () => {
    expect.hasAssertions();

    const porcelain =
      [
        'M  src/staged.ts',
        ' M src/modified.ts',
        '?? src/new.ts',
        'UU src/conflict.ts',
        ' D src/deleted.ts',
        'A  src/added.ts',
      ].join('\n') + '\n';

    setup(porcelain);

    const result = await getWorkingTreeState('/workspace/.repos/repo');

    expect(result.staged).toBe(2);
    expect(result.modified).toBe(1);
    expect(result.untracked).toBe(1);
    expect(result.conflicts).toBe(1);
    expect(result.deleted).toBe(1);
  });

  it('calls git status with --porcelain=v1', async () => {
    expect.hasAssertions();

    const { mockExecFile } = setup('');

    await getWorkingTreeState('/workspace/.repos/repo');

    expect(mockExecFile).toHaveBeenCalledWith(
      'git',
      ['status', '--porcelain=v1'],
      expect.objectContaining({ cwd: '/workspace/.repos/repo' }),
      expect.any(Function),
    );
  });
});

describe(getAheadBehind, () => {
  it('parses ahead and behind counts from rev-list output', async () => {
    expect.hasAssertions();

    setup('2\t3\n');

    const result = await getAheadBehind('/workspace/.repos/repo');

    expect(result).toStrictEqual({ ahead: 2, behind: 3 });
  });

  it('returns { ahead: 0, behind: 0 } for "0\\t0" output', async () => {
    expect.hasAssertions();

    setup('0\t0\n');

    const result = await getAheadBehind('/workspace/.repos/repo');

    expect(result).toStrictEqual({ ahead: 0, behind: 0 });
  });

  it('returns null when command fails (detached HEAD)', async () => {
    expect.hasAssertions();

    const { mockExecFile } = setup('');

    mockExecFileImpl(mockExecFile, (_args, callback) => {
      if (callback) {
        callback(
          createExecError('fatal: no upstream'),
          '',
          'fatal: no upstream',
        );
      }
    });

    const result = await getAheadBehind('/workspace/.repos/repo');

    expect(result).toBeNull();
  });

  it('returns null when command fails (no upstream)', async () => {
    expect.hasAssertions();

    const { mockExecFile } = setup('');

    mockExecFileImpl(mockExecFile, (_args, callback) => {
      if (callback) {
        callback(
          createExecError('fatal: no upstream configured'),
          '',
          'fatal: no upstream configured',
        );
      }
    });

    const result = await getAheadBehind('/workspace/.repos/repo');

    expect(result).toBeNull();
  });

  it('calls git rev-list with correct args', async () => {
    expect.hasAssertions();

    const { mockExecFile } = setup('0\t0\n');

    await getAheadBehind('/workspace/.repos/repo');

    expect(mockExecFile).toHaveBeenCalledWith(
      'git',
      ['rev-list', '--left-right', '--count', 'HEAD...@{u}'],
      expect.objectContaining({ cwd: '/workspace/.repos/repo' }),
      expect.any(Function),
    );
  });
});

describe(isGitTag, () => {
  it('returns true when git show-ref --verify refs/tags/<ref> succeeds', async () => {
    expect.hasAssertions();

    const { mockExecFile } = setup('abc123 refs/tags/v1.0.0\n');

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
    expect.hasAssertions();

    const { mockExecFile } = setup('abc123 refs/tags/20.x\n');

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
    expect.hasAssertions();

    const { mockExecFile } = setup('');

    let callCount = 0;

    mockExecFileImpl(mockExecFile, (_args, callback) => {
      if (callback) {
        callCount++;

        if (callCount === 1) {
          callback(
            createExecError('fatal: not a valid ref'),
            '',
            'fatal: not a valid ref',
          );
        } else {
          callback(null, 'abc123\trefs/tags/21.0.0\n', '');
        }
      }
    });

    const result = await isGitTag('/workspace/.repos/repo', '21.0.0');

    expect(result).toBe(true);
    expect(callCount).toBe(2);
  });

  it('returns false when tag not found locally or on remote', async () => {
    expect.hasAssertions();

    const { mockExecFile } = setup('');

    mockExecFileImpl(mockExecFile, (_args, callback) => {
      if (callback) {
        callback(
          createExecError('fatal: not a valid ref'),
          '',
          'fatal: not a valid ref',
        );
      }
    });

    const result = await isGitTag('/workspace/.repos/repo', 'main');

    expect(result).toBe(false);
  });

  it('returns false when local check fails and remote returns empty', async () => {
    expect.hasAssertions();

    const { mockExecFile } = setup('');

    let callCount = 0;

    mockExecFileImpl(mockExecFile, (_args, callback) => {
      if (callback) {
        callCount++;

        if (callCount === 1) {
          callback(
            createExecError('fatal: not a valid ref'),
            '',
            'fatal: not a valid ref',
          );
        } else {
          callback(null, '', '');
        }
      }
    });

    const result = await isGitTag('/workspace/.repos/repo', 'main');

    expect(result).toBe(false);
  });

  it('returns false for undefined ref without calling git', async () => {
    expect.hasAssertions();

    const { mockExecFile } = setup('');

    const result = await isGitTag('/workspace/.repos/repo', undefined);

    expect(result).toBe(false);
    expect(mockExecFile).not.toHaveBeenCalled();
  });
});
