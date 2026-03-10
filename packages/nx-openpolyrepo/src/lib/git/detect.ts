import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import type { NormalizedRepoEntry } from '../config/schema';

const gitUrlPattern = /^(git@|https?:\/\/|ssh:\/\/|file:\/\/)/;

export function isGitUrl(value: string): boolean {
  return gitUrlPattern.test(value);
}

export type RepoState = 'cloned' | 'referenced' | 'not-synced';

export function detectRepoState(
  alias: string,
  entry: NormalizedRepoEntry,
  workspaceRoot: string
): RepoState {
  if (entry.type === 'remote') {
    const gitDir = join(workspaceRoot, '.repos', alias, '.git');

    return existsSync(gitDir) ? 'cloned' : 'not-synced';
  }

  return existsSync(entry.path) ? 'referenced' : 'not-synced';
}

function execGitOutput(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || error.message));

        return;
      }

      resolve(stdout.trim());
    });
  });
}

export async function getCurrentBranch(cwd: string): Promise<string | null> {
  const branch = await execGitOutput(['rev-parse', '--abbrev-ref', 'HEAD'], cwd);

  return branch === 'HEAD' ? null : branch;
}

export async function getCurrentRef(cwd: string): Promise<string> {
  try {
    const tag = await execGitOutput(['describe', '--tags', '--exact-match', 'HEAD'], cwd);

    return tag;
  } catch {
    const sha = await execGitOutput(['rev-parse', '--short', 'HEAD'], cwd);

    return sha;
  }
}
