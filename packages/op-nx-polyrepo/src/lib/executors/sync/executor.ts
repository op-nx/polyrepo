import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
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
  gitCheckoutBranch,
} from '../../git/commands';
import { detectRepoState, getWorkingTreeState, getCurrentBranch, getCurrentRef, isGitTag } from '../../git/detect';
import { formatAlignedTable, type ColumnDef } from '../../format/table';

export interface SyncExecutorOptions {
  strategy?: 'fetch' | 'pull' | 'rebase' | 'ff-only';
  dryRun?: boolean;
  verbose?: boolean;
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

function quietFlag(pm: string): string {
  switch (pm) {
    case 'pnpm': {
      return '--reporter=silent';
    }

    case 'yarn': {
      return '--silent';
    }

    default: {
      return '--loglevel=error';
    }
  }
}

function installDeps(repoPath: string, alias: string, verbose: boolean): Promise<void> {
  const corepackPm = getCorepackPm(repoPath);
  let command: string;
  let displayPm: string;

  if (corepackPm) {
    displayPm = `${corepackPm} via corepack`;
    command = verbose
      ? `corepack ${corepackPm} install`
      : `corepack ${corepackPm} install ${quietFlag(corepackPm)}`;
  } else {
    const pm = detectPackageManager(repoPath);
    displayPm = pm;
    command = verbose
      ? `${pm} install`
      : `${pm} install ${quietFlag(pm)}`;
  }

  const mode = verbose ? '' : ', silent mode';
  logger.info(`Installing dependencies for ${alias} (${displayPm}${mode})...`);

  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      cwd: repoPath,
      shell: true,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, COREPACK_ENABLE_DOWNLOAD_PROMPT: '0' },
    });

    child.stdout.on('data', (chunk: Buffer) => {
      process.stdout.write(chunk);
    });

    child.stderr.on('data', (chunk: Buffer) => {
      process.stderr.write(chunk);
    });

    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`${command} exited with code ${code}`));

        return;
      }

      logger.info(`Done: ${alias} dependencies installed.`);
      resolve();
    });

    child.on('error', (err) => {
      reject(err);
    });
  });
}

function getStrategyFn(
  strategy: SyncExecutorOptions['strategy'],
): (cwd: string, disableHooks?: boolean) => Promise<void> {
  switch (strategy) {
    case 'fetch': {
      return (cwd, dh) => gitFetch(cwd, dh);
    }

    case 'rebase': {
      return (cwd, dh) => gitPullRebase(cwd, dh);
    }

    case 'ff-only': {
      return (cwd, dh) => gitPullFfOnly(cwd, dh);
    }

    default: {
      return (cwd, dh) => gitPull(cwd, dh);
    }
  }
}

const INSTALLED_HASH_FILE = '.op-nx-installed-lock-hash';

function hashLockfile(repoPath: string): string | null {
  const lockfiles = ['pnpm-lock.yaml', 'yarn.lock', 'package-lock.json'];

  for (const name of lockfiles) {
    const fullPath = join(repoPath, name);

    if (existsSync(fullPath)) {
      try {
        const content = readFileSync(fullPath);

        return createHash('sha256').update(content).digest('hex');
      } catch {
        return null;
      }
    }
  }

  return null;
}

function readInstalledHash(repoPath: string): string | null {
  const hashPath = join(repoPath, INSTALLED_HASH_FILE);

  if (!existsSync(hashPath)) {
    return null;
  }

  try {
    return readFileSync(hashPath, 'utf-8').trim() || null;
  } catch {
    return null;
  }
}

function writeInstalledHash(repoPath: string, hash: string): void {
  writeFileSync(join(repoPath, INSTALLED_HASH_FILE), hash);
}

function needsInstall(repoPath: string): boolean {
  const currentHash = hashLockfile(repoPath);
  const installedHash = readInstalledHash(repoPath);

  if (currentHash === null) {
    return true;
  }

  return currentHash !== installedHash;
}

