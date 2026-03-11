import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { exec } from 'node:child_process';
import { logger } from '@nx/devkit';
import type { ExecutorContext, NxJsonConfiguration } from '@nx/devkit';
import { validateConfig } from '../../config/validate';
import { normalizeRepos, type NormalizedRepoEntry } from '../../config/schema';
import {
  gitClone,
  gitPull,
  gitFetch,
  gitPullRebase,
  gitPullFfOnly,
  gitFetchTag,
} from '../../git/commands';
import { detectRepoState } from '../../git/detect';

export interface SyncExecutorOptions {
  strategy?: 'fetch' | 'pull' | 'rebase' | 'ff-only';
}

function detectPackageManager(
  repoPath: string,
): 'pnpm' | 'yarn' | 'npm' {
  if (existsSync(join(repoPath, 'pnpm-lock.yaml'))) {
    return 'pnpm';
  }

  if (existsSync(join(repoPath, 'yarn.lock'))) {
    return 'yarn';
  }

  return 'npm';
}

function getCorepackPm(
  repoPath: string,
): string | undefined {
  try {
    const pkgJsonPath = join(repoPath, 'package.json');

    if (!existsSync(pkgJsonPath)) {
      return undefined;
    }

    const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf-8'));
    const field: unknown = pkgJson.packageManager;

    if (typeof field !== 'string') {
      return undefined;
    }

    const pm = field.split('@')[0];

    if (pm === 'pnpm' || pm === 'yarn' || pm === 'npm') {
      return pm;
    }

    return undefined;
  } catch {
    return undefined;
  }
}

function installDeps(repoPath: string, alias: string): Promise<void> {
  const corepackPm = getCorepackPm(repoPath);
  let command: string;

  if (corepackPm) {
    command = `corepack ${corepackPm} install`;
    logger.info(`Installing dependencies for ${alias} (${corepackPm} via corepack)...`);
  } else {
    const pm = detectPackageManager(repoPath);
    command = `${pm} install`;
    logger.info(`Installing dependencies for ${alias} (${pm})...`);
  }

  return new Promise((resolve, reject) => {
    exec(command, { cwd: repoPath, windowsHide: true }, (error, _stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || error.message));

        return;
      }

      logger.info(`Done: ${alias} dependencies installed.`);
      resolve();
    });
  });
}

const tagPattern = /^v?\d+\.\d+/;

function isTagRef(ref: string | undefined): boolean {
  if (!ref) {
    return false;
  }

  return tagPattern.test(ref);
}

function getStrategyFn(
  strategy: SyncExecutorOptions['strategy'],
): (cwd: string) => Promise<void> {
  switch (strategy) {
    case 'fetch': {
      return gitFetch;
    }

    case 'rebase': {
      return gitPullRebase;
    }

    case 'ff-only': {
      return gitPullFfOnly;
    }

    default: {
      return gitPull;
    }
  }
}

async function tryInstallDeps(
  repoPath: string,
  alias: string,
): Promise<void> {
  try {
    await installDeps(repoPath, alias);
  } catch (error) {
    logger.warn(
      `Failed to install dependencies for ${alias}: ${error}. Run install manually in .repos/${alias}/`,
    );
  }
}

async function syncRepo(
  entry: NormalizedRepoEntry,
  workspaceRoot: string,
  strategy: SyncExecutorOptions['strategy'],
): Promise<void> {
  const state = detectRepoState(entry.alias, entry, workspaceRoot);

  if (entry.type === 'remote') {
    const repoPath = join(workspaceRoot, '.repos', entry.alias);

    if (state === 'not-synced') {
      logger.info(`Cloning ${entry.alias} from ${entry.url}...`);
      await gitClone(entry.url, repoPath, {
        depth: entry.depth,
        ref: entry.ref,
      });
      logger.info(`Done: ${entry.alias} cloned.`);
      await tryInstallDeps(repoPath, entry.alias);

      return;
    }

    if (entry.ref && isTagRef(entry.ref)) {
      logger.info(`Fetching tag ${entry.ref} for ${entry.alias}...`);
      await gitFetchTag(repoPath, entry.ref, entry.depth);
      logger.info(`Done: ${entry.alias} at tag ${entry.ref}.`);
      await tryInstallDeps(repoPath, entry.alias);

      return;
    }

    const strategyFn = getStrategyFn(strategy);
    logger.info(`Updating ${entry.alias} (${strategy ?? 'pull'})...`);
    await strategyFn(repoPath);
    logger.info(`Done: ${entry.alias} updated.`);
    await tryInstallDeps(repoPath, entry.alias);

    return;
  }

  // Local repo
  if (state === 'not-synced') {
    logger.warn(
      `Local repo "${entry.alias}" path does not exist: ${entry.path}. Skipping.`,
    );

    return;
  }

  const strategyFn = getStrategyFn(strategy);
  logger.info(`Updating local repo ${entry.alias} (${strategy ?? 'pull'})...`);
  await strategyFn(entry.path);
  logger.info(`Done: ${entry.alias} updated.`);
  await tryInstallDeps(entry.path, entry.alias);
}

export default async function syncExecutor(
  options: SyncExecutorOptions,
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
  const strategy = options.strategy;

  const results = await Promise.allSettled(
    entries.map((entry) => syncRepo(entry, context.root, strategy)),
  );

  let synced = 0;
  let failed = 0;

  for (let i = 0; i < results.length; i++) {
    const result = results[i];

    if (result.status === 'fulfilled') {
      synced++;
    } else {
      failed++;
      logger.error(`Failed to sync ${entries[i].alias}: ${result.reason}`);
    }
  }

  logger.info(`Summary: ${synced} synced, ${failed} failed.`);

  return { success: failed === 0 };
}
