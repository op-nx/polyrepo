import type { TargetConfiguration } from '@nx/devkit';
import type { ExternalGraphJson, TransformedNode } from './types';

/**
 * Normalize all path separators to forward slashes.
 */
function normalizePath(p: string): string {
  return p.replace(/\\/g, '/');
}

/**
 * Rewrite `dependsOn` entries: prefix explicit project references with
 * the repo alias while leaving caret syntax (`^build`) and plain
 * self-references (`build`) unchanged.
 */
function rewriteDependsOn(
  dependsOn: TargetConfiguration['dependsOn'],
  repoAlias: string,
): TargetConfiguration['dependsOn'] {
  if (!dependsOn || dependsOn.length === 0) {
    return undefined;
  }

  return dependsOn.map((entry) => {
    // String entries: caret syntax (^build) or self-references (build)
    if (typeof entry === 'string') {
      return entry;
    }

    // Object entry with explicit project list
    if (
      typeof entry === 'object' &&
      'projects' in entry &&
      Array.isArray(entry.projects)
    ) {
      return {
        ...entry,
        projects: entry.projects.map((p: string) => `${repoAlias}/${p}`),
      };
    }

    // Object entry without projects (relative reference) -- pass through
    return entry;
  });
}

/**
 * Rewrite a single target configuration to use the `@op-nx/polyrepo:run`
 * proxy executor. Inputs, outputs, and cache are intentionally omitted:
 * the child repo resolves its own named inputs and manages its own cache.
 * Copying them would fail because named inputs (e.g. "native") are defined
 * in the external repo's nx.json, not the host workspace's.
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
    cache: false,
    dependsOn: rewriteDependsOn(targetConfig.dependsOn, repoAlias),
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
