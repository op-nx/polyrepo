import type {
  CreateNodesV2,
  CreateNodesResult,
} from '@nx/devkit';
import type { PolyrepoConfig } from './lib/config/schema.js';
import { validateConfig, warnIfReposNotGitignored, warnUnsyncedRepos } from './lib/config/validate.js';

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
                  executor: 'nx-openpolyrepo:sync',
                  options: {},
                },
                'polyrepo-status': {
                  executor: 'nx-openpolyrepo:status',
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
