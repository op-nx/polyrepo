import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ExecutorContext } from '@nx/devkit';

vi.mock('nx/src/executors/run-commands/run-commands.impl', () => ({
  default: vi.fn(),
}));

import runExecutor from './executor';
import runCommandsImpl from 'nx/src/executors/run-commands/run-commands.impl';

const mockedRunCommandsImpl = vi.mocked(runCommandsImpl);

const baseContext: ExecutorContext = {
  root: '/workspace',
  cwd: '/workspace',
  isVerbose: false,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('runExecutor', () => {
  it('constructs correct nx run command with forward-slashed nxBin', async () => {
    mockedRunCommandsImpl.mockResolvedValue({ success: true });

    await runExecutor(
      {
        repoAlias: 'repo-a',
        originalProject: 'my-lib',
        targetName: 'build',
      },
      baseContext,
    );

    expect(mockedRunCommandsImpl).toHaveBeenCalledTimes(1);

    const callArgs = mockedRunCommandsImpl.mock.calls[0];
    const options = callArgs[0];

    expect(options.command).toContain('my-lib:build');
    // nxBin path should use forward slashes
    expect(options.command).not.toContain('\\');
    // Should contain the nx binary path
    expect(options.command).toContain('node_modules/.bin/nx');
  });

  it('sets cwd to .repos/<repoAlias> joined with context.root', async () => {
    mockedRunCommandsImpl.mockResolvedValue({ success: true });

    await runExecutor(
      {
        repoAlias: 'repo-a',
        originalProject: 'my-lib',
        targetName: 'build',
      },
      baseContext,
    );

    const callArgs = mockedRunCommandsImpl.mock.calls[0];
    const options = callArgs[0];

    // cwd should use forward slashes and point to .repos/repo-a
    const cwd = options.cwd as string;

    expect(cwd).toContain('.repos/repo-a');
  });

  it('passes __unparsed__ args through to runCommandsImpl', async () => {
    mockedRunCommandsImpl.mockResolvedValue({ success: true });

    await runExecutor(
      {
        repoAlias: 'repo-a',
        originalProject: 'my-lib',
        targetName: 'test',
        __unparsed__: ['--watch', '--verbose'],
      },
      baseContext,
    );

    const callArgs = mockedRunCommandsImpl.mock.calls[0];
    const options = callArgs[0];

    expect(options.__unparsed__).toEqual(['--watch', '--verbose']);
  });

  it('returns { success: true } when runCommandsImpl succeeds', async () => {
    mockedRunCommandsImpl.mockResolvedValue({ success: true });

    const result = await runExecutor(
      {
        repoAlias: 'repo-a',
        originalProject: 'my-lib',
        targetName: 'build',
      },
      baseContext,
    );

    expect(result).toEqual({ success: true });
  });

  it('returns { success: false } when runCommandsImpl fails', async () => {
    mockedRunCommandsImpl.mockResolvedValue({ success: false });

    const result = await runExecutor(
      {
        repoAlias: 'repo-a',
        originalProject: 'my-lib',
        targetName: 'build',
      },
      baseContext,
    );

    expect(result).toEqual({ success: false });
  });

  it('returns { success: false } when runCommandsImpl throws', async () => {
    mockedRunCommandsImpl.mockRejectedValue(new Error('spawn failed'));

    const result = await runExecutor(
      {
        repoAlias: 'repo-a',
        originalProject: 'my-lib',
        targetName: 'build',
      },
      baseContext,
    );

    expect(result).toEqual({ success: false });
  });

  it('uses forward slashes in paths for Windows compat', async () => {
    mockedRunCommandsImpl.mockResolvedValue({ success: true });

    const windowsContext: ExecutorContext = {
      ...baseContext,
      root: 'C:\\Users\\dev\\workspace',
    };

    await runExecutor(
      {
        repoAlias: 'repo-a',
        originalProject: 'my-lib',
        targetName: 'build',
      },
      windowsContext,
    );

    const callArgs = mockedRunCommandsImpl.mock.calls[0];
    const options = callArgs[0];

    expect(options.command).not.toContain('\\');
    expect((options.cwd as string)).not.toContain('\\');
  });

  it('passes context through to runCommandsImpl', async () => {
    mockedRunCommandsImpl.mockResolvedValue({ success: true });

    await runExecutor(
      {
        repoAlias: 'repo-a',
        originalProject: 'my-lib',
        targetName: 'build',
      },
      baseContext,
    );

    const callArgs = mockedRunCommandsImpl.mock.calls[0];
    const context = callArgs[1];

    expect(context).toBe(baseContext);
  });

  it('defaults __unparsed__ to empty array when not provided', async () => {
    mockedRunCommandsImpl.mockResolvedValue({ success: true });

    await runExecutor(
      {
        repoAlias: 'repo-a',
        originalProject: 'my-lib',
        targetName: 'build',
      },
      baseContext,
    );

    const callArgs = mockedRunCommandsImpl.mock.calls[0];
    const options = callArgs[0];

    expect(options.__unparsed__).toEqual([]);
  });
});
