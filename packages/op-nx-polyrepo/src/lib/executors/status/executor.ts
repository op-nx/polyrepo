import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { logger, readJsonFile } from '@nx/devkit';
import type { ExecutorContext, NxJsonConfiguration } from '@nx/devkit';
import { validateConfig } from '../../config/validate';
import { normalizeRepos, type NormalizedRepoEntry } from '../../config/schema';
import {
  detectRepoState,
  getCurrentBranch,
  getCurrentRef,
  getWorkingTreeState,
  getAheadBehind,
} from '../../git/detect';
import type { WorkingTreeState, AheadBehind } from '../../git/detect';
import { gitFetch } from '../../git/commands';
import { formatAlignedTable, type ColumnDef } from '../../format/table';
import type { PolyrepoGraphReport } from '../../graph/types';

// Status executor takes no options
export type StatusExecutorOptions = Record<string, never>;

const TAG_PATTERN = /^v?\d+\.\d+/;

function isTagRef(ref: string | undefined): boolean {
  if (!ref) {
    return false;
  }

  return TAG_PATTERN.test(ref);
}

function getRepoPath(
  entry: NormalizedRepoEntry,
  workspaceRoot: string,
): string {
  if (entry.type === 'remote') {
    return join(workspaceRoot, '.repos', entry.alias);
  }

  return entry.path;
}

interface GraphCacheFile {
  hash: string;
  report: PolyrepoGraphReport;
}

function getProjectCount(
  workspaceRoot: string,
  alias: string,
): number | null {
  try {
    const cachePath = join(workspaceRoot, '.repos', '.polyrepo-graph-cache.json');
    const cache = readJsonFile<GraphCacheFile>(cachePath);
    const repoReport = cache.report?.repos?.[alias];

    if (!repoReport) {
      return null;
    }

    return Object.keys(repoReport.nodes).length;
  } catch {
    return null;
  }
}

function formatDirtySummary(state: WorkingTreeState): string {
  const parts: string[] = [];

  if (state.modified > 0) {
    parts.push(`${state.modified}M`);
  }

  if (state.staged > 0) {
    parts.push(`${state.staged}A`);
  }

  if (state.deleted > 0) {
    parts.push(`${state.deleted}D`);
  }

  if (state.untracked > 0) {
    parts.push(`${state.untracked}??`);
  }

  if (state.conflicts > 0) {
    parts.push(`${state.conflicts}C`);
  }

  return parts.length > 0 ? parts.join(' ') : 'clean';
}

interface RepoRowData {
  alias: string;
  branchDisplay: string;
  aheadBehind: string;
  rawAheadBehind: AheadBehind | null;
  dirtySummary: string;
  projectCount: string;
  warnings: string;
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

  // Determine repo states
  const syncedEntries: Array<{
    entry: NormalizedRepoEntry;
    repoPath: string;
  }> = [];
  const unsyncedEntries: NormalizedRepoEntry[] = [];

  for (const entry of entries) {
    const state = detectRepoState(entry.alias, entry, context.root);
    const repoPath = getRepoPath(entry, context.root);

    if (state === 'not-synced') {
      unsyncedEntries.push(entry);
    } else {
      syncedEntries.push({ entry, repoPath });
    }
  }

  // Auto-fetch in parallel for synced repos
  const fetchResults = await Promise.allSettled(
    syncedEntries.map(({ repoPath }) => gitFetch(repoPath)),
  );

  for (let i = 0; i < fetchResults.length; i++) {
    const result = fetchResults[i];

    if (result.status === 'rejected') {
      logger.warn(
        `Failed to fetch ${syncedEntries[i].entry.alias}: ${result.reason instanceof Error ? result.reason.message : result.reason}`,
      );
    }
  }

  // Gather state for synced repos in parallel
  const rowData: RepoRowData[] = [];

