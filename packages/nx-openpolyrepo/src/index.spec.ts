import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createNodesV2 } from './index';
import type { CreateNodesContextV2 } from '@nx/devkit';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();

  return {
    ...actual,
    readFile: vi.fn().mockResolvedValue('.repos/\nnode_modules\n'),
  };
});

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();

  return {
    ...actual,
    existsSync: vi.fn().mockReturnValue(true),
  };
});

vi.mock('@nx/devkit', () => ({
  logger: {
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}));

const mockContext: CreateNodesContextV2 = {
  nxJsonConfiguration: {},
  workspaceRoot: '/workspace',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('createNodesV2', () => {
  it('is exported as a tuple with nx.json glob', () => {
    const [glob] = createNodesV2;

    expect(glob).toBe('nx.json');
  });

  it('callback throws for invalid config (no repos key)', async () => {
    const [, callback] = createNodesV2;

    await expect(
      callback(['nx.json'], {} as never, mockContext)
    ).rejects.toThrow();
  });

  it('callback returns targets for valid config', async () => {
    const [, callback] = createNodesV2;

    const options = {
      repos: { 'repo-a': 'git@github.com:org/repo-a.git' },
    };

    const results = await callback(['nx.json'], options, mockContext);

    expect(results).toHaveLength(1);
    expect(results[0][0]).toBe('nx.json');

    const createNodesResult = results[0][1];

    expect(createNodesResult.projects).toBeDefined();
    expect(createNodesResult.projects!['.']).toBeDefined();

    const targets = createNodesResult.projects!['.'].targets;

    expect(targets).toBeDefined();
    expect(targets!['polyrepo-sync']).toEqual({
      executor: 'nx-openpolyrepo:sync',
      options: {},
    });
    expect(targets!['polyrepo-status']).toEqual({
      executor: 'nx-openpolyrepo:status',
      options: {},
    });
  });
});
