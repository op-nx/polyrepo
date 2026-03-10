import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { logger } from '@nx/devkit';
import { polyrepoConfigSchema, type PolyrepoConfig, normalizeRepos } from './schema';

export function validateConfig(options: unknown): PolyrepoConfig {
  const result = polyrepoConfigSchema.safeParse(options);

  if (!result.success) {
    throw new Error(
      `Invalid nx-openpolyrepo config:\n${result.error.message}`
    );
  }

  return result.data;
}

export async function warnIfReposNotGitignored(workspaceRoot: string): Promise<void> {
  try {
    const gitignore = await readFile(
      join(workspaceRoot, '.gitignore'),
      'utf-8'
    );
    const lines = gitignore.split('\n').map((l) => l.trim());

    if (!lines.some((l) => l === '.repos' || l === '.repos/' || l === '/.repos' || l === '/.repos/')) {
      logger.warn(
        'The .repos/ directory is not in .gitignore. ' +
        'Add ".repos/" to .gitignore to avoid committing cloned repos.'
      );
    }
  } catch {
    logger.warn(
      'No .gitignore file found. ' +
      'Create one and add ".repos/" to avoid committing cloned repos.'
    );
  }
}

export function warnUnsyncedRepos(config: PolyrepoConfig, workspaceRoot: string): void {
  const entries = normalizeRepos(config);

  for (const entry of entries) {
    if (entry.type !== 'remote') {
      continue;
    }

    const repoPath = join(workspaceRoot, '.repos', entry.alias);

    if (!existsSync(repoPath)) {
      logger.warn(
        `Repo "${entry.alias}" is not synced. Run "nx polyrepo-sync" to clone it to .repos/${entry.alias}/`
      );
    }
  }
}
