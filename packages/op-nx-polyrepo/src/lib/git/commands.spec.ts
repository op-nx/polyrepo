import { describe, it, expect, vi } from 'vitest';
import type { ChildProcess, ExecFileException } from 'node:child_process';
import { EventEmitter } from 'node:events';

// Mock node:child_process before importing commands
vi.mock('node:child_process', async () => {
  const { execFile: _originalExecFile } = await import('node:child_process');
  const mockExecFile = vi.fn<typeof _originalExecFile>();

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

function createExecError(message: string): ExecFileException {
  const err: ExecFileException = new Error(message);
  err.killed = false;
  err.code = undefined;
  err.signal = undefined;
  err.cmd = '';

  return err;
}

type ExecFileCallback = (
  error: ExecFileException | null,
  stdout: string,
  stderr: string,
) => void;

/**
 * Helper to mock execFile with correct overloaded types.
 * Wraps a simple callback handler with the full overload-compatible signature.
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

function setup() {
  vi.clearAllMocks();

  const mockExecFile = vi.mocked(execFile);

  mockExecFileImpl(mockExecFile, (_args, callback) => {
    if (callback) {
      callback(null, '', '');
    }
  });

  return { mockExecFile };
}

describe(gitClone, () => {
  it('constructs correct args for default shallow clone', async () => {
    expect.hasAssertions();

    const { mockExecFile } = setup();

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
    expect.hasAssertions();

    const { mockExecFile } = setup();

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
    expect.hasAssertions();

    const { mockExecFile } = setup();

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
    expect.hasAssertions();

    const { mockExecFile } = setup();

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

describe(gitPull, () => {
  it('constructs correct args with cwd', async () => {
    expect.hasAssertions();

    const { mockExecFile } = setup();

    await gitPull('D:/workspace/.repos/repo');

    expect(mockExecFile).toHaveBeenCalledWith(
      'git',
      ['pull'],
      expect.objectContaining({ cwd: 'D:/workspace/.repos/repo' }),
      expect.any(Function),
    );
  });
});

describe(gitFetch, () => {
  it('constructs correct args with cwd', async () => {
    expect.hasAssertions();

    const { mockExecFile } = setup();

    await gitFetch('D:/workspace/.repos/repo');

    expect(mockExecFile).toHaveBeenCalledWith(
      'git',
      ['fetch'],
      expect.objectContaining({ cwd: 'D:/workspace/.repos/repo' }),
      expect.any(Function),
    );
  });
});

describe(gitPullRebase, () => {
  it('constructs correct args with cwd', async () => {
    expect.hasAssertions();

    const { mockExecFile } = setup();

    await gitPullRebase('D:/workspace/.repos/repo');

    expect(mockExecFile).toHaveBeenCalledWith(
      'git',
      ['pull', '--rebase'],
      expect.objectContaining({ cwd: 'D:/workspace/.repos/repo' }),
      expect.any(Function),
    );
  });
});

describe(gitPullFfOnly, () => {
  it('constructs correct args with cwd', async () => {
    expect.hasAssertions();

    const { mockExecFile } = setup();

    await gitPullFfOnly('D:/workspace/.repos/repo');

    expect(mockExecFile).toHaveBeenCalledWith(
      'git',
      ['pull', '--ff-only'],
      expect.objectContaining({ cwd: 'D:/workspace/.repos/repo' }),
      expect.any(Function),
    );
  });
});

describe(gitFetchTag, () => {
  it('constructs fetch and checkout commands for tag', async () => {
    expect.hasAssertions();

    const { mockExecFile } = setup();

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
    expect.hasAssertions();

    const { mockExecFile } = setup();

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

describe(gitCheckoutBranch, () => {
  it('fetches the branch from origin then checks it out', async () => {
    expect.hasAssertions();

    const { mockExecFile } = setup();

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
    expect.hasAssertions();

    const { mockExecFile } = setup();

    let callCount = 0;

    mockExecFileImpl(mockExecFile, (args, callback) => {
      callCount++;

      if (callback) {
        // First call: fetch (succeeds)
        // Second call: checkout (fails -- branch not local)
        // Third call: checkout -b (succeeds)
        if (
          callCount === 2 &&
          args?.includes('checkout') &&
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
    });

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
    expect.hasAssertions();

    const { mockExecFile } = setup();

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
  it('gitClone prepends -c core.hooksPath=__op-nx_polyrepo_disable-hooks__ when disableHooks is true', async () => {
    expect.hasAssertions();

    const { mockExecFile } = setup();

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
    expect.hasAssertions();

    const { mockExecFile } = setup();

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
    expect.hasAssertions();

    const { mockExecFile } = setup();

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
    expect.hasAssertions();

    const { mockExecFile } = setup();

    await gitPull('D:/workspace/.repos/repo', true);

    expect(mockExecFile).toHaveBeenCalledWith(
      'git',
      ['-c', 'core.hooksPath=__op-nx_polyrepo_disable-hooks__', 'pull'],
      expect.objectContaining({ cwd: 'D:/workspace/.repos/repo' }),
      expect.any(Function),
    );
  });

  it('gitPull does NOT prepend hooks args when disableHooks is false', async () => {
    expect.hasAssertions();

    const { mockExecFile } = setup();

    await gitPull('D:/workspace/.repos/repo', false);

    expect(mockExecFile).toHaveBeenCalledWith(
      'git',
      ['pull'],
      expect.objectContaining({ cwd: 'D:/workspace/.repos/repo' }),
      expect.any(Function),
    );
  });

  it('gitFetch prepends -c core.hooksPath when disableHooks is true', async () => {
    expect.hasAssertions();

    const { mockExecFile } = setup();

    await gitFetch('D:/workspace/.repos/repo', true);

    expect(mockExecFile).toHaveBeenCalledWith(
      'git',
      ['-c', 'core.hooksPath=__op-nx_polyrepo_disable-hooks__', 'fetch'],
      expect.objectContaining({ cwd: 'D:/workspace/.repos/repo' }),
      expect.any(Function),
    );
  });

  it('gitPullRebase prepends -c core.hooksPath when disableHooks is true', async () => {
    expect.hasAssertions();

    const { mockExecFile } = setup();

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
    expect.hasAssertions();

    const { mockExecFile } = setup();

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
    expect.hasAssertions();

    const { mockExecFile } = setup();

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
    expect.hasAssertions();

    const { mockExecFile } = setup();

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