  const syncedResults = await Promise.allSettled(
    syncedEntries.map(async ({ entry, repoPath }) => {
      const [branch, ref, workingTree] = await Promise.all([
        getCurrentBranch(repoPath),
        getCurrentRef(repoPath),
        getWorkingTreeState(repoPath),
      ]);

      // Determine if tag-pinned
      const isDetachedHead = branch === null;
      const isTag = isTagRef(ref);
      const isTagPinned = isDetachedHead && isTag;

      // Only get ahead/behind for branch-tracked repos (not tag-pinned, not detached)
      let aheadBehind: AheadBehind | null = null;

      if (!isTagPinned && !isDetachedHead) {
        aheadBehind = await getAheadBehind(repoPath);
      }

      const projectCount = getProjectCount(context.root, entry.alias);

      // Build branch display
      let branchDisplay: string;

      if (isTagPinned) {
        branchDisplay = ref;
      } else if (isDetachedHead) {
        branchDisplay = '(detached)';
      } else {
        branchDisplay = branch;
      }

      // Check for drift
      const configuredRef = entry.type === 'remote' ? entry.ref : undefined;
      const hasDrift = configuredRef !== undefined && branchDisplay !== configuredRef;

      if (hasDrift) {
        branchDisplay = `${branchDisplay} (expected ${configuredRef})`;
      }

      // Build ahead/behind display
      let aheadBehindDisplay = '';

      if (aheadBehind !== null) {
        aheadBehindDisplay = `+${aheadBehind.ahead} -${aheadBehind.behind}`;
      }

      // Build dirty summary — show ahead/behind instead of "clean" when relevant
      let dirtySummary = formatDirtySummary(workingTree);

      if (dirtySummary === 'clean' && aheadBehind !== null) {
        const statusParts: string[] = [];

        if (aheadBehind.behind > 0) {
          statusParts.push('behind');
        }

        if (aheadBehind.ahead > 0) {
          statusParts.push('ahead');
        }

        if (statusParts.length > 0) {
          dirtySummary = statusParts.join(', ');
        }
      }

      // Build project count display
      const projectCountDisplay = projectCount !== null
        ? `${projectCount} projects`
        : '? projects';

      // Build warnings
      const warnings: string[] = [];
      const totalDirty =
        workingTree.modified +
        workingTree.staged +
        workingTree.deleted +
        workingTree.untracked;

      if (totalDirty > 0) {
        warnings.push('[WARN: dirty, sync may fail]');
      }

      if (isDetachedHead && !isTagPinned) {
        warnings.push('[WARN: detached HEAD]');
      }

      if (isTagPinned) {
        warnings.push('[WARN: tag-pinned]');
      }

      if (workingTree.conflicts > 0) {
        warnings.push('[WARN: merge conflicts]');
      }

      if (hasDrift) {
        warnings.push('[WARN: drift]');
      }

      return {
        alias: entry.alias,
        branchDisplay,
        aheadBehind: aheadBehindDisplay,
        rawAheadBehind: aheadBehind,
        dirtySummary,
        projectCount: projectCountDisplay,
        warnings: warnings.join(' '),
      } satisfies RepoRowData;
    }),
  );

  for (const result of syncedResults) {
    if (result.status === 'fulfilled') {
      rowData.push(result.value);
    }
  }

  // Add unsynced repos
  for (const entry of unsyncedEntries) {
    const projectCountDisplay = '? projects';
    rowData.push({
      alias: entry.alias,
      branchDisplay: '[not synced]',
      aheadBehind: '',
      rawAheadBehind: null,
      dirtySummary: '',
      projectCount: projectCountDisplay,
      warnings: '',
    });
  }

  // Build aligned table rows
  const tableRows: ColumnDef[][] = rowData.map((row) => [
    { value: row.alias, align: 'left' as const },
    { value: row.branchDisplay, align: 'left' as const },
    { value: row.aheadBehind, align: 'left' as const },
    { value: row.dirtySummary, align: 'left' as const },
    { value: row.projectCount, align: 'right' as const },
    { value: row.warnings, align: 'left' as const },
  ]);

  const formattedLines = formatAlignedTable(tableRows);

  for (const line of formattedLines) {
    logger.info(line);
  }

  // Summary line
  const totalConfigured = entries.length;
  const totalSynced = syncedEntries.length;
  const totalNotSynced = unsyncedEntries.length;

  const reposBehind = rowData.filter(
    (r) => r.rawAheadBehind !== null && r.rawAheadBehind.behind > 0,
  ).length;
  const reposAhead = rowData.filter(
    (r) => r.rawAheadBehind !== null && r.rawAheadBehind.ahead > 0,
  ).length;

  const summaryParts = [
    `${totalConfigured} configured`,
    `${totalSynced} synced`,
    `${totalNotSynced} not synced`,
  ];

  if (reposBehind > 0) {
    summaryParts.push(`${reposBehind} behind`);
  }

  if (reposAhead > 0) {
    summaryParts.push(`${reposAhead} ahead`);
  }

  logger.info('');
  logger.info(summaryParts.join(', '));

  // Legend (always printed)
  logger.info('');
  logger.info('Legend:');
  logger.info('  M  = modified files');
  logger.info('  A  = staged/added files');
  logger.info('  D  = deleted files');
  logger.info('  ?? = untracked files');
  logger.info('  +N = commits ahead of remote');
  logger.info('  -N = commits behind remote');
  logger.info('  ?  = graph not yet extracted (run any nx command to trigger)');

  return { success: true };
}
