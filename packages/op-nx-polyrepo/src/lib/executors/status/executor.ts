import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { logger } from '@nx/devkit';
import type { ExecutorContext, NxJsonConfiguration } from '@nx/devkit';
import { validateConfig } from '../../config/validate';
import { normalizeRepos, type NormalizedRepoEntry } from '../../config/schema';
import {
  detectRepoState,
  getCurrentBranch,
  getCurrentRef,
} from '../../git/detect';

// Status executor takes no options
export type StatusExecutorOptions = Record<string, never>;

function getRepoPath(
  entry: NormalizedRepoEntry,
  workspaceRoot: string,
): string {
  if (entry.type === 'remote') {
    return join(workspaceRoot, '.repos', entry.alias);
  }

  return entry.path;
}

async function reportRepo(
  entry: NormalizedRepoEntry,
  workspaceRoot: string,
): Promise<void> {
  const state = detectRepoState(entry.alias, entry, workspaceRoot);
  const repoPath = getRepoPath(entry, workspaceRoot);

  if (state === 'not-synced') {
    logger.info(`  ${entry.alias}: not synced`);

    if (entry.type === 'remote') {
      logger.info(`    url: ${entry.url}`);
    }

    return;
  }

  const displayPath =
    state === 'cloned'
      ? `.repos/${entry.alias}/`
      : entry.type === 'local'
        ? entry.path
        : repoPath;

  logger.info(`  ${entry.alias}: ${state} (${displayPath})`);

  const branch = await getCurrentBranch(repoPath);
  const branchLabel = branch ?? (await getCurrentRef(repoPath));

  if (entry.type === 'remote' && entry.ref) {
    const isDrift = branchLabel !== entry.ref;
    const driftMarker = isDrift ? ' [DRIFT]' : '';
    logger.info(
      `    branch: ${branchLabel} (configured: ${entry.ref})${driftMarker}`,
    );
  } else {
    const configuredLabel = 'default';
    logger.info(`    branch: ${branchLabel} (configured: ${configuredLabel})`);
  }
}

export default async function statusExecutor(
  _options: StatusExecutorOptions,
  context: ExecutorContext,
): Promise<{ success: boolean }> {
  const nxJsonPath = join(context.root, 'nx.json');
  const nxJson: NxJsonConfiguration = JSON.parse(
    readFileSync(nxJsonPath, 'utf-8'),
  );
  const pluginEntry = nxJson?.plugins?.find(
    (p) =>
      typeof p === 'object' && 'plugin' in p && p.plugin === '@op-nx/polyrepo',
  );

  const pluginOptions =
    pluginEntry && typeof pluginEntry === 'object' && 'options' in pluginEntry
      ? pluginEntry.options
      : undefined;

  const config = validateConfig(pluginOptions);
  const entries = normalizeRepos(config);

  for (const entry of entries) {
    try {
      await reportRepo(entry, context.root);
    } catch (err) {
      logger.warn(
        `Failed to get status for ${entry.alias}: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  return { success: true };
}
