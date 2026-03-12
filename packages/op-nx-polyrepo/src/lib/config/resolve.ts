import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { NxJsonConfiguration } from '@nx/devkit';
import { validateConfig } from './validate';
import { normalizeRepos } from './schema';
import type { PolyrepoConfig, NormalizedRepoEntry } from './schema';

export interface ResolvedPluginConfig {
  config: PolyrepoConfig;
  entries: NormalizedRepoEntry[];
}

export function resolvePluginConfig(
  workspaceRoot: string,
): ResolvedPluginConfig {
  const nxJsonPath = join(workspaceRoot, 'nx.json');
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

  return { config, entries };
}
