import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { TargetConfiguration } from '@nx/devkit';
import type { ExternalGraphJson, TransformedNode } from './types';
import { toProxyHashEnvKey } from './proxy-hash.js';

/**
 * Normalize all path separators to forward slashes.
 */
function normalizePath(p: string): string {
  return p.replace(/\\/g, '/');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRecordOfRecords(
  value: unknown,
): value is Record<string, Record<string, unknown>> {
  if (!isRecord(value)) {
    return false;
  }

  return Object.values(value).every((v) => isRecord(v));
}

/**
 * Rewrite dependsOn entries from an external repo's resolved target config
 * for the host context. String entries (caret and bare target refs) pass
 * through unchanged. Object entries with a `projects` array have project
 * names namespaced with the repo alias; entries starting with `"tag:"` are
 * tag selectors and pass through unchanged. Object entries with string
 * `projects` values (`"self"`, `"dependencies"`) pass through unchanged.
 *
 * When `rawDependsOn` is not an array (absent or invalid), returns `[]`
 * so the proxy target has an explicit empty value that blocks the host's
 * `targetDefaults` from merging in.
 */
function rewriteDependsOn(
  rawDependsOn: unknown,
  repoAlias: string,
): NonNullable<TargetConfiguration['dependsOn']> {
  if (!Array.isArray(rawDependsOn)) {
    return [];
  }

  const result: NonNullable<TargetConfiguration['dependsOn']> = [];
  const entries: unknown[] = rawDependsOn;

  for (const entry of entries) {
    if (typeof entry === 'string') {
      result.push(entry);
      continue;
    }

    if (isRecord(entry) && typeof entry['target'] === 'string') {
      const dep: {
        target: string;
        projects?: string | string[];
        params?: 'ignore' | 'forward';
        dependencies?: boolean;
      } = {
        target: entry['target'],
      };

      if (Array.isArray(entry['projects'])) {
        const projects: unknown[] = entry['projects'];
        dep.projects = projects
          .filter((p): p is string => typeof p === 'string')
          .map((p) => (p.startsWith('tag:') ? p : `${repoAlias}/${p}`));
      } else if (typeof entry['projects'] === 'string') {
        dep.projects = entry['projects'];
      }

      if (entry['params'] === 'ignore' || entry['params'] === 'forward') {
        dep.params = entry['params'];
      }

      if (typeof entry['dependencies'] === 'boolean') {
        dep.dependencies = entry['dependencies'];
      }

      result.push(dep);
      continue;
    }
    // Unknown shapes silently dropped
  }

  return result;
}

/**
 * Create a proxy target configuration from raw (unknown) target data.
 * Safely extracts configurations, parallelism, metadata, and dependsOn
 * from the unvalidated target config (typed as z.unknown() in the Zod
 * schema).
 *
 * dependsOn is preserved from the external repo's resolved config (which
 * already has targetDefaults baked in). Setting an explicit value blocks
 * host targetDefaults from merging. Targets without dependsOn get an
 * explicit empty array.
 */
function createProxyTarget(
  repoAlias: string,
  originalProject: string,
  targetName: string,
  rawTargetConfig: unknown,
): TargetConfiguration {
  const config = isRecord(rawTargetConfig) ? rawTargetConfig : {};
  const envKey = toProxyHashEnvKey(repoAlias);

  return {
    executor: '@op-nx/polyrepo:run',
    options: { repoAlias, originalProject, targetName },
    inputs: [{ env: envKey }],
    cache: true,
    dependsOn: rewriteDependsOn(config['dependsOn'], repoAlias),
    configurations: isRecordOfRecords(config['configurations'])
      ? config['configurations']
      : undefined,
    parallelism:
      typeof config['parallelism'] === 'boolean'
        ? config['parallelism']
        : undefined,
    metadata: isRecord(config['metadata']) ? config['metadata'] : undefined,
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
  workspaceRoot: string,
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

    // Extract package name from typed metadata
    const packageName = node.data.metadata?.js?.packageName;

    // Read dependency lists from package.json on disk
    // Use original node.data.root (not rewritten hostRoot) to avoid double-path
    const repoBasePath = join(workspaceRoot, '.repos', repoAlias);
    const pkgJsonPath = join(repoBasePath, node.data.root, 'package.json');
    let nodeDependencies: string[] | undefined;
    let nodeDevDependencies: string[] | undefined;
    let nodePeerDependencies: string[] | undefined;

    try {
      const raw = JSON.parse(readFileSync(pkgJsonPath, 'utf-8') as string);

      if (raw.dependencies && typeof raw.dependencies === 'object') {
        nodeDependencies = Object.keys(raw.dependencies);
      }

      if (raw.devDependencies && typeof raw.devDependencies === 'object') {
        nodeDevDependencies = Object.keys(raw.devDependencies);
      }

      if (raw.peerDependencies && typeof raw.peerDependencies === 'object') {
        nodePeerDependencies = Object.keys(raw.peerDependencies);
      }
    } catch {
      // No package.json or parse error -- silent skip
    }

    // Rewrite targets
    const proxyTargets: Record<string, TargetConfiguration> = {};

    for (const [targetName, targetConfig] of Object.entries(
      node.data.targets ?? {},
    )) {
      proxyTargets[targetName] = createProxyTarget(
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
      packageName: typeof packageName === 'string' ? packageName : undefined,
      dependencies: nodeDependencies,
      devDependencies: nodeDevDependencies,
      peerDependencies: nodePeerDependencies,
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
