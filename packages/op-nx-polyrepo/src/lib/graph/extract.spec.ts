import { describe, it, expect, vi } from 'vitest';
import type { ChildProcess, ExecException } from 'node:child_process';
import { EventEmitter } from 'node:events';

vi.mock('node:child_process', () => ({
  exec: vi.fn<(command: string, options: unknown, callback: unknown) => ChildProcess>(),
}));

import { exec } from 'node:child_process';
import { extractGraphFromRepo } from './extract.js';

/**
 * Create a minimal ChildProcess stub to satisfy the exec return type.
 * exec() overloads all return ChildProcess, so mocks must too.
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

function setupExecSuccess(stdout: string) {
  vi.clearAllMocks();

  const mockExec = vi.mocked(exec);

  mockExec.mockImplementation((
    _command: string,
    _options: unknown,
    callback?: (
      error: ExecException | null,
      stdout: string,
      stderr: string,
    ) => void,
  ) => {
    if (callback) {
      callback(null, stdout, '');
    }

    return createChildProcessStub();
  });

  return { mockExec };
}

function setupExecFailure(errorMessage: string, stderr = '') {
  vi.clearAllMocks();

  const mockExec = vi.mocked(exec);

  mockExec.mockImplementation((
    _command: string,
    _options: unknown,
    callback?: (
      error: ExecException | null,
      stdout: string,
      stderr: string,
    ) => void,
  ) => {
    if (callback) {
      const err: ExecException = new Error(errorMessage);
      callback(err, '', stderr);
    }

    return createChildProcessStub();
  });

  return { mockExec };
}

describe(extractGraphFromRepo, () => {
  it('calls exec with command containing node_modules/.bin/nx and graph --print', async () => {
    expect.hasAssertions();

    const { mockExec } = setupExecSuccess(
      JSON.stringify({ graph: { nodes: {}, dependencies: {} } }),
    );

    await extractGraphFromRepo('/workspace/.repos/repo-a');

    expect(mockExec).toHaveBeenCalledWith(
      expect.stringMatching(/node_modules[/\\].bin[/\\]nx" graph --print$/),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it('sets cwd to repoPath', async () => {
    expect.hasAssertions();

    const { mockExec } = setupExecSuccess(
      JSON.stringify({ graph: { nodes: {}, dependencies: {} } }),
    );

    await extractGraphFromRepo('/some/custom/path');

    expect(mockExec).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ cwd: '/some/custom/path' }),
      expect.any(Function),
    );
  });

  it('sets maxBuffer to LARGE_BUFFER (1GB)', async () => {
    expect.hasAssertions();

    const { mockExec } = setupExecSuccess(
      JSON.stringify({ graph: { nodes: {}, dependencies: {} } }),
    );

    await extractGraphFromRepo('/workspace/.repos/repo-a');

    expect(mockExec).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ maxBuffer: 1024 * 1024 * 1024 }),
      expect.any(Function),
    );
  });

  it('sets env with NX_DAEMON, NX_VERBOSE_LOGGING, and NX_PERF_LOGGING all false', async () => {
    expect.hasAssertions();

    const { mockExec } = setupExecSuccess(
      JSON.stringify({ graph: { nodes: {}, dependencies: {} } }),
    );

    await extractGraphFromRepo('/workspace/.repos/repo-a');

    expect(mockExec).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        env: expect.objectContaining({
          NX_DAEMON: 'false',
          NX_VERBOSE_LOGGING: 'false',
          NX_PERF_LOGGING: 'false',
        }),
      }),
      expect.any(Function),
    );
  });

  it('parses JSON when stdout has leading non-JSON lines', async () => {
    expect.hasAssertions();

    const graphJson = { graph: { nodes: {}, dependencies: {} } };
    const contaminatedStdout =
      '[isolated-plugin] some log line\n' + JSON.stringify(graphJson);

    setupExecSuccess(contaminatedStdout);

    const result = await extractGraphFromRepo('/workspace/.repos/repo-a');

    expect(result).toStrictEqual(graphJson);
  });

  it('rejects when stdout contains no valid JSON', async () => {
    expect.hasAssertions();

    setupExecSuccess('[isolated-plugin] log only\nno json here');

    await expect(
      extractGraphFromRepo('/workspace/.repos/repo-a'),
    ).rejects.toThrowError('/workspace/.repos/repo-a');
  });

  it('rejects when stdout is valid JSON but fails Zod schema validation', async () => {
    expect.hasAssertions();

    setupExecSuccess(JSON.stringify({ notAGraph: true }));

    await expect(
      extractGraphFromRepo('/workspace/.repos/repo-a'),
    ).rejects.toThrowError('/workspace/.repos/repo-a');
  });

  it('sets windowsHide=true', async () => {
    expect.hasAssertions();

    const { mockExec } = setupExecSuccess(
      JSON.stringify({ graph: { nodes: {}, dependencies: {} } }),
    );

    await extractGraphFromRepo('/workspace/.repos/repo-a');

    expect(mockExec).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ windowsHide: true }),
      expect.any(Function),
    );
  });

  it('resolves with parsed JSON when child process succeeds', async () => {
    expect.hasAssertions();

    const graphJson = {
      graph: {
        nodes: {
          'my-lib': {
            name: 'my-lib',
            type: 'lib',
            data: { root: 'libs/my-lib' },
          },
        },
        dependencies: { 'my-lib': [] },
      },
    };

    setupExecSuccess(JSON.stringify(graphJson));

    const result = await extractGraphFromRepo('/workspace/.repos/repo-a');

    expect(result).toStrictEqual(graphJson);
  });

  it('rejects with descriptive error including repoPath and stderr when child process fails', async () => {
    expect.hasAssertions();

    setupExecFailure('Command failed', 'nx: command not found');

    await expect(
      extractGraphFromRepo('/workspace/.repos/repo-a'),
    ).rejects.toThrowError('/workspace/.repos/repo-a');

    setupExecFailure('Command failed', 'nx: command not found');

    await expect(
      extractGraphFromRepo('/workspace/.repos/repo-a'),
    ).rejects.toThrowError('nx: command not found');
  });

  it('handles large stdout (1.4MB+ JSON) without truncation', async () => {
    expect.hasAssertions();

    const largeNodes: Record<string, unknown> = {};

    for (let i = 0; i < 12000; i++) {
      largeNodes[`project-${i}`] = {
        name: `project-${i}`,
        type: 'lib',
        data: {
          root: `libs/project-${i}`,
          targets: { build: { executor: '@nx/js:tsc' } },
        },
      };
    }

    const largeGraph = {
      graph: { nodes: largeNodes, dependencies: {} },
    };
    const largeJson = JSON.stringify(largeGraph);

    // Verify our fixture is > 1.4MB
    expect(largeJson.length).toBeGreaterThan(1_400_000);

    setupExecSuccess(largeJson);

    const result = await extractGraphFromRepo('/workspace/.repos/repo-a');

    expect(Object.keys(result.graph.nodes)).toHaveLength(12000);
  });
});
