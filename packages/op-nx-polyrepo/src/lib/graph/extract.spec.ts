import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ExecFileException } from 'node:child_process';

vi.mock('node:child_process', () => ({
  execFile: vi.fn(),
}));

import { execFile } from 'node:child_process';
import { extractGraphFromRepo } from './extract';

const mockExecFile = vi.mocked(execFile);

describe('extractGraphFromRepo', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls execFile with correct args: node_modules/.bin/nx and graph --print', async () => {
    const graphJson = {
      graph: { nodes: {}, dependencies: {} },
    };

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
        callback(null, JSON.stringify(graphJson), '');
      }
    }) as typeof execFile);

    await extractGraphFromRepo('/workspace/.repos/repo-a');

    expect(mockExecFile).toHaveBeenCalledWith(
      expect.stringMatching(/node_modules[/\\].bin[/\\]nx$/),
      ['graph', '--print'],
      expect.objectContaining({
        cwd: '/workspace/.repos/repo-a',
      }),
      expect.any(Function),
    );
  });

  it('sets cwd to repoPath', async () => {
    const graphJson = { graph: { nodes: {}, dependencies: {} } };

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
        callback(null, JSON.stringify(graphJson), '');
      }
    }) as typeof execFile);

    await extractGraphFromRepo('/some/custom/path');

    expect(mockExecFile).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      expect.objectContaining({ cwd: '/some/custom/path' }),
      expect.any(Function),
    );
  });

  it('sets maxBuffer to LARGE_BUFFER (1GB)', async () => {
    const graphJson = { graph: { nodes: {}, dependencies: {} } };

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
        callback(null, JSON.stringify(graphJson), '');
      }
    }) as typeof execFile);

    await extractGraphFromRepo('/workspace/.repos/repo-a');

    expect(mockExecFile).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      expect.objectContaining({ maxBuffer: 1024 * 1024 * 1024 }),
      expect.any(Function),
    );
  });

  it('sets env with NX_DAEMON=false', async () => {
    const graphJson = { graph: { nodes: {}, dependencies: {} } };

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
        callback(null, JSON.stringify(graphJson), '');
      }
    }) as typeof execFile);

    await extractGraphFromRepo('/workspace/.repos/repo-a');

    expect(mockExecFile).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      expect.objectContaining({
        env: expect.objectContaining({ NX_DAEMON: 'false' }),
      }),
      expect.any(Function),
    );
  });

  it('sets windowsHide=true', async () => {
    const graphJson = { graph: { nodes: {}, dependencies: {} } };

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
        callback(null, JSON.stringify(graphJson), '');
      }
    }) as typeof execFile);

    await extractGraphFromRepo('/workspace/.repos/repo-a');

    expect(mockExecFile).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
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
        callback(null, JSON.stringify(graphJson), '');
      }
    }) as typeof execFile);

    const result = await extractGraphFromRepo('/workspace/.repos/repo-a');

    expect(result).toEqual(graphJson);
  });

  it('rejects with descriptive error including repoPath and stderr when child process fails', async () => {
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
        const err = new Error('Command failed') as ExecFileException;
        callback(err, '', 'nx: command not found');
      }
    }) as typeof execFile);

    await expect(
      extractGraphFromRepo('/workspace/.repos/repo-a'),
    ).rejects.toThrow('/workspace/.repos/repo-a');

    await expect(
      extractGraphFromRepo('/workspace/.repos/repo-a'),
    ).rejects.toThrow('nx: command not found');
  });

  it('handles large stdout (1.4MB+ JSON) without truncation', async () => {
    const largeNodes: Record<string, unknown> = {};

    for (let i = 0; i < 5000; i++) {
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
        callback(null, largeJson, '');
      }
    }) as typeof execFile);

    const result = await extractGraphFromRepo('/workspace/.repos/repo-a');

    expect(Object.keys(result.graph.nodes)).toHaveLength(5000);
  });
});
