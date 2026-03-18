import type {
  CreateNodesV2,
  CreateNodesResult,
  CreateDependencies,
  ProjectType,
  RawProjectGraphDependency,
  ProjectConfiguration,
} from '@nx/devkit';
import { DependencyType, logger } from '@nx/devkit';
import { hashObject } from 'nx/src/devkit-internals';
import type { PolyrepoConfig } from './lib/config/schema';
import { populateGraphReport } from './lib/graph/cache';
import { detectCrossRepoDependencies } from './lib/graph/detect';
import type { PolyrepoGraphReport } from './lib/graph/types';
import {
  validateConfig,
  warnIfReposNotGitignored,
  warnUnsyncedRepos,
} from './lib/config/validate';

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

    await warnIfReposNotGitignored(context.workspaceRoot);
    warnUnsyncedRepos(config, context.workspaceRoot);

    // Compute options hash for cache invalidation
    const optionsHash = hashObject(options ?? {});

    // Populate graph report (lazy extraction with caching)
    let report: PolyrepoGraphReport | undefined;

    try {
      report = await populateGraphReport(
        config,
        context.workspaceRoot,
        optionsHash,
      );
    } catch (error) {
      logger.warn(
        `Failed to extract external project graphs: ${error instanceof Error ? error.message : String(error)}`,
      );
      logger.warn(
        'External projects will not be visible. Run "nx polyrepo-sync" and retry.',
      );
    }

    const results: Array<readonly [string, CreateNodesResult]> = [];

    for (const configFile of configFiles) {
      const projects: Record<string, Omit<ProjectConfiguration, 'root'>> = {
        '.': {
          targets: {
            'polyrepo-sync': {
              executor: '@op-nx/polyrepo:sync',
              options: {},
            },
            'polyrepo-status': {
              executor: '@op-nx/polyrepo:status',
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
    const optionsHash = hashObject(options ?? {});

    report = await populateGraphReport(
      config,
      context.workspaceRoot,
      optionsHash,
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

  // Cross-repo edges -- NOT wrapped in try/catch
  // OVRD-03 validation errors intentionally propagate to Nx
  const crossRepoDeps = detectCrossRepoDependencies(report, config, context);
  dependencies.push(...crossRepoDeps);

  return dependencies;
};
