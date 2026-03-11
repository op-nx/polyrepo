import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { hashArray, readJsonFile, writeJsonFile } from '@nx/devkit';
import { getHeadSha, getDirtyFiles } from '../git/detect';
import { normalizeRepos } from '../config/schema';
import { extractGraphFromRepo } from './extract';
import { transformGraphForRepo } from './transform';
import type { PolyrepoConfig } from '../config/schema';
import type { PolyrepoGraphReport } from './types';

/**
 * Module-level state shared between createNodesV2 and createDependencies.
 * Follows the @nx/gradle pattern of a single cached report per process.
 */
let graphReport: PolyrepoGraphReport | undefined;
let currentHash: string | undefined;

const CACHE_FILENAME = '.polyrepo-graph-cache.json';

interface CacheFile {
  hash: string;
  report: PolyrepoGraphReport;
}

/**
 * Store cache in `.repos/` rather than `.nx/workspace-data/`.
 * `nx reset` wipes `.nx/`, which forces a costly re-extraction
 * that exceeds the daemon's plugin worker timeout for large repos.
 * `.repos/` is already gitignored and survives resets.
 */
function getCachePath(workspaceRoot: string): string {
  return join(workspaceRoot, '.repos', CACHE_FILENAME);
}

/**
 * Compute an outer-layer hash from plugin options + each repo's git state.
 * Repos without a `.git` directory (unsynced) are skipped.
 */
async function computeOuterHash(
  config: PolyrepoConfig,
  workspaceRoot: string,
  optionsHash: string,
): Promise<string> {
  const entries = normalizeRepos(config);
  const parts: string[] = [optionsHash];

  for (const entry of entries) {
    const repoPath =
      entry.type === 'remote'
        ? join(workspaceRoot, '.repos', entry.alias)
        : entry.path;

    if (!existsSync(join(repoPath, '.git'))) {
      continue;
    }

    const headSha = await getHeadSha(repoPath);
    const dirtyFiles = await getDirtyFiles(repoPath);

    parts.push(entry.alias, headSha, dirtyFiles);
  }

  return hashArray(parts);
}

/**
 * Populate the module-level graph report. Uses two-layer cache invalidation:
 *
 * 1. **Outer gate:** Hash of plugin options + each repo's HEAD SHA + dirty files.
 *    If unchanged, returns in-memory cache instantly.
 * 2. **Disk cache:** On cold start, reads from `workspaceDataDirectory` and
 *    restores if the hash matches (avoids extraction after Nx daemon restart).
 *
 * When the hash changes, extracts graph JSON from each synced repo in parallel,
 * transforms nodes/deps, and persists the result.
 */
export async function populateGraphReport(
  config: PolyrepoConfig,
  workspaceRoot: string,
  pluginOptionsHash: string,
): Promise<PolyrepoGraphReport> {
  const hash = await computeOuterHash(config, workspaceRoot, pluginOptionsHash);

  // Layer 1: in-memory cache
  if (hash === currentHash && graphReport !== undefined) {
    return graphReport;
  }

  // Layer 2: disk cache (cold start)
  try {
    const cached = readJsonFile<CacheFile>(getCachePath(workspaceRoot));

    if (cached.hash === hash) {
      currentHash = hash;
      graphReport = cached.report;

      return graphReport;
    }
  } catch {
    // Cache file missing or corrupt -- continue to extraction
  }

  // Extract and transform
  const entries = normalizeRepos(config);
  const syncedEntries = entries.filter((entry) => {
    const repoPath =
      entry.type === 'remote'
        ? join(workspaceRoot, '.repos', entry.alias)
        : entry.path;

    return existsSync(join(repoPath, '.git'));
  });

  const results = await Promise.all(
    syncedEntries.map(async (entry) => {
      const repoPath =
        entry.type === 'remote'
          ? join(workspaceRoot, '.repos', entry.alias)
          : entry.path;
      const rawGraph = await extractGraphFromRepo(repoPath);
      const transformed = transformGraphForRepo(
        entry.alias,
        rawGraph,
        workspaceRoot,
      );

      return { alias: entry.alias, transformed };
    }),
  );

  const report: PolyrepoGraphReport = { repos: {} };

  for (const { alias, transformed } of results) {
    report.repos[alias] = transformed;
  }

  // Update module-level state
  currentHash = hash;
  graphReport = report;

  // Persist to disk (ensure .repos/ directory exists)
  try {
    const reposDir = join(workspaceRoot, '.repos');

    if (!existsSync(reposDir)) {
      mkdirSync(reposDir, { recursive: true });
    }

    writeJsonFile(getCachePath(workspaceRoot), { hash, report });
  } catch {
    // Non-fatal -- in-memory cache is still valid
  }

  return report;
}

/**
 * Return the current module-level graph report.
 *
 * Throws if `populateGraphReport` has not been called yet, which indicates
 * `createDependencies` ran before `createNodesV2`.
 */
export function getCurrentGraphReport(): PolyrepoGraphReport {
  if (graphReport === undefined) {
    throw new Error(
      'Expected cached polyrepo graph report. Ensure createNodesV2 ran first.',
    );
  }

  return graphReport;
}
