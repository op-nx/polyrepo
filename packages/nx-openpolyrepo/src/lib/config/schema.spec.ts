import { describe, it, expect } from 'vitest';
import {
  polyrepoConfigSchema,
  normalizeRepos,
  type PolyrepoConfig,
  type NormalizedRepoEntry,
} from './schema.js';

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
    const config: PolyrepoConfig = {
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
      },
    ]);
  });
});
