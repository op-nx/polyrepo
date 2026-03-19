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

    // Hash only the repos config for cache invalidation. Other options
    // (implicitDependencies, negations) affect detection but not graph
    // extraction — changing them should not invalidate the extraction cache.
    const reposHash = hashObject(config.repos ?? {});

    // Populate graph report (lazy extraction with caching)
    let report: PolyrepoGraphReport | undefined;

    try {
      report = await populateGraphReport(
        config,
        context.workspaceRoot,
        reposHash,
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
    const reposHash = hashObject(config.repos ?? {});

    report = await populateGraphReport(
      config,
      context.workspaceRoot,
      reposHash,
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
