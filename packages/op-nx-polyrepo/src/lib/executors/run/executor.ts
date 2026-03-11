import type { ExecutorContext } from '@nx/devkit';

export interface RunExecutorOptions {
  repoAlias: string;
  originalProject: string;
  targetName: string;
  __unparsed__?: string[];
}

export default async function runExecutor(
  _options: RunExecutorOptions,
  _context: ExecutorContext,
): Promise<{ success: boolean }> {
  // TODO: implement
  return { success: false };
}
