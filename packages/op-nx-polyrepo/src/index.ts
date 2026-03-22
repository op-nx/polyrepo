import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  CreateNodesV2,
  CreateNodesResult,
  CreateDependencies,
  ProjectType,
  RawProjectGraphDependency,
  ProjectConfiguration,
} from '@nx/devkit';
import { DependencyType, hashArray, logger } from '@nx/devkit';
import { hashObject } from 'nx/src/devkit-internals';
import { type PreTasksExecution } from 'nx/src/project-graph/plugins/public-api';
import type { PolyrepoConfig } from './lib/config/schema';
import { normalizeRepos } from './lib/config/schema';
import { getHeadSha, getStatusPorcelain } from './lib/git/detect';
import { populateGraphReport } from './lib/graph/cache';
import { detectCrossRepoDependencies } from './lib/graph/detect';
import { toProxyHashEnvKey } from './lib/graph/proxy-hash';
import type { PolyrepoGraphReport } from './lib/graph/types';
import {
  validateConfig,
  warnIfReposNotGitignored,
  warnUnsyncedRepos,
} from './lib/config/validate';

const PROXY_EXECUTOR = '@op-nx/polyrepo:run';

const warnedAliases = new Set<string>();

function warnGitFailure(alias: string): void {
  if (warnedAliases.has(alias)) {
    return;
  }

  warnedAliases.add(alias);
  logger.warn(
    `polyrepo: git state check failed for '${alias}', proxy target cache bypassed. ` +
      `Hint: run 'nx polyrepo-sync' if repo is not yet cloned.`,
  );
}

/**
 * @internal Exposed for test cleanup only. Clears the module-level
 * deduplicated-warning tracker so tests start with a clean slate.
 */
export function _resetWarnedAliases(): void {
  warnedAliases.clear();
}

/**
 * Ensure nx.json has an empty targetDefaults entry keyed by our proxy
 * executor. Nx resolves targetDefaults by executor first, then by target
 * name. Without this entry, name-based defaults (e.g. `test.dependsOn`)
 * leak into every proxy target because Nx allows host targetDefaults to
 * override third-party plugin values. An empty executor-scoped entry
 * intercepts the lookup and returns nothing to merge, preserving the
 * dependsOn values our plugin sets on proxy targets.
 *
 * This writes to nx.json on disk as a one-time side effect. The daemon
 * detects the change and restarts, so the fix takes effect on the next
 * graph computation cycle.
 */
function ensureTargetDefaultsShield(
  workspaceRoot: string,
  targetDefaults: Record<string, unknown> | undefined,
): void {
  if (targetDefaults?.[PROXY_EXECUTOR] !== undefined) {
    return;
  }

  const nxJsonPath = join(workspaceRoot, 'nx.json');

  try {
    const raw = readFileSync(nxJsonPath, 'utf-8');
    const nxJson: Record<string, unknown> = JSON.parse(raw);

    const existingDefaults = nxJson['targetDefaults'];

    if (
      !existingDefaults ||
      typeof existingDefaults !== 'object' ||
      Array.isArray(existingDefaults)
    ) {
      nxJson['targetDefaults'] = { [PROXY_EXECUTOR]: {} };
    } else {
      const defaults: Record<string, unknown> = { ...existingDefaults };
      defaults[PROXY_EXECUTOR] = {};
      nxJson['targetDefaults'] = defaults;
    }

    writeFileSync(nxJsonPath, JSON.stringify(nxJson, null, 2) + '\n', 'utf-8');
    logger.info(
      `Added '${PROXY_EXECUTOR}' to targetDefaults in nx.json (shields proxy targets from host overrides)`,
    );
  } catch {
    logger.warn(
      `Could not add '${PROXY_EXECUTOR}' to targetDefaults in nx.json. ` +
        `Add it manually to prevent host targetDefaults from overriding external project targets.`,
    );
  }
}

function toProjectType(value: string | undefined): ProjectType | undefined {
  if (value === 'application' || value === 'library') {
    return value;
  }

  return undefined;
}

export const createNodesV2: CreateNodesV2<PolyrepoConfig> = [
  'nx.json',
  async (configFiles, options, context) => {
    const config = validateConfig(options);

    ensureTargetDefaultsShield(
      context.workspaceRoot,
      context.nxJsonConfiguration.targetDefaults,
    );

    await warnIfReposNotGitignored(context.workspaceRoot);
    warnUnsyncedRepos(config, context.workspaceRoot);

    // Hash only the repos config for cache invalidation. Other options
    // (implicitDependencies, negations) affect detection but not graph
    // extraction — changing them should not invalidate the extraction cache.
    const reposConfigHash = hashObject(config.repos ?? {});

    // Populate graph report (lazy extraction with caching)
    let report: PolyrepoGraphReport | undefined;

    try {
      report = await populateGraphReport(
        config,
        context.workspaceRoot,
        reposConfigHash,
      );
    } catch (error) {
      logger.warn(
        `Failed to extract external project graphs: ${error instanceof Error ? error.message : String(error)}`,
      );
      logger.warn(
        'External projects will not be visible. Run "nx polyrepo-sync" and retry.',
      );
    }

    // Build namedInputs override for external projects: every workspace-level
    // named input (plus the built-in "default") is overridden to []. This
    // prevents the native task hasher from generating ProjectFileSet hash
    // instructions when it walks dependency edges to external projects.
    // Without this, inputs like ^production expand file-based patterns
    // (e.g., !{projectRoot}/**/*.spec.ts) against external projects whose
    // files are absent from the fileMap (.repos/ is gitignored).
    const externalNamedInputs: Record<string, never[]> = { default: [] };

    for (const key of Object.keys(
      context.nxJsonConfiguration.namedInputs ?? {},
    )) {
      externalNamedInputs[key] = [];
    }

    const results: Array<readonly [string, CreateNodesResult]> = [];

    for (const configFile of configFiles) {
      const projects: Record<string, Omit<ProjectConfiguration, 'root'>> = {
        '.': {
          targets: {
            'polyrepo-sync': {
              executor: '@op-nx/polyrepo:sync',
              cache: false,
              options: {},
            },
            'polyrepo-status': {
              executor: '@op-nx/polyrepo:status',
              cache: false,
              options: {},
            },
          },
        },
      };

      if (report) {
        for (const [, repoReport] of Object.entries(report.repos)) {
          for (const [, node] of Object.entries(repoReport.nodes)) {
            projects[node.root] = {
              name: node.name,
              projectType: toProjectType(node.projectType),
              sourceRoot: node.sourceRoot,
              targets: node.targets,
              tags: node.tags,
              metadata: node.metadata,
              namedInputs: externalNamedInputs,
            };
          }
        }
      }

      results.push([configFile, { projects }]);
    }

    return results;
  },
];

