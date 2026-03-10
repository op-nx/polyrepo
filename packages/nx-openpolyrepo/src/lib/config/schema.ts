import { z } from 'zod';

const gitUrlPattern = /^(git@|https?:\/\/|ssh:\/\/|file:\/\/)/;

const remoteRepoObject = z
  .object({
    url: z.string().regex(gitUrlPattern, 'Must be a valid git URL'),
    ref: z.string().optional(),
    depth: z.number().int().min(0).optional(),
  })
  .strict();

const localRepoObject = z
  .object({
    path: z.string().min(1),
  })
  .strict();

const repoEntry = z.union([z.string().min(1), remoteRepoObject, localRepoObject]);

export const polyrepoConfigSchema = z.object({
  repos: z.record(z.string().min(1), repoEntry).refine(
    (repos) => Object.keys(repos).length > 0,
    { message: 'repos must contain at least one entry' }
  ),
});

export type PolyrepoConfig = z.infer<typeof polyrepoConfigSchema>;

export type NormalizedRepoEntry =
  | { type: 'remote'; alias: string; url: string; ref?: string; depth: number }
  | { type: 'local'; alias: string; path: string };

export function normalizeRepos(config: PolyrepoConfig): NormalizedRepoEntry[] {
  return Object.entries(config.repos).map(([alias, entry]) => {
    if (typeof entry === 'string') {
      if (gitUrlPattern.test(entry)) {
        return { type: 'remote', alias, url: entry, ref: undefined, depth: 1 };
      }

      return { type: 'local', alias, path: entry };
    }

    if ('url' in entry) {
      return {
        type: 'remote',
        alias,
        url: entry.url,
        ref: entry.ref,
        depth: entry.depth ?? 1,
      };
    }

    return { type: 'local', alias, path: entry.path };
  });
}
