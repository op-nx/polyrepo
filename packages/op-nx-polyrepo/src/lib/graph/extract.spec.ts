import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ExecException } from 'node:child_process';

vi.mock('node:child_process', () => ({
  exec: vi.fn(),
}));

import { exec } from 'node:child_process';
import { extractGraphFromRepo } from './extract';

const mockExec = vi.mocked(exec);

function setupExecSuccess(stdout: string): void {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- overloaded function mock requires cast
  mockExec.mockImplementation(((
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
  }) as typeof exec);
}

function setupExecFailure(errorMessage: string, stderr = ''): void {
  // eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- overloaded function mock requires cast
  mockExec.mockImplementation(((
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
  }) as typeof exec);
}

describe('extractGraphFromRepo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls exec with command containing node_modules/.bin/nx and graph --print', async () => {
    const graphJson = {
      graph: { nodes: {}, dependencies: {} },
    };
    setupExecSuccess(JSON.stringify(graphJson));

    await extractGraphFromRepo('/workspace/.repos/repo-a');

    expect(mockExec).toHaveBeenCalledWith(
      expect.stringMatching(/node_modules[/\\].bin[/\\]nx" graph --print$/),
      expect.any(Object),
      expect.any(Function),
    );
  });

  it('sets cwd to repoPath', async () => {
    const graphJson = { graph: { nodes: {}, dependencies: {} } };
    setupExecSuccess(JSON.stringify(graphJson));

    await extractGraphFromRepo('/some/custom/path');

    expect(mockExec).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ cwd: '/some/custom/path' }),
      expect.any(Function),
    );
  });

  it('sets maxBuffer to LARGE_BUFFER (1GB)', async () => {
    const graphJson = { graph: { nodes: {}, dependencies: {} } };
    setupExecSuccess(JSON.stringify(graphJson));

    await extractGraphFromRepo('/workspace/.repos/repo-a');

    expect(mockExec).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ maxBuffer: 1024 * 1024 * 1024 }),
      expect.any(Function),
    );
  });

  it('sets env with NX_DAEMON, NX_VERBOSE_LOGGING, and NX_PERF_LOGGING all false', async () => {
    const graphJson = { graph: { nodes: {}, dependencies: {} } };
    setupExecSuccess(JSON.stringify(graphJson));

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
    const graphJson = { graph: { nodes: {}, dependencies: {} } };
    const contaminatedStdout =
      '[isolated-plugin] some log line\n' + JSON.stringify(graphJson);
    setupExecSuccess(contaminatedStdout);

    const result = await extractGraphFromRepo('/workspace/.repos/repo-a');

    expect(result).toEqual(graphJson);
  });

  it('rejects when stdout contains no valid JSON', async () => {
    setupExecSuccess('[isolated-plugin] log only\nno json here');

    await expect(
      extractGraphFromRepo('/workspace/.repos/repo-a'),
    ).rejects.toThrow('/workspace/.repos/repo-a');
  });

  it('sets windowsHide=true', async () => {
    const graphJson = { graph: { nodes: {}, dependencies: {} } };
    setupExecSuccess(JSON.stringify(graphJson));

    await extractGraphFromRepo('/workspace/.repos/repo-a');

    expect(mockExec).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ windowsHide: true }),
      expect.any(Function),
    );
  });

  it('resolves with parsed JSON when child process succeeds', async () => {
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

    expect(result).toEqual(graphJson);
  });

  it('rejects with descriptive error including repoPath and stderr when child process fails', async () => {
    setupExecFailure('Command failed', 'nx: command not found');

    await expect(
      extractGraphFromRepo('/workspace/.repos/repo-a'),
    ).rejects.toThrow('/workspace/.repos/repo-a');

    await expect(
      extractGraphFromRepo('/workspace/.repos/repo-a'),
    ).rejects.toThrow('nx: command not found');
  });

  it('handles large stdout (1.4MB+ JSON) without truncation', async () => {
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
