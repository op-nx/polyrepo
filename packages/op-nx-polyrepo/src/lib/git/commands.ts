import { execFile } from 'node:child_process';

const gitPath = (p: string): string => p.replace(/\\/g, '/');

interface CloneOptions {
  depth?: number;
  ref?: string;
  disableHooks?: boolean;
}

function execGit(args: string[], cwd?: string, disableHooks?: boolean): Promise<string> {
  if (disableHooks) {
    args = ['-c', 'core.hooksPath=__op-nx_polyrepo_disable-hooks__', ...args];
  }

  return new Promise((resolve, reject) => {
    const options = cwd
      ? { cwd: gitPath(cwd), windowsHide: true }
      : { windowsHide: true };

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
  const { depth = 1, ref, disableHooks } = options;
  const args: string[] = ['clone'];

  if (depth > 0) {
    args.push('--depth', String(depth));
  }

  if (ref) {
    args.push('--branch', ref);
  }

  args.push(url, gitPath(targetDir));
  await execGit(args, undefined, disableHooks);
}

export async function gitPull(cwd: string, disableHooks?: boolean): Promise<void> {
  await execGit(['pull'], cwd, disableHooks);
}

export async function gitFetch(cwd: string, disableHooks?: boolean): Promise<void> {
  await execGit(['fetch'], cwd, disableHooks);
}

export async function gitPullRebase(cwd: string, disableHooks?: boolean): Promise<void> {
  await execGit(['pull', '--rebase'], cwd, disableHooks);
}

export async function gitPullFfOnly(cwd: string, disableHooks?: boolean): Promise<void> {
  await execGit(['pull', '--ff-only'], cwd, disableHooks);
}

export async function gitFetchTag(
  cwd: string,
  tag: string,
  depth = 1,
  disableHooks?: boolean,
): Promise<void> {
  await execGit(['fetch', '--depth', String(depth), 'origin', 'tag', tag], cwd, disableHooks);
  await execGit(['checkout', tag], cwd, disableHooks);
}
