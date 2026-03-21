import { readFileSync, existsSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { z } from 'zod';
import { logger } from '@nx/devkit';
import type { ExecutorContext } from '@nx/devkit';
import { hashObject } from 'nx/src/devkit-internals';
import { resolvePluginConfig } from '../../config/resolve';
import type { NormalizedRepoEntry } from '../../config/schema';
import { computeRepoHash, writePerRepoCache } from '../../graph/cache';
import { extractGraphFromRepo } from '../../graph/extract';
import { transformGraphForRepo } from '../../graph/transform';
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

const packageJsonSchema = z
  .object({
    packageManager: z.string().optional(),
  })
  .loose();

function getCorepackPm(
  repoPath: string,
): string | undefined {
  try {
    const pkgJsonPath = join(repoPath, 'package.json');

    if (!existsSync(pkgJsonPath)) {
      return undefined;
    }

    const result = packageJsonSchema.safeParse(
      JSON.parse(readFileSync(pkgJsonPath, 'utf-8')),
    );

    if (!result.success) {
      return undefined;
    }

    const field = result.data.packageManager;

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
        reject(new Error(`${command} exited with code ${String(code)}`));

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

function hashFilePath(workspaceRoot: string, alias: string): string {
  return join(workspaceRoot, '.repos', `.${alias}.lock-hash`);
}

function readInstalledHash(workspaceRoot: string, alias: string): string | null {
  const hashPath = hashFilePath(workspaceRoot, alias);

  if (!existsSync(hashPath)) {
    return null;
  }

  try {
    return readFileSync(hashPath, 'utf-8').trim() || null;
  } catch {
    return null;
  }
}

function writeInstalledHash(workspaceRoot: string, alias: string, hash: string): void {
  writeFileSync(hashFilePath(workspaceRoot, alias), hash);
}

function needsInstall(repoPath: string, workspaceRoot: string, alias: string): boolean {
  // If node_modules is missing (e.g., after git clean -fdx), always install
  // regardless of lockfile hash match.
  if (!existsSync(join(repoPath, 'node_modules'))) {
    return true;
  }

  const currentHash = hashLockfile(repoPath);
  const installedHash = readInstalledHash(workspaceRoot, alias);

  if (currentHash === null) {
    return true;
  }

  return currentHash !== installedHash;
}

async function tryInstallDeps(
  repoPath: string,
  alias: string,
  verbose: boolean,
  workspaceRoot: string,
): Promise<boolean> {
  // Clear stale Nx cache when node_modules was missing. Without this,
  // the child Nx hits remote/local cache entries whose output files
  // (dist/) were deleted alongside node_modules, causing ENOENT errors
  // in post-build scripts.
  if (!existsSync(join(repoPath, 'node_modules'))) {
    rmSync(join(repoPath, '.nx', 'cache'), { recursive: true, force: true });
    rmSync(join(repoPath, 'dist'), { recursive: true, force: true });
  }

  try {
    await installDeps(repoPath, alias, verbose);
    const hash = hashLockfile(repoPath);

    if (hash) {
      writeInstalledHash(workspaceRoot, alias, hash);
    }

    return true;
  } catch (error) {
    logger.warn(
      `Failed to install dependencies for ${alias}: ${String(error)}. Run install manually in .repos/${alias}/`,
    );

    return false;
  }
}

async function preCacheGraph(
  repoPath: string,
  alias: string,
  workspaceRoot: string,
  reposConfigHash: string,
): Promise<void> {
  logger.info(`Extracting graph for ${alias}...`);

  try {
    const rawGraph = await extractGraphFromRepo(repoPath);
    const transformed = transformGraphForRepo(alias, rawGraph, workspaceRoot);
    const hash = await computeRepoHash(reposConfigHash, alias, repoPath);

    writePerRepoCache(workspaceRoot, alias, hash, {
      nodes: transformed.nodes,
      dependencies: transformed.dependencies,
    });

    const projectCount = Object.keys(transformed.nodes).length;
    logger.info(`Cached graph for ${alias} (${String(projectCount)} projects)`);
  } catch (error) {
    logger.warn(
      `Failed to pre-cache graph for ${alias}: ${error instanceof Error ? error.message : String(error)}`,
    );
    logger.warn('Plugin will extract on next Nx command.');
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
  reposConfigHash: string,
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
      const installed = await tryInstallDeps(repoPath, entry.alias, verbose, workspaceRoot);

      if (installed) {
        await preCacheGraph(repoPath, entry.alias, workspaceRoot, reposConfigHash);
      }

      return { action: 'cloned', installFailed: !installed };
    }

    if (entry.ref && await isGitTag(repoPath, entry.ref)) {
      logger.info(`Syncing ${entry.alias} to tag ${entry.ref}...`);
      await gitFetchTag(repoPath, entry.ref, entry.depth, entry.disableHooks);
      logger.info(`Done: ${entry.alias} synced to tag ${entry.ref}.`);

      if (needsInstall(repoPath, workspaceRoot, entry.alias)) {
        const installed = await tryInstallDeps(repoPath, entry.alias, verbose, workspaceRoot);

        if (installed) {
          await preCacheGraph(repoPath, entry.alias, workspaceRoot, reposConfigHash);
        }

        return { action: `synced to tag ${entry.ref}`, installFailed: !installed };
      }

      await preCacheGraph(repoPath, entry.alias, workspaceRoot, reposConfigHash);

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

    if (needsInstall(repoPath, workspaceRoot, entry.alias)) {
      const installed = await tryInstallDeps(repoPath, entry.alias, verbose, workspaceRoot);

      if (installed) {
        await preCacheGraph(repoPath, entry.alias, workspaceRoot, reposConfigHash);
      }

      return { action: strategy ?? 'pull', installFailed: !installed };
    }

    await preCacheGraph(repoPath, entry.alias, workspaceRoot, reposConfigHash);

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

  if (needsInstall(entry.path, workspaceRoot, entry.alias)) {
    const installed = await tryInstallDeps(entry.path, entry.alias, verbose, workspaceRoot);

    if (installed) {
      await preCacheGraph(entry.path, entry.alias, workspaceRoot, reposConfigHash);
    }

    return { action: strategy ?? 'pull', installFailed: !installed };
  }

  await preCacheGraph(entry.path, entry.alias, workspaceRoot, reposConfigHash);

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
  logger.info(`Dry run: ${String(wouldSync)} would sync, ${String(wouldSkip)} would skip`);

  return { success: true };
}

export default async function syncExecutor(
  options: SyncExecutorOptions,
  context: ExecutorContext,
): Promise<{ success: boolean }> {
  const { config, entries } = resolvePluginConfig(context.root);
  const strategy = options.strategy;
  const verbose = options.verbose ?? false;

  if (options.dryRun) {
    return executeDryRun(entries, context.root, strategy);
  }

  const reposConfigHash = hashObject(config.repos);

  const results = await Promise.allSettled(
    entries.map((entry) => syncRepo(entry, context.root, strategy, verbose, reposConfigHash)),
  );

  let synced = 0;
  let warned = 0;
  let failed = 0;
  const tableRows: ColumnDef[][] = [];

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    const entry = entries[i];

    if (!result || !entry) {
      continue;
    }

    if (result.status === 'fulfilled') {
      if (result.value.installFailed) {
        warned++;
        tableRows.push([
          { value: entry.alias },
          { value: result.value.action },
          { value: '[WARN: install failed]' },
        ]);
      } else {
        synced++;
        tableRows.push([
          { value: entry.alias },
          { value: result.value.action },
          { value: '[OK]' },
        ]);
      }
    } else {
      failed++;
      const reason: unknown = result.reason;
      const reasonMessage = reason instanceof Error
        ? reason.message
        : String(reason);
      logger.error(`Failed to sync ${entry.alias}: ${reasonMessage}`);
      tableRows.push([
        { value: entry.alias },
        { value: strategy ?? 'pull' },
        { value: `[ERROR] ${reasonMessage}` },
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
    parts.push(`${String(synced)} synced`);
  }

  if (warned > 0) {
    parts.push(`${String(warned)} synced with warning`);
  }

  if (failed > 0) {
    parts.push(`${String(failed)} failed`);
  }

  logger.info(`Summary: ${parts.join(', ')}`);

  return { success: failed === 0 };
}
