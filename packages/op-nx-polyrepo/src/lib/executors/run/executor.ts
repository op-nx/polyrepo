import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import runCommandsImpl from 'nx/src/executors/run-commands/run-commands.impl';
import type { ExecutorContext } from '@nx/devkit';

export interface RunExecutorOptions {
  repoAlias: string;
  originalProject: string;
  targetName: string;
  __unparsed__?: string[];
}

/**
 * Normalize all path separators to forward slashes for Windows compatibility.
 */
function normalizePath(p: string): string {
  return p.replace(/\\/g, '/');
}

/**
 * Proxy executor that delegates target execution to a child repo's Nx workspace.
 *
 * Uses `runCommandsImpl` from Nx to shell out to the child repo's local `nx`
 * binary, running the requested target with transparent output streaming.
 */
export default async function runExecutor(
  options: RunExecutorOptions,
  context: ExecutorContext,
): Promise<{ success: boolean }> {
  const repoPath = normalizePath(join(context.root, '.repos', options.repoAlias));
  const nxBin = normalizePath(
    join(repoPath, 'node_modules', '.bin', 'nx'),
  );

  const command = `"${nxBin}" run ${options.originalProject}:${options.targetName}`;

  // Per-repo temp directory prevents lock contention when multiple proxy
  // targets for the same repo run concurrently. Tools that use os.tmpdir()
  // (Node.js), GetTempPath() (Windows native), or $TMPDIR (POSIX) all
  // resolve to this isolated path instead of the shared system %TEMP%.
  const repoTmpDir = normalizePath(join(repoPath, '.tmp'));
  mkdirSync(join(repoPath, '.tmp'), { recursive: true });

  try {
    const result = await runCommandsImpl(
      {
        command,
        cwd: repoPath,
        env: {
          TEMP: repoTmpDir,
          TMP: repoTmpDir,
          TMPDIR: repoTmpDir,
          NX_DAEMON: 'false',
          NX_NO_CLOUD: 'true',
          NX_WORKSPACE_DATA_DIRECTORY: normalizePath(
            join(repoPath, '.nx', 'workspace-data'),
          ),
        },
        __unparsed__: options.__unparsed__ ?? [],
      },
      context,
    );

    return { success: result.success };
  } catch {
    return { success: false };
  }
}
