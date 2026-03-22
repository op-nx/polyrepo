import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import type { NormalizedRepoEntry } from '../config/schema';

export type RepoState = 'cloned' | 'referenced' | 'not-synced';

export function detectRepoState(
  alias: string,
  entry: NormalizedRepoEntry,
  workspaceRoot: string,
): RepoState {
  if (entry.type === 'remote') {
    const gitDir = join(workspaceRoot, '.repos', alias, '.git');

    return existsSync(gitDir) ? 'cloned' : 'not-synced';
  }

  return existsSync(entry.path) ? 'referenced' : 'not-synced';
}

function execGitOutput(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      args,
      { cwd, windowsHide: true },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr || error.message));

          return;
        }

        resolve(stdout.trim());
      },
    );
  });
}

function execGitRawOutput(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      args,
      { cwd, windowsHide: true },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr || error.message));

          return;
        }

        resolve(stdout);
      },
    );
  });
}

export async function getCurrentBranch(cwd: string): Promise<string | null> {
  const branch = await execGitOutput(
    ['rev-parse', '--abbrev-ref', 'HEAD'],
    cwd,
  );

  return branch === 'HEAD' ? null : branch;
}

export async function getHeadSha(cwd: string): Promise<string> {
  return execGitOutput(['rev-parse', 'HEAD'], cwd);
}

export async function getDirtyFiles(cwd: string): Promise<string> {
  return execGitOutput(['diff', '--name-only', 'HEAD'], cwd);
}

export async function getCurrentRef(cwd: string): Promise<string> {
  try {
    const tag = await execGitOutput(
      ['describe', '--tags', '--exact-match', 'HEAD'],
      cwd,
    );

    return tag;
  } catch {
    const sha = await execGitOutput(['rev-parse', '--short', 'HEAD'], cwd);

    return sha;
  }
}

export async function isGitTag(
  cwd: string,
  ref: string | undefined,
): Promise<boolean> {
  if (!ref) {
    return false;
  }

  // Check local tags first (fast, no network)
  try {
    await execGitOutput(['show-ref', '--verify', `refs/tags/${ref}`], cwd);

    return true;
  } catch {
    // Tag not found locally — check remote
  }

  // Check remote tags (handles not-yet-fetched tags)
  try {
    const output = await execGitOutput(
      ['ls-remote', '--tags', 'origin', `refs/tags/${ref}`],
      cwd,
    );

    return output.length > 0;
  } catch {
    return false;
  }
}

export interface WorkingTreeState {
  modified: number;
  staged: number;
  deleted: number;
  untracked: number;
  conflicts: number;
}

export interface AheadBehind {
  ahead: number;
  behind: number;
}

const CONFLICT_PATTERNS = new Set(['UU', 'AA', 'DD', 'AU', 'UA', 'DU', 'UD']);

const STAGED_CHARS = new Set(['M', 'A', 'D', 'R', 'C']);

export async function getWorkingTreeState(
  cwd: string,
): Promise<WorkingTreeState> {
  const output = await execGitRawOutput(['status', '--porcelain=v1'], cwd);
  const state: WorkingTreeState = {
    modified: 0,
    staged: 0,
    deleted: 0,
    untracked: 0,
    conflicts: 0,
  };

  if (!output.trim()) {
    return state;
  }

  for (const line of output.split('\n')) {
    if (!line || line.length < 2) {
      continue;
    }

    const x = line[0] ?? '';
    const y = line[1] ?? '';
    const xy = x + y;

    // Check conflict patterns first
    if (CONFLICT_PATTERNS.has(xy)) {
      state.conflicts++;
      continue;
    }

    // Check untracked
    if (x === '?' && y === '?') {
      state.untracked++;
      continue;
    }

    // Check staged (X position)
    if (STAGED_CHARS.has(x)) {
      state.staged++;
    }

    // Check modified in working tree (Y position)
    if (y === 'M') {
      state.modified++;
    }

    // Check deleted -- Y='D' takes priority, else X='D'
    if (y === 'D') {
      state.deleted++;
    } else if (x === 'D') {
      state.deleted++;
    }
  }

  return state;
}

export async function getAheadBehind(cwd: string): Promise<AheadBehind | null> {
  try {
    const output = await execGitOutput(
      ['rev-list', '--left-right', '--count', 'HEAD...@{u}'],
      cwd,
    );
    const parts = output.split('\t');
    const aheadStr = parts[0];
    const behindStr = parts[1];

    if (aheadStr === undefined || behindStr === undefined) {
      return null;
    }

    return {
      ahead: parseInt(aheadStr, 10),
      behind: parseInt(behindStr, 10),
    };
  } catch {
    return null;
  }
}
