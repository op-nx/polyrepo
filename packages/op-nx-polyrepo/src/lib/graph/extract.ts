import { exec } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { externalGraphJsonSchema } from './types';
import type { ExternalGraphJson } from './types';

/**
 * Normalize all path separators to forward slashes.
 */
function normalizePath(p: string): string {
  return p.replace(/\\/g, '/');
}

/**
 * 1 GB maxBuffer -- matches Nx's own LARGE_BUFFER constant.
 * Defined locally to avoid import path fragility across Nx versions.
 */
const LARGE_BUFFER = 1024 * 1024 * 1024;

/**
 * Filename for pre-computed graph JSON. The e2e Dockerfile generates this
 * during image build by running `nx graph --print` in the synced repo.
 * Reading from this file avoids a ~4-5 min child process (cold @nx/gradle
 * JVM init) on first extraction.
 */
const CACHED_GRAPH_FILENAME = '.nx-graph-output.json';

/**
 * Attempt to parse a cached `nx graph --print` JSON file from the repo.
 * Returns undefined if the file doesn't exist, is empty, or fails validation.
 */
function tryReadCachedGraph(repoPath: string): ExternalGraphJson | undefined {
  try {
    const raw = readFileSync(join(repoPath, CACHED_GRAPH_FILENAME), 'utf-8');

    if (!raw.trim()) {
      return undefined;
    }

    // The cached file may contain Nx banner/error output before the JSON
    // (e.g., Gradle plugin download progress on stdout). Find the actual
    // JSON start by looking for the nx graph --print envelope. The output
    // may be pretty-printed ({\n  "graph") or compact ({"graph").
    const match = /\{\s*"graph"/.exec(raw);
    const jsonStart = match?.index ?? -1;

    if (jsonStart < 0) {
      return undefined;
    }

    const result = externalGraphJsonSchema.safeParse(
      JSON.parse(raw.substring(jsonStart)),
    );

    if (!result.success) {
      return undefined;
    }

    return result.data;
  } catch {
    return undefined;
  }
}

/**
 * Extract the full project graph JSON from a child Nx workspace.
 *
 * Fast path: reads a pre-computed `.nx-graph-output.json` file if present
 * (generated during Docker image build). This avoids the ~4-5 min cold
 * start from @nx/gradle JVM initialization.
 *
 * Slow path: spawns `nx graph --print` as a child process. Uses `exec`
 * (shell dispatch) because the nx binary in node_modules/.bin is a .cmd
 * shim on Windows that `execFile` cannot execute directly. The daemon is
 * disabled (NX_DAEMON=false) to avoid leftover processes.
 */
export function extractGraphFromRepo(
  repoPath: string,
): Promise<ExternalGraphJson> {
  const cached = tryReadCachedGraph(repoPath);

  if (cached) {
    return Promise.resolve(cached);
  }
  const nxBin = join(repoPath, 'node_modules', '.bin', 'nx');
  const command = `"${nxBin}" graph --print`;

  // Ensure the temp directory exists before spawning the child process.
  // Same isolation as the proxy executor: prevents lock contention and
  // "path not found" errors when .nx/ was deleted.
  const repoTmpDir = normalizePath(join(repoPath, '.tmp'));
  mkdirSync(join(repoPath, '.tmp'), { recursive: true });

  return new Promise((resolve, reject) => {
    exec(
      command,
      {
        cwd: repoPath,
        maxBuffer: LARGE_BUFFER,
        env: {
          ...process.env,
          TEMP: repoTmpDir,
          TMP: repoTmpDir,
          TMPDIR: repoTmpDir,
          NX_DAEMON: 'false',
          NX_NO_CLOUD: 'true',
          NX_VERBOSE_LOGGING: 'false',
          NX_PERF_LOGGING: 'false',
        },
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

        const jsonStart = stdout.indexOf('{');

        if (jsonStart < 0) {
          reject(
            new Error(
              `No JSON found in stdout from ${repoPath}: ${stdout.slice(0, 200)}`,
            ),
          );

          return;
        }

        const jsonPayload = stdout.substring(jsonStart);

        try {
          const result = externalGraphJsonSchema.safeParse(
            JSON.parse(jsonPayload),
          );

          if (!result.success) {
            reject(
              new Error(
                `Invalid graph JSON from ${repoPath}: ${result.error.message}`,
              ),
            );

            return;
          }

          resolve(result.data);
        } catch (parseError) {
          reject(
            new Error(
              `Failed to parse graph JSON from ${repoPath}: ${parseError instanceof Error ? parseError.message : String(parseError)}`,
            ),
          );
        }
      },
    );
  });
}
