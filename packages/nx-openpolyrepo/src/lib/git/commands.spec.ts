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
} from './commands.js';

const mockExecFile = vi.mocked(execFile);

function setupExecFileMock(): void {
  mockExecFile.mockImplementation(
    ((_file: string, _args: readonly string[], _options: unknown, callback?: (error: ExecFileException | null, stdout: string, stderr: string) => void) => {
      if (callback) {
        callback(null, '', '');
      }
    }) as typeof execFile
  );
}

describe('gitClone', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupExecFileMock();
  });

  it('constructs correct args for default shallow clone', async () => {
    await gitClone('https://github.com/org/repo.git', 'D:/workspace/.repos/repo');

    expect(mockExecFile).toHaveBeenCalledWith(
      'git',
      ['clone', '--depth', '1', 'https://github.com/org/repo.git', 'D:/workspace/.repos/repo'],
      expect.any(Object),
      expect.any(Function)
    );
  });

  it('constructs correct args for full clone (depth 0)', async () => {
    await gitClone('https://github.com/org/repo.git', 'D:/workspace/.repos/repo', { depth: 0 });

    expect(mockExecFile).toHaveBeenCalledWith(
      'git',
      ['clone', 'https://github.com/org/repo.git', 'D:/workspace/.repos/repo'],
      expect.any(Object),
      expect.any(Function)
    );
  });

  it('constructs correct args when ref is specified', async () => {
    await gitClone('https://github.com/org/repo.git', 'D:/workspace/.repos/repo', { ref: 'develop' });

    expect(mockExecFile).toHaveBeenCalledWith(
      'git',
      ['clone', '--depth', '1', '--branch', 'develop', 'https://github.com/org/repo.git', 'D:/workspace/.repos/repo'],
      expect.any(Object),
      expect.any(Function)
    );
  });

  it('normalizes backslashes in target directory to forward slashes', async () => {
    await gitClone('https://github.com/org/repo.git', 'D:\\workspace\\.repos\\repo');

    expect(mockExecFile).toHaveBeenCalledWith(
      'git',
      ['clone', '--depth', '1', 'https://github.com/org/repo.git', 'D:/workspace/.repos/repo'],
      expect.any(Object),
      expect.any(Function)
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
      expect.any(Function)
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
      expect.any(Function)
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
      expect.any(Function)
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
      expect.any(Function)
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
      expect.any(Function)
    );

    expect(mockExecFile).toHaveBeenNthCalledWith(
      2,
      'git',
      ['checkout', 'v1.0.0'],
      expect.objectContaining({ cwd: 'D:/workspace/.repos/repo' }),
      expect.any(Function)
    );
  });

  it('uses custom depth for tag fetch', async () => {
    await gitFetchTag('D:/workspace/.repos/repo', 'v2.0.0', 5);

    expect(mockExecFile).toHaveBeenNthCalledWith(
      1,
      'git',
      ['fetch', '--depth', '5', 'origin', 'tag', 'v2.0.0'],
      expect.objectContaining({ cwd: 'D:/workspace/.repos/repo' }),
      expect.any(Function)
    );
  });
});