export const createDependencies: CreateDependencies<PolyrepoConfig> = async (
  options,
  context,
) => {
  const dependencies: RawProjectGraphDependency[] = [];

  // Defensive: re-populate in case createNodesV2 hasn't run yet
  let report: PolyrepoGraphReport | undefined;
  let config: PolyrepoConfig;

  try {
    config = validateConfig(options);
    const reposConfigHash = hashObject(config.repos ?? {});

    report = await populateGraphReport(
      config,
      context.workspaceRoot,
      reposConfigHash,
    );
  } catch {
    // If extraction fails, return no dependencies (degraded mode)
    return dependencies;
  }

  // Intra-repo edges (existing behavior)
  for (const [, repoReport] of Object.entries(report.repos)) {
    for (const dep of repoReport.dependencies) {
      // Only add if both source and target exist in the current project graph
      if (context.projects[dep.source] && context.projects[dep.target]) {
        dependencies.push({
          source: dep.source,
          target: dep.target,
          type: DependencyType.implicit,
        });
      }
    }
  }

  // Cross-repo edges (DETECT-06) -- auto-detected from package.json deps,
  // tsconfig path aliases, and user-configured overrides/negations.
  //
  // NOTE: DETECT-07 (nx affected cross-repo) is deferred to a future milestone.
  // Nx's calculateFileChanges() filters files through .gitignore before project
  // mapping -- .repos/ is gitignored, so nx affected --base/--head is blind to
  // synced repo changes. The edge traversal itself is correct once a starting
  // project is identified. Future solution: a polyrepo-affected executor that
  // maps git diffs in .repos/<alias> to namespaced project names.
  // See: .planning/phases/10-integration-and-end-to-end-validation/research-detect-07.md
  //
  // NOT wrapped in try/catch -- OVRD-03 validation errors intentionally
  // propagate to Nx so users see a clear error message.
  const crossRepoDeps = detectCrossRepoDependencies(report, config, context);

  // Cross-repo edges target project nodes directly. The namedInputs
  // override on external projects (set in createNodesV2) prevents the
  // native task hasher from crashing on missing fileMap entries.
  //
  // Known limitation: cross-repo edges cause ^build task cascading from
  // host projects into external repo builds. Workaround: run vitest/eslint
  // directly instead of via `nx test`/`nx lint`. Future fix: Nx upstream
  // support for excluding edges from task graph traversal, or conditional
  // target stripping based on edge type.
  for (const dep of crossRepoDeps) {
    if (context.projects[dep.source] && context.projects[dep.target]) {
      dependencies.push(dep);
    }
  }

  return dependencies;
};

/**
 * Compute per-repo git state hashes and set `POLYREPO_HASH_<ALIAS>` env vars
 * before Nx task hashing. Nx reads these via `{ env: "..." }` inputs declared
 * on proxy targets, producing a cache key that changes whenever a synced repo's
 * HEAD or dirty state changes.
 *
 * Runs once per `nx run` invocation. Each repo is hashed independently -- a
 * failed git command for one repo does not prevent others from being hashed.
 * On failure, a random UUID is used (cache miss every invocation) and a
 * deduplicated warning is logged.
 */
export const preTasksExecution: PreTasksExecution<PolyrepoConfig> = async (
  options,
  context,
): Promise<void> => {
  if (!options?.repos) {
    return;
  }

  const entries = normalizeRepos(options);

  for (const entry of entries) {
    const repoPath =
      entry.type === 'remote'
        ? join(context.workspaceRoot, '.repos', entry.alias)
        : entry.path;
    const envKey = toProxyHashEnvKey(entry.alias);

    if (!existsSync(join(repoPath, '.git'))) {
      process.env[envKey] = randomUUID();
      warnGitFailure(entry.alias);

      continue;
    }

    try {
      const headSha = await getHeadSha(repoPath);
      const porcelain = await getStatusPorcelain(repoPath);
      const dirty = porcelain.length > 0;
      process.env[envKey] = hashArray([headSha, dirty ? 'dirty' : 'clean']);
    } catch {
      process.env[envKey] = randomUUID();
      warnGitFailure(entry.alias);
    }
  }
};
