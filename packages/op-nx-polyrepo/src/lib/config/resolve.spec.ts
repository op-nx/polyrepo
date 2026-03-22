import { describe, it, expect, vi } from 'vitest';
import type * as NodeFs from 'node:fs';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof NodeFs>();

  return {
    ...actual,
    readFileSync: vi.fn<(path: string, options?: unknown) => string>(),
  };
});

import { readFileSync } from 'node:fs';
import { resolvePluginConfig } from './resolve';

function setup() {
  vi.clearAllMocks();

  const mockedReadFileSync = vi.mocked(readFileSync);

  return { mockedReadFileSync };
}

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

describe(resolvePluginConfig, () => {
  it('returns validated config and normalized entries for valid nx.json', () => {
    const { mockedReadFileSync } = setup();

    const options = {
      repos: { 'repo-a': 'git@github.com:org/repo-a.git' },
    };

    mockedReadFileSync.mockReturnValue(makeNxJson(options));

    const result = resolvePluginConfig('/workspace');

    expect(result.config).toStrictEqual(options);
    expect(result.entries).toStrictEqual([
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
    const { mockedReadFileSync } = setup();

    mockedReadFileSync.mockReturnValue(JSON.stringify({}));

    expect(() => resolvePluginConfig('/workspace')).toThrowError(
      'Invalid @op-nx/polyrepo config',
    );
  });

  it('throws when @op-nx/polyrepo plugin entry is missing from plugins', () => {
    const { mockedReadFileSync } = setup();

    const nxJson = JSON.stringify({
      plugins: [{ plugin: '@nx/some-other-plugin', options: {} }],
    });

    mockedReadFileSync.mockReturnValue(nxJson);

    expect(() => resolvePluginConfig('/workspace')).toThrowError(
      'Invalid @op-nx/polyrepo config',
    );
  });
});
