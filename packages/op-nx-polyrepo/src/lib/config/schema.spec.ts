import { describe, it, expect } from 'vitest';
import {
  polyrepoConfigSchema,
  normalizeRepos,
  type PolyrepoConfig,
  type PolyrepoConfigInput,
} from './schema';

describe('polyrepoConfigSchema', () => {
  describe('valid entries', () => {
    it('accepts string URL (git@github.com:org/repo.git)', () => {
      const result = polyrepoConfigSchema.safeParse({
        repos: { 'repo-a': 'git@github.com:org/repo-a.git' },
      });

      expect(result.success).toBe(true);
    });

    it('accepts string URL (https://github.com/org/repo.git)', () => {
      const result = polyrepoConfigSchema.safeParse({
        repos: { 'repo-a': 'https://github.com/org/repo-a.git' },
      });

      expect(result.success).toBe(true);
    });

    it('accepts string URL (ssh://git@github.com/org/repo.git)', () => {
      const result = polyrepoConfigSchema.safeParse({
        repos: { 'repo-a': 'ssh://git@github.com/org/repo-a.git' },
      });

      expect(result.success).toBe(true);
    });

    it('accepts string URL (file:///path/to/repo)', () => {
      const result = polyrepoConfigSchema.safeParse({
        repos: { 'repo-a': 'file:///path/to/repo' },
      });

      expect(result.success).toBe(true);
    });

    it('accepts string local path (D:/projects/repo-b)', () => {
      const result = polyrepoConfigSchema.safeParse({
        repos: { 'repo-b': 'D:/projects/repo-b' },
      });

      expect(result.success).toBe(true);
    });

    it('accepts string local path (../relative/repo)', () => {
      const result = polyrepoConfigSchema.safeParse({
        repos: { 'repo-c': '../relative/repo' },
      });

      expect(result.success).toBe(true);
    });

    it('accepts object with url field for remote repo', () => {
      const result = polyrepoConfigSchema.safeParse({
        repos: {
          'repo-a': { url: 'https://github.com/org/repo-a.git' },
        },
      });

      expect(result.success).toBe(true);
    });

    it('accepts object with path field for local repo', () => {
      const result = polyrepoConfigSchema.safeParse({
        repos: {
          'repo-b': { path: 'D:/projects/repo-b' },
        },
      });

      expect(result.success).toBe(true);
    });

    it('accepts object with url + ref + depth options', () => {
      const result = polyrepoConfigSchema.safeParse({
        repos: {
          'repo-a': {
            url: 'git@github.com:org/repo-a.git',
            ref: 'develop',
            depth: 5,
          },
        },
      });

      expect(result.success).toBe(true);
    });

    it('accepts depth: 0 (full clone)', () => {
      const result = polyrepoConfigSchema.safeParse({
        repos: {
          'repo-a': {
            url: 'https://github.com/org/repo-a.git',
            depth: 0,
          },
        },
      });

      expect(result.success).toBe(true);
    });
  });

  describe('duplicate URL detection', () => {
    it('rejects config where two repos have the same normalized URL (SSH and HTTPS)', () => {
      const result = polyrepoConfigSchema.safeParse({
        repos: {
          'repo-a': 'git@github.com:org/my-repo.git',
          'repo-b': 'https://github.com/org/my-repo',
        },
      });

      expect(result.success).toBe(false);

      if (!result.success) {
        const firstIssue = result.error.issues[0];
        expect(firstIssue).toBeDefined();
        const message = firstIssue?.message ?? '';
        expect(message).toContain('repo-a');
        expect(message).toContain('repo-b');
      }
    });

    it('rejects config where two repos have same URL but one has .git suffix', () => {
      const result = polyrepoConfigSchema.safeParse({
        repos: {
          'repo-a': 'https://github.com/org/my-repo.git',
          'repo-b': 'https://github.com/org/my-repo',
        },
      });

      expect(result.success).toBe(false);

      if (!result.success) {
        const firstIssue = result.error.issues[0];
        expect(firstIssue).toBeDefined();
        const message = firstIssue?.message ?? '';
        expect(message).toContain('repo-a');
        expect(message).toContain('repo-b');
      }
    });

    it('accepts config where repos have genuinely different URLs', () => {
      const result = polyrepoConfigSchema.safeParse({
        repos: {
          'repo-a': 'https://github.com/org/repo-a.git',
          'repo-b': 'https://github.com/org/repo-b.git',
        },
      });

      expect(result.success).toBe(true);
    });

    it('detects duplicates across string URL and object URL entries', () => {
      const result = polyrepoConfigSchema.safeParse({
        repos: {
          'repo-a': 'git@github.com:org/my-repo.git',
          'repo-b': { url: 'https://github.com/org/my-repo' },
        },
      });

      expect(result.success).toBe(false);

      if (!result.success) {
        const firstIssue = result.error.issues[0];
        expect(firstIssue).toBeDefined();
        const message = firstIssue?.message ?? '';
        expect(message).toContain('repo-a');
        expect(message).toContain('repo-b');
      }
    });

    it('uses path.resolve for local path duplicate comparison', () => {
      const result = polyrepoConfigSchema.safeParse({
        repos: {
          'repo-a': 'D:/projects/repo',
          'repo-b': { path: 'D:/projects/repo' },
        },
      });

      expect(result.success).toBe(false);

      if (!result.success) {
        const firstIssue = result.error.issues[0];
        expect(firstIssue).toBeDefined();
        const message = firstIssue?.message ?? '';
        expect(message).toContain('repo-a');
        expect(message).toContain('repo-b');
      }
    });
  });

  describe('invalid entries', () => {
    it('rejects empty string', () => {
      const result = polyrepoConfigSchema.safeParse({
        repos: { 'repo-a': '' },
      });

      expect(result.success).toBe(false);
    });

    it('rejects empty repos map', () => {
      const result = polyrepoConfigSchema.safeParse({
        repos: {},
      });

      expect(result.success).toBe(false);
    });

    it('rejects object with both url and path (ambiguous)', () => {
      const result = polyrepoConfigSchema.safeParse({
        repos: {
          'repo-a': {
            url: 'https://github.com/org/repo-a.git',
            path: 'D:/projects/repo-a',
          },
        },
      });

      expect(result.success).toBe(false);
    });

    it('rejects object with neither url nor path', () => {
      const result = polyrepoConfigSchema.safeParse({
        repos: { 'repo-a': { ref: 'main' } },
      });

      expect(result.success).toBe(false);
    });

    it('rejects negative depth', () => {
      const result = polyrepoConfigSchema.safeParse({
        repos: {
          'repo-a': {
            url: 'https://github.com/org/repo-a.git',
            depth: -1,
          },
        },
      });

      expect(result.success).toBe(false);
    });

    it('rejects non-integer depth', () => {
      const result = polyrepoConfigSchema.safeParse({
        repos: {
          'repo-a': {
            url: 'https://github.com/org/repo-a.git',
            depth: 1.5,
          },
        },
      });

      expect(result.success).toBe(false);
    });

    it('rejects missing repos key entirely', () => {
      const result = polyrepoConfigSchema.safeParse({});

      expect(result.success).toBe(false);
    });
  });
});