async function tryInstallDeps(
  repoPath: string,
  alias: string,
  verbose: boolean,
): Promise<boolean> {
  try {
    await installDeps(repoPath, alias, verbose);
    const hash = hashLockfile(repoPath);

    if (hash) {
      writeInstalledHash(repoPath, hash);
    }

    return true;
  } catch (error) {
    logger.warn(
      `Failed to install dependencies for ${alias}: ${error}. Run install manually in .repos/${alias}/`,
    );

    return false;
  }
}

interface SyncResult {
  action: string;
  installFailed?: boolean;
}

async function syncRepo(
  entry: NormalizedRepoEntry,
  workspaceRoot: string,
  strategy: SyncExecutorOptions['strategy'],
  verbose: boolean,
): Promise<SyncResult> {
  const state = detectRepoState(entry.alias, entry, workspaceRoot);

  if (entry.type === 'remote') {
    const repoPath = join(workspaceRoot, '.repos', entry.alias);

    if (state === 'not-synced') {
      logger.info(`Cloning ${entry.alias} from ${entry.url}...`);
      await gitClone(entry.url, repoPath, {
        depth: entry.depth,
        ref: entry.ref,
        disableHooks: entry.disableHooks,
      });
      logger.info(`Done: ${entry.alias} cloned.`);
      const installed = await tryInstallDeps(repoPath, entry.alias, verbose);

      return { action: 'cloned', installFailed: !installed };
    }

    if (entry.ref && await isGitTag(repoPath, entry.ref)) {
      logger.info(`Syncing ${entry.alias} to tag ${entry.ref}...`);
      await gitFetchTag(repoPath, entry.ref, entry.depth, entry.disableHooks);
      logger.info(`Done: ${entry.alias} synced to tag ${entry.ref}.`);

      if (needsInstall(repoPath)) {
        const installed = await tryInstallDeps(repoPath, entry.alias, verbose);

        return { action: `synced to tag ${entry.ref}`, installFailed: !installed };
      }

      return { action: `synced to tag ${entry.ref}` };
    }

    // Ensure repo is on the correct branch before pull/fetch
    const currentBranch = await getCurrentBranch(repoPath);

    if (entry.ref && currentBranch !== entry.ref) {
      logger.info(`Switching ${entry.alias} to branch ${entry.ref}...`);
      await gitCheckoutBranch(repoPath, entry.ref, entry.disableHooks);
    }

    const strategyFn = getStrategyFn(strategy);
    logger.info(`Updating ${entry.alias} (${strategy ?? 'pull'})...`);
    await strategyFn(repoPath, entry.disableHooks);
    logger.info(`Done: ${entry.alias} updated.`);

    if (needsInstall(repoPath)) {
      const installed = await tryInstallDeps(repoPath, entry.alias, verbose);

      return { action: strategy ?? 'pull', installFailed: !installed };
    }

    return { action: strategy ?? 'pull' };
  }

  // Local repo
  if (state === 'not-synced') {
    logger.warn(
      `Local repo "${entry.alias}" path does not exist: ${entry.path}. Skipping.`,
    );

    return { action: 'skipped' };
  }

  const strategyFn = getStrategyFn(strategy);
  logger.info(`Updating local repo ${entry.alias} (${strategy ?? 'pull'})...`);
  await strategyFn(entry.path, undefined);
  logger.info(`Done: ${entry.alias} updated.`);

  if (needsInstall(entry.path)) {
    const installed = await tryInstallDeps(entry.path, entry.alias, verbose);

    return { action: strategy ?? 'pull', installFailed: !installed };
  }

  return { action: strategy ?? 'pull' };
}

async function getDryRunAction(
  entry: NormalizedRepoEntry,
  state: 'cloned' | 'referenced' | 'not-synced',
  strategy: SyncExecutorOptions['strategy'],
  repoPath: string,
): Promise<string> {
  if (state === 'not-synced') {
    if (entry.type === 'remote') {
      return 'would clone';
    }

    return 'would skip (path not found)';
  }

  if (entry.type === 'remote' && entry.ref && await isGitTag(repoPath, entry.ref)) {
    return `would sync to tag ${entry.ref}`;
  }

  if (entry.type === 'remote' && entry.ref) {
    const currentBranch = await getCurrentBranch(repoPath);

    if (currentBranch !== entry.ref) {
      return `would switch to ${entry.ref} and ${strategy ?? 'pull'}`;
    }
  }

  return `would ${strategy ?? 'pull'}`;
}

