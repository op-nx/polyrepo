import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ExecFileException } from 'node:child_process';

// Mock node:child_process before importing commands
vi.mock('node:child_process', () => {
  const mockExecFile = vi.fn();
  return {
    execFile: mockExecFile,
  };
});

import { execFile } from 'node:child_process';
import {
  gitClone,
  gitPull,
  gitFetch,
  gitPullRebase,
  gitPullFfOnly,
  gitFetchTag,
  gitCheckoutBranch,
} from './commands';

const mockExecFile = vi.mocked(execFile);

function createExecError(message: string): ExecFileException {
  return Object.assign(new Error(message), {
    killed: false,
    code: null,
    signal: null,
    cmd: '',
  });
}

function setupExecFileMock(): void {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
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

describe('gitClone', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupExecFileMock();
  });

  it('constructs correct args for default shallow clone', async () => {
    await gitClone(
      'https://github.com/org/repo.git',
      'D:/workspace/.repos/repo',
    );

    expect(mockExecFile).toHaveBeenCalledWith(
      'git',
      [
        'clone',
        '--depth',
        '1',
        'https://github.com/org/repo.git',
        'D:/workspace/.repos/repo',
      ],
      expect.any(Object),
      expect.any(Function),
    );
  });

  it('constructs correct args for full clone (depth 0)', async () => {
    await gitClone(
      'https://github.com/org/repo.git',
      'D:/workspace/.repos/repo',
      { depth: 0 },
    );

    expect(mockExecFile).toHaveBeenCalledWith(
      'git',
      ['clone', 'https://github.com/org/repo.git', 'D:/workspace/.repos/repo'],
      expect.any(Object),
      expect.any(Function),
    );
  });

  it('constructs correct args when ref is specified', async () => {
    await gitClone(
      'https://github.com/org/repo.git',
      'D:/workspace/.repos/repo',
      { ref: 'develop' },
    );

    expect(mockExecFile).toHaveBeenCalledWith(
      'git',
      [
        'clone',
        '--depth',
        '1',
        '--branch',
        'develop',
        'https://github.com/org/repo.git',
        'D:/workspace/.repos/repo',
      ],
      expect.any(Object),
      expect.any(Function),
    );
  });

  it('normalizes backslashes in target directory to forward slashes', async () => {
    await gitClone(
      'https://github.com/org/repo.git',
      'D:\\workspace\\.repos\\repo',
    );

    expect(mockExecFile).toHaveBeenCalledWith(
      'git',
      [
        'clone',
        '--depth',
        '1',
        'https://github.com/org/repo.git',
        'D:/workspace/.repos/repo',
      ],
      expect.any(Object),
      expect.any(Function),
    );
  });
});

describe('gitPull', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupExecFileMock();
  });

  it('constructs correct args with cwd', async () => {
    await gitPull('D:/workspace/.repos/repo');

    expect(mockExecFile).toHaveBeenCalledWith(
      'git',
      ['pull'],
      expect.objectContaining({ cwd: 'D:/workspace/.repos/repo' }),
      expect.any(Function),
    );
  });
});

describe('gitFetch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupExecFileMock();
  });

  it('constructs correct args with cwd', async () => {
    await gitFetch('D:/workspace/.repos/repo');

    expect(mockExecFile).toHaveBeenCalledWith(
      'git',
      ['fetch'],
      expect.objectContaining({ cwd: 'D:/workspace/.repos/repo' }),
      expect.any(Function),
    );
  });
});

describe('gitPullRebase', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupExecFileMock();
  });

  it('constructs correct args with cwd', async () => {
    await gitPullRebase('D:/workspace/.repos/repo');

    expect(mockExecFile).toHaveBeenCalledWith(
      'git',
      ['pull', '--rebase'],
      expect.objectContaining({ cwd: 'D:/workspace/.repos/repo' }),
      expect.any(Function),
    );
  });
});

describe('gitPullFfOnly', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupExecFileMock();
  });

  it('constructs correct args with cwd', async () => {
    await gitPullFfOnly('D:/workspace/.repos/repo');

    expect(mockExecFile).toHaveBeenCalledWith(
      'git',
      ['pull', '--ff-only'],
      expect.objectContaining({ cwd: 'D:/workspace/.repos/repo' }),
      expect.any(Function),
    );
  });
});

