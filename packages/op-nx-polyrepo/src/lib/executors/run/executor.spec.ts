import { describe, it, expect, vi } from 'vitest';
import type { ExecutorContext } from '@nx/devkit';
import { assertDefined } from '../../testing/asserts';

vi.mock('nx/src/executors/run-commands/run-commands.impl', () => ({
  default: vi.fn(),
}));

import runExecutor from './executor';
import runCommandsImpl from 'nx/src/executors/run-commands/run-commands.impl';

const mockedRunCommandsImpl = vi.mocked(runCommandsImpl);

function createTestContext(
  overrides?: Partial<ExecutorContext>,
): ExecutorContext {
  return {
    root: '/workspace',
    cwd: '/workspace',
    isVerbose: false,
    projectsConfigurations: { version: 2, projects: {} },
    nxJsonConfiguration: {},
    projectGraph: { nodes: {}, dependencies: {} },
    ...overrides,
  };
}

function setup(): { context: ExecutorContext } {
  vi.clearAllMocks();

  return { context: createTestContext() };
}

describe('runExecutor', () => {
  it('constructs correct nx run command with forward-slashed nxBin', async () => {
    const { context } = setup();
    mockedRunCommandsImpl.mockResolvedValue({
      success: true,
      terminalOutput: '',
    });

    await runExecutor(
      {
        repoAlias: 'repo-a',
        originalProject: 'my-lib',
        targetName: 'build',
      },
      context,
    );

    expect(mockedRunCommandsImpl).toHaveBeenCalledTimes(1);

    const callArgs = mockedRunCommandsImpl.mock.calls[0];
    assertDefined(callArgs, 'runCommandsImpl was not called');

    const options = callArgs[0];

    expect(options.command).toContain('my-lib:build');
    // nxBin path should use forward slashes
    expect(options.command).not.toContain('\\');
    // Should contain the nx binary path
    expect(options.command).toContain('node_modules/.bin/nx');
  });

  it('sets cwd to .repos/<repoAlias> joined with context.root', async () => {
    const { context } = setup();
    mockedRunCommandsImpl.mockResolvedValue({
      success: true,
      terminalOutput: '',
    });

    await runExecutor(
      {
        repoAlias: 'repo-a',
        originalProject: 'my-lib',
        targetName: 'build',
      },
      context,
    );

    const callArgs = mockedRunCommandsImpl.mock.calls[0];
    assertDefined(callArgs, 'runCommandsImpl was not called');

    const options = callArgs[0];

    // cwd should use forward slashes and point to .repos/repo-a
    const cwd = String(options.cwd);

    expect(cwd).toContain('.repos/repo-a');
  });

  it('passes __unparsed__ args through to runCommandsImpl', async () => {
    const { context } = setup();
    mockedRunCommandsImpl.mockResolvedValue({
      success: true,
      terminalOutput: '',
    });

    await runExecutor(
      {
        repoAlias: 'repo-a',
        originalProject: 'my-lib',
        targetName: 'test',
        __unparsed__: ['--watch', '--verbose'],
      },
      context,
    );

    const callArgs = mockedRunCommandsImpl.mock.calls[0];
    assertDefined(callArgs, 'runCommandsImpl was not called');

    const options = callArgs[0];

    expect(options.__unparsed__).toEqual(['--watch', '--verbose']);
  });

  it('returns { success: true } when runCommandsImpl succeeds', async () => {
    const { context } = setup();
    mockedRunCommandsImpl.mockResolvedValue({
      success: true,
      terminalOutput: '',
    });

    const result = await runExecutor(
      {
        repoAlias: 'repo-a',
        originalProject: 'my-lib',
        targetName: 'build',
      },
      context,
    );

    expect(result).toEqual({ success: true });
  });

  it('returns { success: false } when runCommandsImpl fails', async () => {
    const { context } = setup();
    mockedRunCommandsImpl.mockResolvedValue({
      success: false,
      terminalOutput: '',
    });

    const result = await runExecutor(
      {
        repoAlias: 'repo-a',
        originalProject: 'my-lib',
        targetName: 'build',
      },
      context,
    );

    expect(result).toEqual({ success: false });
  });

  it('returns { success: false } when runCommandsImpl throws', async () => {
    const { context } = setup();
    mockedRunCommandsImpl.mockRejectedValue(new Error('spawn failed'));

    const result = await runExecutor(
      {
        repoAlias: 'repo-a',
        originalProject: 'my-lib',
        targetName: 'build',
      },
      context,
    );

    expect(result).toEqual({ success: false });
  });

  it('uses forward slashes in paths for Windows compat', async () => {
    setup();
    mockedRunCommandsImpl.mockResolvedValue({
      success: true,
      terminalOutput: '',
    });

    const windowsContext = createTestContext({
      root: 'C:\\Users\\dev\\workspace',
    });

    await runExecutor(
      {
        repoAlias: 'repo-a',
        originalProject: 'my-lib',
        targetName: 'build',
      },
      windowsContext,
    );

    const callArgs = mockedRunCommandsImpl.mock.calls[0];
    assertDefined(callArgs, 'runCommandsImpl was not called');

    const options = callArgs[0];

    expect(options.command).not.toContain('\\');
    expect(String(options.cwd)).not.toContain('\\');
  });

  it('passes context through to runCommandsImpl', async () => {
    const { context } = setup();
    mockedRunCommandsImpl.mockResolvedValue({
      success: true,
      terminalOutput: '',
    });

    await runExecutor(
      {
        repoAlias: 'repo-a',
        originalProject: 'my-lib',
        targetName: 'build',
      },
      context,
    );

    const callArgs = mockedRunCommandsImpl.mock.calls[0];
    assertDefined(callArgs, 'runCommandsImpl was not called');
    const passedContext = callArgs[1];

    expect(passedContext).toBe(context);
  });

  it('defaults __unparsed__ to empty array when not provided', async () => {
    const { context } = setup();
    mockedRunCommandsImpl.mockResolvedValue({
      success: true,
      terminalOutput: '',
    });

    await runExecutor(
      {
        repoAlias: 'repo-a',
        originalProject: 'my-lib',
        targetName: 'build',
      },
      context,
    );

    const callArgs = mockedRunCommandsImpl.mock.calls[0];
    assertDefined(callArgs, 'runCommandsImpl was not called');

    const options = callArgs[0];

    expect(options.__unparsed__).toEqual([]);
  });
});
