import type { CreateNodesV2, CreateNodesResult } from '@nx/devkit';
import type { PolyrepoConfig } from './lib/config/schema';
import {
  validateConfig,
  warnIfReposNotGitignored,
  warnUnsyncedRepos,
} from './lib/config/validate';

export const createNodesV2: CreateNodesV2<PolyrepoConfig> = [
  'nx.json',
  async (configFiles, options, context) => {
    const config = validateConfig(options);

    await warnIfReposNotGitignored(context.workspaceRoot);
    warnUnsyncedRepos(config, context.workspaceRoot);

    const results: Array<readonly [string, CreateNodesResult]> = [];

    for (const configFile of configFiles) {
      results.push([
        configFile,
        {
          projects: {
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
          },
        },
      ]);
    }

    return results;
  },
];
