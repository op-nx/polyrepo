import { resolve } from 'node:path';
import { z } from 'zod';
import { normalizeGitUrl } from '../git/normalize-url';

const gitUrlPattern = /^(git@|https?:\/\/|ssh:\/\/|file:\/\/)/;

const remoteRepoObject = z
  .object({
    url: z.string().regex(gitUrlPattern, 'Must be a valid git URL'),
    ref: z.string().optional(),
    depth: z.number().int().min(0).optional(),
    disableHooks: z.boolean().default(true),
  })
  .strict();

const localRepoObject = z
  .object({
    path: z.string().min(1),
  })
  .strict();

const repoEntry = z.union([
  z.string().min(1),
  remoteRepoObject,
  localRepoObject,
]);

/**
 * Extract the URL or path string from a repo entry for normalization.
 */
function extractRepoUrl(entry: z.infer<typeof repoEntry>): string {
  if (typeof entry === 'string') {
    if (gitUrlPattern.test(entry)) {
      return entry;
    }

    // Local path -- resolve to absolute for comparison
    return resolve(entry);
  }

  if ('url' in entry) {
    return entry.url;
  }

  // Local path object -- resolve to absolute for comparison
  return resolve(entry.path);
}

export const polyrepoConfigSchema = z.object({
  repos: z
    .record(z.string().min(1), repoEntry)
    .refine((repos) => Object.keys(repos).length > 0, {
      message: 'repos must contain at least one entry',
    })
    .check((ctx) => {
      const repos = ctx.value;
      const urlToAliases = new Map<string, string[]>();

      for (const [alias, entry] of Object.entries(repos)) {
        const rawUrl = extractRepoUrl(entry);
        const normalized = gitUrlPattern.test(rawUrl)
          ? normalizeGitUrl(rawUrl)
          : rawUrl;
        const existing = urlToAliases.get(normalized) ?? [];
        existing.push(alias);
        urlToAliases.set(normalized, existing);
      }

      const duplicates: string[] = [];

      for (const aliases of urlToAliases.values()) {
        if (aliases.length > 1) {
          duplicates.push(aliases.join(', '));
        }
      }

      if (duplicates.length > 0) {
        ctx.issues.push({
          code: 'custom',
          message: `Duplicate repo URLs detected: [${duplicates.join('; ')}] point to the same repository`,
          input: repos,
          path: [],
        });
      }
    }),
});

export type PolyrepoConfig = z.infer<typeof polyrepoConfigSchema>;

export type NormalizedRepoEntry =
  | { type: 'remote'; alias: string; url: string; ref?: string; depth: number; disableHooks: boolean }
  | { type: 'local'; alias: string; path: string };

export function normalizeRepos(config: PolyrepoConfig): NormalizedRepoEntry[] {
  return Object.entries(config.repos).map(([alias, entry]) => {
    if (typeof entry === 'string') {
      if (gitUrlPattern.test(entry)) {
        return { type: 'remote', alias, url: entry, ref: undefined, depth: 1, disableHooks: true };
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
        disableHooks: entry.disableHooks ?? true,
      };
    }

    return { type: 'local', alias, path: entry.path };
  });
}
