import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { validateConfig } from './validate';
import { normalizeRepos } from './schema';
import type { PolyrepoConfig, NormalizedRepoEntry } from './schema';

const nxJsonPluginSubsetSchema = z
  .object({
    plugins: z
      .array(
        z.union([
          z.string(),
          z
            .object({
              plugin: z.string(),
              options: z.unknown().optional(),
            })
            .loose(),
        ]),
      )
      .optional(),
  })
  .loose();

export interface ResolvedPluginConfig {
  config: PolyrepoConfig;
  entries: NormalizedRepoEntry[];
}

export function resolvePluginConfig(
  workspaceRoot: string,
): ResolvedPluginConfig {
  const nxJsonPath = join(workspaceRoot, 'nx.json');
  const result = nxJsonPluginSubsetSchema.safeParse(
    JSON.parse(readFileSync(nxJsonPath, 'utf-8')),
  );

  if (!result.success) {
    throw new Error(
      `Invalid nx.json at ${nxJsonPath}: ${result.error.message}`,
    );
  }

  const nxJson = result.data;
  const pluginEntry = nxJson.plugins?.find(
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
