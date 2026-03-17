import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DependencyType } from '@nx/devkit';
import type { RawProjectGraphDependency, CreateDependenciesContext } from '@nx/devkit';
import type { PolyrepoConfig } from '../config/schema';
import type { PolyrepoGraphReport } from './types';

/**
 * Normalize all path separators to forward slashes.
 */
function normalizePath(p: string): string {
  return p.replace(/\\/g, '/');
}

/**
 * Type guard for plain objects (non-array, non-null).
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Extract string array keys from an object field inside a parsed package.json.
 * Returns undefined when the field is missing or not an object.
 */
function extractDepKeys(
  pkgJson: Record<string, unknown>,
  field: string,
): string[] | undefined {
  const val = pkgJson[field];

  if (!isRecord(val)) {
    return undefined;
  }

  return Object.keys(val);
}

/**
 * Sentinel string used as the repo identifier for host (workspace-local) projects.
 * Host projects have no alias prefix, so this distinguishes them in the cross-repo guard.
 */
const HOST_REPO_SENTINEL = '__host__';

/**
 * Extract the repo alias from a namespaced project name of the form `<alias>/<name>`.
 * Returns undefined for project names that do not contain a `/`.
 */
function extractRepoAlias(namespacedName: string): string | undefined {
  const slashIndex = namespacedName.indexOf('/');

  if (slashIndex === -1) {
    return undefined;
  }

  return namespacedName.slice(0, slashIndex);
}

/**
 * Detect cross-repo dependency edges from `dependencies`, `devDependencies`,
 * and `peerDependencies` declared in each project's package.json.
 *
 * Algorithm:
 * 1. Build a packageName → projectName lookup map from:
 *    a. TransformedNode.packageName fields for all external nodes (inserted first)
 *    b. context.projects metadata.js.packageName for host projects (second, never overwrites)
 * 2. Build a projectName → repoAlias reverse map for the cross-repo guard.
 * 3. Scan every project's dep lists. For each dep matching the lookup map,
 *    check cross-repo guard. Emit a static edge if source and target are in
 *    different repos. Deduplicate by "source::target" key.
 *
 * This function has no top-level side effects and does not mutate its inputs.
 */
export function detectCrossRepoDependencies(
  report: PolyrepoGraphReport,
  _config: PolyrepoConfig,
  context: CreateDependenciesContext,
): RawProjectGraphDependency[] {
  // -------------------------------------------------------------------------
  // Step 1: Build the packageName → projectName lookup map
  // -------------------------------------------------------------------------

  const pkgNameToProject = new Map<string, string>();

  // 1a. External nodes — inserted first, take precedence over host entries
  for (const repoData of Object.values(report.repos)) {
    for (const node of Object.values(repoData.nodes)) {
      const { packageName } = node;

      if (typeof packageName === 'string' && !pkgNameToProject.has(packageName)) {
        pkgNameToProject.set(packageName, node.name);
      }
    }
  }

  // 1b. Host projects — only inserted if key is not already present
  for (const [projectName, projectConfig] of Object.entries(context.projects)) {
    const meta = projectConfig.metadata;

    if (!isRecord(meta)) {
      continue;
    }

    const js = meta['js'];

    if (!isRecord(js)) {
      continue;
    }

    const pkgName = js['packageName'];

    if (typeof pkgName !== 'string') {
      continue;
    }

    if (!pkgNameToProject.has(pkgName)) {
      pkgNameToProject.set(pkgName, projectName);
    }
  }

  // -------------------------------------------------------------------------
  // Step 2: Build projectName → repoAlias for cross-repo guard
  // -------------------------------------------------------------------------

  const projectToRepo = new Map<string, string>();

  for (const repoData of Object.values(report.repos)) {
    for (const node of Object.values(repoData.nodes)) {
      const alias = extractRepoAlias(node.name);

      if (alias !== undefined) {
        projectToRepo.set(node.name, alias);
      }
    }
  }

  for (const projectName of Object.keys(context.projects)) {
    projectToRepo.set(projectName, HOST_REPO_SENTINEL);
  }

  // -------------------------------------------------------------------------
  // Step 3: Emit cross-repo edges
  // -------------------------------------------------------------------------

  const emitted = new Set<string>();
  const edges: RawProjectGraphDependency[] = [];

  function maybeEmitEdge(
    sourceName: string,
    sourceFile: string,
    depName: string,
  ): void {
    const targetName = pkgNameToProject.get(depName);

    if (targetName === undefined) {
      return;
    }

    const sourceRepo = projectToRepo.get(sourceName);
    const targetRepo = projectToRepo.get(targetName);

    if (sourceRepo === undefined || targetRepo === undefined) {
      return;
    }

    // Cross-repo guard: skip intra-repo edges
    if (sourceRepo === targetRepo) {
      return;
    }

    const key = `${sourceName}::${targetName}`;

    if (emitted.has(key)) {
      return;
    }

    emitted.add(key);
    edges.push({
      source: sourceName,
      target: targetName,
      sourceFile,
      type: DependencyType.static,
    });
  }

  // 3a. Scan external nodes — dep lists are already on TransformedNode
  for (const repoData of Object.values(report.repos)) {
    for (const node of Object.values(repoData.nodes)) {
      const sourceFile = normalizePath(`${node.root}/package.json`);
      const allDeps = [
        ...(node.dependencies ?? []),
        ...(node.devDependencies ?? []),
        ...(node.peerDependencies ?? []),
      ];

      for (const depName of allDeps) {
        maybeEmitEdge(node.name, sourceFile, depName);
      }
    }
  }

  // 3b. Scan host projects — read package.json from disk (silent skip on error)
  for (const [projectName, projectConfig] of Object.entries(context.projects)) {
    const pkgJsonPath = join(
      context.workspaceRoot,
      projectConfig.root,
      'package.json',
    );
    const sourceFile = normalizePath(
      join(projectConfig.root, 'package.json'),
    );

    let pkgJson: Record<string, unknown>;

    try {
      const raw = JSON.parse(readFileSync(pkgJsonPath, 'utf-8') as string);

      if (!isRecord(raw)) {
        continue;
      }

      pkgJson = raw;
    } catch {
      continue;
    }

    const allDeps = [
      ...(extractDepKeys(pkgJson, 'dependencies') ?? []),
      ...(extractDepKeys(pkgJson, 'devDependencies') ?? []),
      ...(extractDepKeys(pkgJson, 'peerDependencies') ?? []),
    ];

    for (const depName of allDeps) {
      maybeEmitEdge(projectName, sourceFile, depName);
    }
  }

  return edges;
}
