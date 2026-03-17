import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
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
 * Zod schema for parsing tsconfig.base.json / tsconfig.json path aliases.
 * Uses .loose() to ignore unknown fields (same pattern as resolve.ts / types.ts).
 */
const tsConfigPathsSchema = z
  .object({
    compilerOptions: z
      .object({
        paths: z.record(z.string(), z.array(z.string())).optional(),
      })
      .loose()
      .optional(),
  })
  .loose();

/**
 * Attempt to read a tsconfig file at the given path and return its parsed paths.
 * Returns undefined on any read/parse/validation failure (silent-skip behavior).
 * The filePath is normalized to forward slashes before reading.
 */
function readTsconfigPaths(filePath: string): Record<string, string[]> | undefined {
  try {
    const normalizedPath = normalizePath(filePath);
    const raw = readFileSync(normalizedPath, 'utf-8');
    const parsed = JSON.parse(String(raw));
    const result = tsConfigPathsSchema.safeParse(parsed);

    if (!result.success) {
      return undefined;
    }

    return result.data.compilerOptions?.paths;
  } catch {
    return undefined;
  }
}

/**
 * Try tsconfig.base.json, then fall back to tsconfig.json.
 * Returns the paths map from whichever file is found first, or undefined.
 */
function readTsconfigPathsWithFallback(dirPath: string): Record<string, string[]> | undefined {
  const base = readTsconfigPaths(join(dirPath, 'tsconfig.base.json'));

  if (base !== undefined) {
    return base;
  }

  return readTsconfigPaths(join(dirPath, 'tsconfig.json'));
}

/**
 * Expand path alias entries into the lookup map.
 *
 * For each alias key + values array:
 * - Takes the first value (or iterates all until a match is found)
 * - Strips the filename from the value path
 * - Walks up path segments to find a matching relative project root
 * - If a match is found and the alias key is not already in the map, inserts it
 *
 * @param paths - Record of alias keys to arrays of path values (from tsconfig)
 * @param nodeRoots - Map from relative project root (stripped of any .repos/<alias>/ prefix) to project name
 * @param map - The lookup map to insert into (packageName → projectName)
 */
function expandTsconfigPathsIntoMap(
  paths: Record<string, string[]>,
  nodeRoots: Map<string, string>,
  map: Map<string, string>,
): void {
  for (const [aliasKey, values] of Object.entries(paths)) {
    if (map.has(aliasKey)) {
      continue;
    }

    let matched = false;

    for (const value of values) {
      if (matched) {
        break;
      }

      // Normalize value to forward slashes
      const normalized = value.replace(/\\/g, '/');
      // Strip the filename component
      const lastSlash = normalized.lastIndexOf('/');
      let dirPath = lastSlash >= 0 ? normalized.slice(0, lastSlash) : normalized;

      // Walk up path segments looking for a matching project root
      while (dirPath.length > 0) {
        const projectName = nodeRoots.get(dirPath);

        if (projectName !== undefined) {
          map.set(aliasKey, projectName);
          matched = true;
          break;
        }

        const parentSlash = dirPath.lastIndexOf('/');

        if (parentSlash < 0) {
          break;
        }

        dirPath = dirPath.slice(0, parentSlash);
      }
    }
  }
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
 *    c. Provider-side tsconfig.base.json / tsconfig.json path aliases for each external repo
 *    d. Host workspace tsconfig path aliases
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
  const { workspaceRoot } = context;

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

  // 1c. Provider-side tsconfig path alias expansion for external repos
  for (const [alias, repoData] of Object.entries(report.repos)) {
    const repoDir = join(workspaceRoot, '.repos', alias);
    const paths = readTsconfigPathsWithFallback(repoDir);

    if (paths === undefined) {
      continue;
    }

    // Build a map from stripped-relative-root → node name for this repo's nodes
    const rootPrefix = `.repos/${alias}/`;
    const nodeRoots = new Map<string, string>();

    for (const node of Object.values(repoData.nodes)) {
      const normalizedRoot = normalizePath(node.root);

      if (normalizedRoot.startsWith(rootPrefix)) {
        const relativeRoot = normalizedRoot.slice(rootPrefix.length);
        nodeRoots.set(relativeRoot, node.name);
      }
    }

    expandTsconfigPathsIntoMap(paths, nodeRoots, pkgNameToProject);
  }

  // 1d. Host workspace tsconfig path alias expansion
  const hostPaths = readTsconfigPathsWithFallback(workspaceRoot);

  if (hostPaths !== undefined) {
    // Build map from project root → project name for host projects
    const hostRoots = new Map<string, string>();

    for (const [projectName, projectConfig] of Object.entries(context.projects)) {
      const normalizedRoot = normalizePath(projectConfig.root);
      hostRoots.set(normalizedRoot, projectName);
    }

    expandTsconfigPathsIntoMap(hostPaths, hostRoots, pkgNameToProject);
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
      workspaceRoot,
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
