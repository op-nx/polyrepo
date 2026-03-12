import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();

  return {
    ...actual,
    readFileSync: vi.fn(),
  };
});

import { readFileSync } from 'node:fs';
import { resolvePluginConfig } from './resolve';

const mockedReadFileSync = vi.mocked(readFileSync);

beforeEach(() => {
  vi.clearAllMocks();
});

function makeNxJson(pluginOptions?: Record<string, unknown>): string {
  return JSON.stringify({
    plugins: [
      {
        plugin: '@op-nx/polyrepo',
        options: pluginOptions,
      },
    ],
  });
}

describe('resolvePluginConfig', () => {
  it('returns validated config and normalized entries for valid nx.json', () => {
    const options = {
      repos: { 'repo-a': 'git@github.com:org/repo-a.git' },
    };

    mockedReadFileSync.mockReturnValue(makeNxJson(options));

    const result = resolvePluginConfig('/workspace');

    expect(result.config).toEqual(options);
    expect(result.entries).toEqual([
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

  it('throws when nx.json has no plugins array', () => {
    mockedReadFileSync.mockReturnValue(JSON.stringify({}));

    expect(() => resolvePluginConfig('/workspace')).toThrow();
  });

  it('throws when @op-nx/polyrepo plugin entry is missing from plugins', () => {
    const nxJson = JSON.stringify({
      plugins: [
        { plugin: '@nx/some-other-plugin', options: {} },
      ],
    });

    mockedReadFileSync.mockReturnValue(nxJson);

    expect(() => resolvePluginConfig('/workspace')).toThrow();
  });
});
