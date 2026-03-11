import { execFile } from 'node:child_process';
import { join } from 'node:path';
import type { ExternalGraphJson } from './types';

/**
 * 1 GB maxBuffer -- matches Nx's own LARGE_BUFFER constant.
 * Defined locally to avoid import path fragility across Nx versions.
 */
const LARGE_BUFFER = 1024 * 1024 * 1024;

/**
 * Extract the full project graph JSON from a child Nx workspace.
 *
 * Shells out to `nx graph --print` inside `repoPath` with the daemon
 * disabled (NX_DAEMON=false) to avoid leftover daemon processes.
 */
export function extractGraphFromRepo(
  repoPath: string,
): Promise<ExternalGraphJson> {
  const nxBin = join(repoPath, 'node_modules', '.bin', 'nx');

  return new Promise((resolve, reject) => {
    execFile(
      nxBin,
      ['graph', '--print'],
      {
        cwd: repoPath,
        maxBuffer: LARGE_BUFFER,
        env: { ...process.env, NX_DAEMON: 'false' },
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(
            new Error(
              `Failed to extract graph from ${repoPath}: ${stderr || error.message}`,
            ),
          );

          return;
        }

        try {
          const parsed = JSON.parse(stdout) as ExternalGraphJson;
          resolve(parsed);
        } catch (parseError) {
          reject(
            new Error(
              `Failed to parse graph JSON from ${repoPath}: ${(parseError as Error).message}`,
            ),
          );
        }
      },
    );
  });
}
