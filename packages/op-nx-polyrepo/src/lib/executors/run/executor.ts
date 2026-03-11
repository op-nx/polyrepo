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

  try {
    const result = await runCommandsImpl(
      {
        command,
        cwd: repoPath,
        __unparsed__: options.__unparsed__ ?? [],
      },
      context,
    );

    return { success: result.success };
  } catch {
    return { success: false };
  }
}