describe('gitFetchTag', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupExecFileMock();
  });

  it('constructs fetch and checkout commands for tag', async () => {
    await gitFetchTag('D:/workspace/.repos/repo', 'v1.0.0');

    expect(mockExecFile).toHaveBeenCalledTimes(2);

    expect(mockExecFile).toHaveBeenNthCalledWith(
      1,
      'git',
      ['fetch', '--depth', '1', 'origin', 'tag', 'v1.0.0'],
      expect.objectContaining({ cwd: 'D:/workspace/.repos/repo' }),
      expect.any(Function),
    );

    expect(mockExecFile).toHaveBeenNthCalledWith(
      2,
      'git',
      ['checkout', 'v1.0.0'],
      expect.objectContaining({ cwd: 'D:/workspace/.repos/repo' }),
      expect.any(Function),
    );
  });

  it('uses custom depth for tag fetch', async () => {
    await gitFetchTag('D:/workspace/.repos/repo', 'v2.0.0', 5);

    expect(mockExecFile).toHaveBeenNthCalledWith(
      1,
      'git',
      ['fetch', '--depth', '5', 'origin', 'tag', 'v2.0.0'],
      expect.objectContaining({ cwd: 'D:/workspace/.repos/repo' }),
      expect.any(Function),
    );
  });
});

describe('gitCheckoutBranch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupExecFileMock();
  });

  it('fetches the branch from origin then checks it out', async () => {
    await gitCheckoutBranch('D:/workspace/.repos/repo', 'main');

    expect(mockExecFile).toHaveBeenCalledTimes(2);

    expect(mockExecFile).toHaveBeenNthCalledWith(
      1,
      'git',
      ['fetch', 'origin', 'main'],
      expect.objectContaining({ cwd: 'D:/workspace/.repos/repo' }),
      expect.any(Function),
    );

    expect(mockExecFile).toHaveBeenNthCalledWith(
      2,
      'git',
      ['checkout', 'main'],
      expect.objectContaining({ cwd: 'D:/workspace/.repos/repo' }),
      expect.any(Function),
    );
  });

  it('falls back to checkout -b when checkout fails (branch not local)', async () => {
    let callCount = 0;
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
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
      callCount++;

      if (callback) {
        // First call: fetch (succeeds)
        // Second call: checkout (fails — branch not local)
        // Third call: checkout -b (succeeds)
        if (
          callCount === 2 &&
          args.includes('checkout') &&
          !args.includes('-b')
        ) {
          callback(
            createExecError('pathspec did not match'),
            '',
            'error: pathspec did not match',
          );
        } else {
          callback(null, '', '');
        }
      }
    }) as typeof execFile);

    await gitCheckoutBranch('D:/workspace/.repos/repo', 'develop');

    expect(mockExecFile).toHaveBeenCalledTimes(3);

    expect(mockExecFile).toHaveBeenNthCalledWith(
      3,
      'git',
      ['checkout', '-b', 'develop', 'origin/develop'],
      expect.objectContaining({ cwd: 'D:/workspace/.repos/repo' }),
      expect.any(Function),
    );
  });

  it('respects disableHooks on all git calls', async () => {
    await gitCheckoutBranch('D:/workspace/.repos/repo', 'main', true);

    expect(mockExecFile).toHaveBeenNthCalledWith(
      1,
      'git',
      [
        '-c',
        'core.hooksPath=__op-nx_polyrepo_disable-hooks__',
        'fetch',
        'origin',
        'main',
      ],
      expect.objectContaining({ cwd: 'D:/workspace/.repos/repo' }),
      expect.any(Function),
    );

    expect(mockExecFile).toHaveBeenNthCalledWith(
      2,
      'git',
      [
        '-c',
        'core.hooksPath=__op-nx_polyrepo_disable-hooks__',
        'checkout',
        'main',
      ],
      expect.objectContaining({ cwd: 'D:/workspace/.repos/repo' }),
      expect.any(Function),
    );
  });
});

