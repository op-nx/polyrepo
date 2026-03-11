import type { TargetConfiguration } from '@nx/devkit';
import type { ExternalGraphJson, TransformedNode } from './types';

/**
 * Normalize all path separators to forward slashes.
 */
function normalizePath(p: string): string {
  return p.replace(/\\/g, '/');
}

/**
 * Rewrite a single target configuration to use the `@op-nx/polyrepo:run`
 * proxy executor. Inputs, outputs, cache, and dependsOn are intentionally
 * omitted: the child repo resolves its own named inputs, manages its own
 * cache, and handles its own task dependency ordering. Copying dependsOn
 * would cause the host Nx to build a cascading task graph across all
 * external projects, triggering the native task hasher on projects whose
 * source files are not meaningful in the host context.
 */
function rewriteTarget(
  repoAlias: string,
  originalProject: string,
  targetName: string,
  targetConfig: TargetConfiguration,
): TargetConfiguration {
  return {
    executor: '@op-nx/polyrepo:run',
    options: { repoAlias, originalProject, targetName },
    inputs: [],
    cache: false,
    configurations: targetConfig.configurations,
    parallelism: targetConfig.parallelism,
    metadata: targetConfig.metadata,
  };
}

/**
 * Transform raw graph JSON from an external repo into namespaced nodes
 * and dependencies for the host workspace.
 *
 * Transformations applied:
 * - Project names prefixed with `repoAlias/`
 * - Roots rewritten to `.repos/<alias>/<original-root>`
 * - All targets rewritten to `@op-nx/polyrepo:run` proxy executor
 * - Auto-tags `polyrepo:external` and `polyrepo:<alias>` appended
 * - Dependency edges prefixed with repo alias
 * - All paths normalized to forward slashes
 */
export function transformGraphForRepo(
  repoAlias: string,
  rawGraph: ExternalGraphJson,
  _workspaceRoot: string,
): {
  nodes: Record<string, TransformedNode>;
  dependencies: Array<{ source: string; target: string; type: string }>;
} {
  const nodes: Record<string, TransformedNode> = {};
  const dependencies: Array<{
    source: string;
    target: string;
    type: string;
  }> = [];

  // Transform project nodes
  for (const [originalName, node] of Object.entries(rawGraph.graph.nodes)) {
    const namespacedName = `${repoAlias}/${originalName}`;
    const hostRoot = normalizePath(`.repos/${repoAlias}/${node.data.root}`);
    const hostSourceRoot = node.data.sourceRoot
      ? normalizePath(`.repos/${repoAlias}/${node.data.sourceRoot}`)
      : undefined;

    // Rewrite targets
    const proxyTargets: Record<string, TargetConfiguration> = {};

    for (const [targetName, targetConfig] of Object.entries(
      node.data.targets ?? {},
    )) {
      proxyTargets[targetName] = rewriteTarget(
        repoAlias,
        originalName,
        targetName,
        targetConfig,
      );
    }

    // Inject auto-tags
    const tags = [
      ...(node.data.tags ?? []),
      'polyrepo:external',
      `polyrepo:${repoAlias}`,
    ];

    nodes[namespacedName] = {
      name: namespacedName,
      root: hostRoot,
      projectType: node.data.projectType ?? node.type,
      sourceRoot: hostSourceRoot,
      targets: proxyTargets,
      tags,
      metadata: node.data.metadata,
    };
  }

  // Transform dependencies
  for (const [, deps] of Object.entries(rawGraph.graph.dependencies)) {
    for (const dep of deps) {
      dependencies.push({
        source: `${repoAlias}/${dep.source}`,
        target: `${repoAlias}/${dep.target}`,
        type: dep.type,
      });
    }
  }

  return { nodes, dependencies };
}
