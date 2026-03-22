import { describe, it, expect, vi } from 'vitest';
import type { ExecutorContext } from '@nx/devkit';
import { assertDefined } from '../../testing/asserts';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();

  return { ...actual, mkdirSync: vi.fn() };
});

vi.mock('nx/src/executors/run-commands/run-commands.impl', () => ({
  default: vi.fn<(...args: unknown[]) => Promise<{ success: boolean; terminalOutput: string }>>(),
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

describe(runExecutor, () => {
  it('constructs correct nx run command with forward-slashed nxBin', async () => {
    expect.hasAssertions();

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
    expect.hasAssertions();

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
    expect.hasAssertions();

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

    expect(options.__unparsed__).toStrictEqual(['--watch', '--verbose']);
  });

  it('returns { success: true } when runCommandsImpl succeeds', async () => {
    expect.hasAssertions();

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

    expect(result).toStrictEqual({ success: true });
  });

  it('returns { success: false } when runCommandsImpl fails', async () => {
    expect.hasAssertions();

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

    expect(result).toStrictEqual({ success: false });
  });

  it('returns { success: false } when runCommandsImpl throws', async () => {
    expect.hasAssertions();

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

    expect(result).toStrictEqual({ success: false });
  });

  it('uses forward slashes in paths for Windows compat', async () => {
    expect.hasAssertions();

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
    expect.hasAssertions();

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
    expect.hasAssertions();

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

    expect(options.__unparsed__).toStrictEqual([]);
  });

  it('passes NX_DAEMON=false and NX_WORKSPACE_DATA_DIRECTORY env vars to runCommandsImpl', async () => {
    expect.hasAssertions();

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

    expect(options).toHaveProperty('env');

    const env = options.env;
    assertDefined(env, 'env should be defined');

    expect(env['NX_DAEMON']).toBe('false');
    expect(env['TEMP']).toBe('/workspace/.repos/repo-a/tmp');
    expect(env['TMP']).toBe('/workspace/.repos/repo-a/tmp');
    expect(env['TMPDIR']).toBe('/workspace/.repos/repo-a/tmp');
    expect(env['NX_WORKSPACE_DATA_DIRECTORY']).toBe(
      '/workspace/.repos/repo-a/.nx/workspace-data',
    );
  });

  it('uses forward slashes in NX_WORKSPACE_DATA_DIRECTORY on Windows', async () => {
    expect.hasAssertions();

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

    expect(options).toHaveProperty('env');

    const env = options.env;
    assertDefined(env, 'env should be defined');

    expect(env['NX_WORKSPACE_DATA_DIRECTORY']).not.toContain('\\');
    expect(env['NX_WORKSPACE_DATA_DIRECTORY']).toBe(
      'C:/Users/dev/workspace/.repos/repo-a/.nx/workspace-data',
    );
  });
});