describe('disableHooks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupExecFileMock();
  });

  it('gitClone prepends -c core.hooksPath=__op-nx_polyrepo_disable-hooks__ when disableHooks is true', async () => {
    await gitClone(
      'https://github.com/org/repo.git',
      'D:/workspace/.repos/repo',
      { disableHooks: true },
    );

    expect(mockExecFile).toHaveBeenCalledWith(
      'git',
      [
        '-c',
        'core.hooksPath=__op-nx_polyrepo_disable-hooks__',
        'clone',
        '--depth',
        '1',
        'https://github.com/org/repo.git',
        'D:/workspace/.repos/repo',
      ],
      expect.any(Object),
      expect.any(Function),
    );
  });

  it('gitClone does NOT prepend hooks args when disableHooks is false', async () => {
    await gitClone(
      'https://github.com/org/repo.git',
      'D:/workspace/.repos/repo',
      { disableHooks: false },
    );

    expect(mockExecFile).toHaveBeenCalledWith(
      'git',
      [
        'clone',
        '--depth',
        '1',
        'https://github.com/org/repo.git',
        'D:/workspace/.repos/repo',
      ],
      expect.any(Object),
      expect.any(Function),
    );
  });

  it('gitClone does NOT prepend hooks args when disableHooks is undefined', async () => {
    await gitClone(
      'https://github.com/org/repo.git',
      'D:/workspace/.repos/repo',
    );

    expect(mockExecFile).toHaveBeenCalledWith(
      'git',
      [
        'clone',
        '--depth',
        '1',
        'https://github.com/org/repo.git',
        'D:/workspace/.repos/repo',
      ],
      expect.any(Object),
      expect.any(Function),
    );
  });

  it('gitPull prepends -c core.hooksPath when disableHooks is true', async () => {
    await gitPull('D:/workspace/.repos/repo', true);

    expect(mockExecFile).toHaveBeenCalledWith(
      'git',
      ['-c', 'core.hooksPath=__op-nx_polyrepo_disable-hooks__', 'pull'],
      expect.objectContaining({ cwd: 'D:/workspace/.repos/repo' }),
      expect.any(Function),
    );
  });

  it('gitPull does NOT prepend hooks args when disableHooks is false', async () => {
    await gitPull('D:/workspace/.repos/repo', false);

    expect(mockExecFile).toHaveBeenCalledWith(
      'git',
      ['pull'],
      expect.objectContaining({ cwd: 'D:/workspace/.repos/repo' }),
      expect.any(Function),
    );
  });

  it('gitFetch prepends -c core.hooksPath when disableHooks is true', async () => {
    await gitFetch('D:/workspace/.repos/repo', true);

    expect(mockExecFile).toHaveBeenCalledWith(
      'git',
      ['-c', 'core.hooksPath=__op-nx_polyrepo_disable-hooks__', 'fetch'],
      expect.objectContaining({ cwd: 'D:/workspace/.repos/repo' }),
      expect.any(Function),
    );
  });

  it('gitPullRebase prepends -c core.hooksPath when disableHooks is true', async () => {
    await gitPullRebase('D:/workspace/.repos/repo', true);

    expect(mockExecFile).toHaveBeenCalledWith(
      'git',
      [
        '-c',
        'core.hooksPath=__op-nx_polyrepo_disable-hooks__',
        'pull',
        '--rebase',
      ],
      expect.objectContaining({ cwd: 'D:/workspace/.repos/repo' }),
      expect.any(Function),
    );
  });

  it('gitPullFfOnly prepends -c core.hooksPath when disableHooks is true', async () => {
    await gitPullFfOnly('D:/workspace/.repos/repo', true);

    expect(mockExecFile).toHaveBeenCalledWith(
      'git',
      [
        '-c',
        'core.hooksPath=__op-nx_polyrepo_disable-hooks__',
        'pull',
        '--ff-only',
      ],
      expect.objectContaining({ cwd: 'D:/workspace/.repos/repo' }),
      expect.any(Function),
    );
  });

  it('gitFetchTag prepends -c core.hooksPath to both fetch and checkout when disableHooks is true', async () => {
    await gitFetchTag('D:/workspace/.repos/repo', 'v1.0.0', 1, true);

    expect(mockExecFile).toHaveBeenCalledTimes(2);

    expect(mockExecFile).toHaveBeenNthCalledWith(
      1,
      'git',
      [
        '-c',
        'core.hooksPath=__op-nx_polyrepo_disable-hooks__',
        'fetch',
        '--depth',
        '1',
        'origin',
        'tag',
        'v1.0.0',
      ],
      expect.objectContaining({ cwd: 'D:/workspace/.repos/repo' }),
      expect.any(Function),
    );

    expect(mockExecFile).toHaveBeenNthCalledWith(
      2,
      'git',
      [
        '-c',
        'core.hooksPath=__op-nx_polyrepo_disable-hooks__',
        'checkout',
        'v1.0.0',
      ],
      expect.objectContaining({ cwd: 'D:/workspace/.repos/repo' }),
      expect.any(Function),
    );
  });

  it('gitFetchTag does NOT prepend hooks args when disableHooks is not passed', async () => {
    await gitFetchTag('D:/workspace/.repos/repo', 'v1.0.0');

    expect(mockExecFile).toHaveBeenNthCalledWith(
      1,
      'git',
      ['fetch', '--depth', '1', 'origin', 'tag', 'v1.0.0'],
      expect.objectContaining({ cwd: 'D:/workspace/.repos/repo' }),
      expect.any(Function),
    );

    expect(mockExecFile).toHaveBeenNthCalledWith(
      2,
      'git',
      ['checkout', 'v1.0.0'],
      expect.objectContaining({ cwd: 'D:/workspace/.repos/repo' }),
      expect.any(Function),
    );
  });
});
