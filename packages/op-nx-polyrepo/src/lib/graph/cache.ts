import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { hashArray, readJsonFile, writeJsonFile, logger } from '@nx/devkit';
import { getHeadSha, getDirtyFiles } from '../git/detect';
import { normalizeRepos } from '../config/schema';
import { extractGraphFromRepo } from './extract';
import { transformGraphForRepo } from './transform';
import type { PolyrepoConfig } from '../config/schema';
import type { TransformedNode, PolyrepoGraphReport } from './types';

/**
 * Per-repo graph data stored in both in-memory and disk caches.
 */
type RepoGraphData = {
  nodes: Record<string, TransformedNode>;
  dependencies: Array<{ source: string; target: string; type: string }>;
};

/**
 * Module-level state shared between createNodesV2 and createDependencies.
 * Under the Nx daemon, the plugin worker process persists, so these
 * survive across Nx commands within the same daemon session.
 */
const perRepoCache: Map<string, { hash: string; report: RepoGraphData }> =
  new Map();
let globalHash: string | undefined;

/**
 * Per-repo extraction failure tracking for exponential backoff.
 */
interface FailureState {
  lastAttemptTime: number;
  attemptCount: number;
  lastHash: string;
}

const failureStates: Map<string, FailureState> = new Map();

let oldCacheCleaned = false;

export const CACHE_FILENAME = '.polyrepo-graph-cache.json';

/**
 * Returns the per-repo cache file path at `.repos/<alias>/.polyrepo-graph-cache.json`.
 */
function getPerRepoCachePath(workspaceRoot: string, alias: string): string {
  return join(workspaceRoot, '.repos', alias, CACHE_FILENAME);
}

/**
 * Returns the old monolithic cache file path at `.repos/.polyrepo-graph-cache.json`.
 */
function getOldCachePath(workspaceRoot: string): string {
  return join(workspaceRoot, '.repos', CACHE_FILENAME);
}

/**
 * Read per-repo cache from disk. Returns undefined if file missing or corrupt.
 */
function tryReadPerRepoCache(
  workspaceRoot: string,
  alias: string,
): { hash: string; report: RepoGraphData } | undefined {
  try {
    return readJsonFile<{ hash: string; report: RepoGraphData }>(
      getPerRepoCachePath(workspaceRoot, alias),
    );
  } catch {
    return undefined;
  }
}

/**
 * Write per-repo cache to disk. Non-fatal on failure.
 * Exported for the sync executor to pre-cache after install.
 */
export function writePerRepoCache(
  workspaceRoot: string,
  alias: string,
  hash: string,
  report: RepoGraphData,
): void {
  try {
    writeJsonFile(getPerRepoCachePath(workspaceRoot, alias), { hash, report });
  } catch {
    // Non-fatal -- in-memory cache is still valid
  }
}

/**
 * Compute a per-repo hash from the repos config hash, alias, HEAD SHA, and dirty files.
 * Exported for the sync executor to pre-cache after install.
 */
export async function computeRepoHash(
  reposConfigHash: string,
  alias: string,
  repoPath: string,
): Promise<string> {
  const headSha = await getHeadSha(repoPath);
  const dirtyFiles = await getDirtyFiles(repoPath);

  return hashArray([reposConfigHash, alias, headSha, dirtyFiles]);
}

/**
 * Compute a global hash that combines all per-repo hashes.
 * When unchanged, the global gate returns instantly from in-memory cache.
 */
async function computeGlobalHash(
  config: PolyrepoConfig,
  workspaceRoot: string,
  reposConfigHash: string,
): Promise<{
  globalHash: string;
  repoHashes: Map<string, { repoPath: string; hash: string }>;
}> {
  const entries = normalizeRepos(config);
  const parts: string[] = [reposConfigHash];
  const repoHashes = new Map<string, { repoPath: string; hash: string }>();

  for (const entry of entries) {
    const repoPath =
      entry.type === 'remote'
        ? join(workspaceRoot, '.repos', entry.alias)
        : entry.path;

    if (!existsSync(join(repoPath, '.git'))) {
      continue;
    }

    const repoHash = await computeRepoHash(
      reposConfigHash,
      entry.alias,
      repoPath,
    );

    parts.push(repoHash);
    repoHashes.set(entry.alias, { repoPath, hash: repoHash });
  }

  return { globalHash: hashArray(parts), repoHashes };
}

/**
 * Check whether extraction should be skipped due to exponential backoff.
 * Returns true if the repo is within its cooldown period and hash hasn't changed.
 */
function shouldSkipExtraction(alias: string, currentHash: string): boolean {
  const state = failureStates.get(alias);

  if (!state) {
    return false;
  }

  // Hash changed = user made changes = reset backoff
  if (state.lastHash !== currentHash) {
    failureStates.delete(alias);

    return false;
  }

  // Exponential backoff: 2s, 4s, 8s, 16s, 30s cap
  const backoffMs = Math.min(
    2000 * Math.pow(2, state.attemptCount - 1),
    30000,
  );
  const elapsed = Date.now() - state.lastAttemptTime;

  return elapsed < backoffMs;
}

