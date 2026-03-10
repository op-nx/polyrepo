import { execFile } from 'node:child_process';

const gitPath = (p: string): string => p.replace(/\\/g, '/');

interface CloneOptions {
  depth?: number;
  ref?: string;
}

function execGit(args: string[], cwd?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const options = cwd ? { cwd: gitPath(cwd) } : {};

    execFile('git', args, options, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || error.message));

        return;
      }

      resolve(stdout);
    });
  });
}

export async function gitClone(
  url: string,
  targetDir: string,
  options: CloneOptions = {},
): Promise<void> {
  const { depth = 1, ref } = options;
  const args: string[] = ['clone'];

  if (depth > 0) {
    args.push('--depth', String(depth));
  }

  if (ref) {
    args.push('--branch', ref);
  }

  args.push(url, gitPath(targetDir));
  await execGit(args);
}

export async function gitPull(cwd: string): Promise<void> {
  await execGit(['pull'], cwd);
}

export async function gitFetch(cwd: string): Promise<void> {
  await execGit(['fetch'], cwd);
}

export async function gitPullRebase(cwd: string): Promise<void> {
  await execGit(['pull', '--rebase'], cwd);
}

export async function gitPullFfOnly(cwd: string): Promise<void> {
  await execGit(['pull', '--ff-only'], cwd);
}

export async function gitFetchTag(
  cwd: string,
  tag: string,
  depth = 1,
): Promise<void> {
  await execGit(['fetch', '--depth', String(depth), 'origin', 'tag', tag], cwd);
  await execGit(['checkout', tag], cwd);
}