describe('normalizeRepos', () => {
  it('converts string URL to remote entry with defaults', () => {
    const config: PolyrepoConfig = {
      repos: { 'repo-a': 'git@github.com:org/repo-a.git' },
    };

    const result = normalizeRepos(config);

    expect(result).toEqual([
      {
        type: 'remote',
        alias: 'repo-a',
        url: 'git@github.com:org/repo-a.git',
        ref: undefined,
        depth: 1,
        disableHooks: true,
      },
    ]);
  });

  it('converts string path to local entry', () => {
    const config: PolyrepoConfig = {
      repos: { 'repo-b': 'D:/projects/repo-b' },
    };

    const result = normalizeRepos(config);

    expect(result).toEqual([
      {
        type: 'local',
        alias: 'repo-b',
        path: 'D:/projects/repo-b',
      },
    ]);
  });

  it('converts object URL to remote entry', () => {
    const config: PolyrepoConfig = {
      repos: {
        'repo-c': {
          url: 'https://github.com/org/repo-c.git',
          ref: 'develop',
          depth: 3,
          disableHooks: true,
        },
      },
    };

    const result = normalizeRepos(config);

    expect(result).toEqual([
      {
        type: 'remote',
        alias: 'repo-c',
        url: 'https://github.com/org/repo-c.git',
        ref: 'develop',
        depth: 3,
        disableHooks: true,
      },
    ]);
  });

  it('converts object path to local entry', () => {
    const config: PolyrepoConfig = {
      repos: {
        'repo-d': { path: 'D:/projects/repo-d' },
      },
    };

    const result = normalizeRepos(config);

    expect(result).toEqual([
      {
        type: 'local',
        alias: 'repo-d',
        path: 'D:/projects/repo-d',
      },
    ]);
  });

  it('defaults depth to 1 for remote repos', () => {
    const config: PolyrepoConfigInput = {
      repos: {
        'repo-a': { url: 'https://github.com/org/repo-a.git' },
      },
    };

    const result = normalizeRepos(config);

    expect(result).toEqual([
      {
        type: 'remote',
        alias: 'repo-a',
        url: 'https://github.com/org/repo-a.git',
        ref: undefined,
        depth: 1,
        disableHooks: true,
      },
    ]);
  });

  it('defaults disableHooks to true for string URL remote entries', () => {
    const config: PolyrepoConfig = {
      repos: { 'repo-a': 'git@github.com:org/repo-a.git' },
    };

    const result = normalizeRepos(config);

    expect(result[0]).toMatchObject({
      type: 'remote',
      disableHooks: true,
    });
  });

  it('defaults disableHooks to true for object URL remote entries', () => {
    const config: PolyrepoConfigInput = {
      repos: {
        'repo-a': { url: 'https://github.com/org/repo-a.git' },
      },
    };

    const result = normalizeRepos(config);

    expect(result[0]).toMatchObject({
      type: 'remote',
      disableHooks: true,
    });
  });

  it('preserves disableHooks: false when explicitly set', () => {
    const config: PolyrepoConfig = {
      repos: {
        'repo-a': {
          url: 'https://github.com/org/repo-a.git',
          disableHooks: false,
        },
      },
    };

    const result = normalizeRepos(config);

    expect(result[0]).toMatchObject({
      type: 'remote',
      disableHooks: false,
    });
  });

  it('does not add disableHooks to local repo entries', () => {
    const config: PolyrepoConfig = {
      repos: { 'repo-b': 'D:/projects/repo-b' },
    };

    const result = normalizeRepos(config);

    const firstEntry = result[0];
    expect(firstEntry).toBeDefined();

    expect(firstEntry).toEqual({
      type: 'local',
      alias: 'repo-b',
      path: 'D:/projects/repo-b',
    });

    if (firstEntry) {
      expect('disableHooks' in firstEntry).toBe(false);
    }
  });
});