async function executeDryRun(
  entries: NormalizedRepoEntry[],
  workspaceRoot: string,
  strategy: SyncExecutorOptions['strategy'],
): Promise<{ success: boolean }> {
  let wouldSync = 0;
  let wouldSkip = 0;

  const rows: ColumnDef[][] = [];

  for (const entry of entries) {
    const state = detectRepoState(entry.alias, entry, workspaceRoot);
    const repoPath = entry.type === 'remote'
      ? join(workspaceRoot, '.repos', entry.alias)
      : entry.path;
    const action = await getDryRunAction(entry, state, strategy, repoPath);
    const warnings: string[] = [];

    if (state !== 'not-synced') {
      const treeState = await getWorkingTreeState(repoPath);
      const total = treeState.modified + treeState.staged + treeState.deleted
        + treeState.untracked + treeState.conflicts;

      if (total > 0) {
        warnings.push('[WARN: dirty, may fail]');
      }

      const branch = await getCurrentBranch(repoPath);
      const isDetachedHead = branch === null;

      if (isDetachedHead) {
        const ref = await getCurrentRef(repoPath);

        if (await isGitTag(repoPath, ref)) {
          warnings.push('[WARN: tag-pinned]');
        } else {
          warnings.push('[WARN: detached HEAD]');
        }
      }
    }

    if (action.includes('skip')) {
      wouldSkip++;
    } else {
      wouldSync++;
    }

    rows.push([
      { value: entry.alias },
      { value: action },
      { value: warnings.join(' ') },
    ]);
  }

  const formattedRows = formatAlignedTable(rows);

  logger.info('');
  logger.info('Dry run:');

  for (const row of formattedRows) {
    logger.info(row);
  }

  logger.info('');
  logger.info(`Dry run: ${wouldSync} would sync, ${wouldSkip} would skip`);

  return { success: true };
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
  const verbose = options.verbose ?? false;

  if (options.dryRun) {
    return executeDryRun(entries, context.root, strategy);
  }

  const results = await Promise.allSettled(
    entries.map((entry) => syncRepo(entry, context.root, strategy, verbose)),
  );

  let synced = 0;
  let warned = 0;
  let failed = 0;
  const tableRows: ColumnDef[][] = [];

  for (let i = 0; i < results.length; i++) {
    const result = results[i];

    if (result.status === 'fulfilled') {
      if (result.value.installFailed) {
        warned++;
        tableRows.push([
          { value: entries[i].alias },
          { value: result.value.action },
          { value: '[WARN: install failed]' },
        ]);
      } else {
        synced++;
        tableRows.push([
          { value: entries[i].alias },
          { value: result.value.action },
          { value: '[OK]' },
        ]);
      }
    } else {
      failed++;
      const reason = result.reason instanceof Error
        ? result.reason.message
        : String(result.reason);
      logger.error(`Failed to sync ${entries[i].alias}: ${result.reason}`);
      tableRows.push([
        { value: entries[i].alias },
        { value: strategy ?? 'pull' },
        { value: `[ERROR] ${reason}` },
      ]);
    }
  }

  const formattedRows = formatAlignedTable(tableRows);

  logger.info('');
  logger.info('Results:');

  for (const row of formattedRows) {
    logger.info(row);
  }

  const parts: string[] = [];

  if (synced > 0) {
    parts.push(`${synced} synced`);
  }

  if (warned > 0) {
    parts.push(`${warned} synced with warning`);
  }

  if (failed > 0) {
    parts.push(`${failed} failed`);
  }

  logger.info(`Summary: ${parts.join(', ')}`);

  return { success: failed === 0 };
}