/**
 * Record an extraction failure for exponential backoff tracking.
 */
function recordFailure(alias: string, currentHash: string): void {
  const existing = failureStates.get(alias);
  const attemptCount = (existing?.attemptCount ?? 0) + 1;

  failureStates.set(alias, {
    lastAttemptTime: Date.now(),
    attemptCount,
    lastHash: currentHash,
  });
}

/**
 * Log an actionable warning with 4 troubleshooting steps when extraction fails.
 */
function logExtractionFailure(alias: string, error: unknown): void {
  const msg = error instanceof Error ? error.message : String(error);

  logger.warn(`Graph extraction failed for ${alias}: ${msg}`);
  logger.warn('Troubleshooting steps:');
  logger.warn('  1. Run: nx polyrepo-sync');
  logger.warn('  2. Run: NX_DAEMON=false nx graph');
  logger.warn(`  3. Check: .repos/${alias}/ (nx.json, node_modules)`);
  logger.warn('  4. Run: NX_PLUGIN_NO_TIMEOUTS=true nx graph');
}

/**
 * Delete the old monolithic cache file if it exists (one-time cleanup).
 */
function cleanupOldCache(workspaceRoot: string): void {
  if (oldCacheCleaned) {
    return;
  }

  oldCacheCleaned = true;

  const oldPath = getOldCachePath(workspaceRoot);

  if (existsSync(oldPath)) {
    try {
      unlinkSync(oldPath);
    } catch {
      // Non-fatal -- old file may already be gone
    }
  }
}

/**
 * Assemble a PolyrepoGraphReport from the per-repo cache Map.
 */
function assembleReport(
  cache: Map<string, { hash: string; report: RepoGraphData }>,
): PolyrepoGraphReport {
  const report: PolyrepoGraphReport = { repos: {} };

  for (const [alias, entry] of cache) {
    report.repos[alias] = entry.report;
  }

  return report;
}

/**
 * Populate the module-level graph report. Uses three-layer cache invalidation:
 *
 * 1. **Global gate:** Combined hash of all per-repo hashes.
 *    If unchanged, returns assembled report from in-memory cache instantly.
 * 2. **Per-repo disk cache:** On per-repo miss, reads from
 *    `.repos/<alias>/.polyrepo-graph-cache.json`.
 * 3. **Per-repo extraction:** Extracts graph JSON from the repo (expensive).
 *
 * When a repo's hash changes, only that repo re-extracts. Unchanged repos
 * return from in-memory cache. Extraction failures are isolated per-repo
 * with exponential backoff.
 */
export async function populateGraphReport(
  config: PolyrepoConfig,
  workspaceRoot: string,
  reposConfigHash: string,
): Promise<PolyrepoGraphReport> {
  // One-time cleanup of old monolithic cache
  cleanupOldCache(workspaceRoot);

  // Compute global hash from all per-repo hashes
  const { globalHash: newGlobalHash, repoHashes } = await computeGlobalHash(
    config,
    workspaceRoot,
    reposConfigHash,
  );

  // Layer 0: Global gate -- nothing changed across all repos AND
  // every expected repo is present in the in-memory cache. If a repo
  // previously failed extraction, it won't be in perRepoCache, so the
  // gate misses and we retry that repo (respecting backoff).
  if (newGlobalHash === globalHash) {
    let allCached = true;

    for (const alias of repoHashes.keys()) {
      if (!perRepoCache.has(alias)) {
        allCached = false;
        break;
      }
    }

    if (allCached) {
      return assembleReport(perRepoCache);
    }
  }

  // Something changed -- check per-repo
  const report: PolyrepoGraphReport = { repos: {} };

  for (const [alias, { repoPath, hash: repoHash }] of repoHashes) {
    // Layer 1: Per-repo in-memory cache
    const cached = perRepoCache.get(alias);

    if (cached && cached.hash === repoHash) {
      report.repos[alias] = cached.report;
      continue;
    }

    // Layer 2: Per-repo disk cache
    const diskCache = tryReadPerRepoCache(workspaceRoot, alias);

    if (diskCache && diskCache.hash === repoHash) {
      perRepoCache.set(alias, diskCache);
      report.repos[alias] = diskCache.report;
      continue;
    }

    // Layer 3: Extract (expensive)
    // Check backoff first
    if (shouldSkipExtraction(alias, repoHash)) {
      logger.warn(
        `Skipping graph extraction for ${alias} (backoff after previous failure)`,
      );
      continue;
    }

    try {
      const rawGraph = await extractGraphFromRepo(repoPath);
      const transformed = transformGraphForRepo(
        alias,
        rawGraph,
        workspaceRoot,
      );

      perRepoCache.set(alias, { hash: repoHash, report: transformed });
      writePerRepoCache(workspaceRoot, alias, repoHash, transformed);
      report.repos[alias] = transformed;
    } catch (error) {
      recordFailure(alias, repoHash);
      logExtractionFailure(alias, error);
      // Continue without this repo -- other repos unaffected
    }
  }

  // Update global hash
  globalHash = newGlobalHash;

  return report;
}
