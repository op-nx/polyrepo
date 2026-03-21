import { describe, it, expect, beforeAll, afterAll, inject } from 'vitest';
import { type StartedTestContainer } from 'testcontainers';

import { startContainer, writeNxJson } from './setup/container.js';

describe('polyrepo-status', () => {
  let container: StartedTestContainer;

  beforeAll(async () => {
    container = await startContainer(inject('snapshotImage'), 'polyrepo-status');
  });

  afterAll(async () => {
    await container.stop();
  });

  it('should register target on root project', async () => {
    expect.assertions(2);

    const { stdout } = await container.exec(
      ['npx', 'nx', 'show', 'project', '@workspace/source', '--json'],
      { workingDir: '/workspace' },
    );

    // Extract JSON object from stdout (strip Nx warnings before/after)
    const jsonMatch = /\{[\s\S]*\}/.exec(stdout);
    const project = JSON.parse(jsonMatch?.[0] ?? '{}');

    expect(project.targets['polyrepo-status']).toBeDefined();
    expect(project.targets['polyrepo-status'].executor).toBe(
      '@op-nx/polyrepo:status',
    );
  }, 300_000);

  it('should show project counts when synced', async () => {
    expect.assertions(2);

    const { stdout } = await container.exec(
      ['npx', 'nx', 'polyrepo-status'],
      { workingDir: '/workspace' },
    );

    expect(stdout).toContain('projects');
    expect(stdout).not.toContain('[not synced]');
  }, 300_000);

  it('should report unsynced repos', async () => {
    expect.assertions(2);

    // Write nx.json referencing a repo alias that hasn't been cloned.
    // The pre-synced "nx" repo in .repos/ is untouched — we just point
    // the config at a different alias so status reports it as unsynced.
    await writeNxJson(container, {
      repos: {
        'not-cloned': 'https://github.com/example/not-cloned.git',
      },
    });

    const { stdout } = await container.exec(
      ['npx', 'nx', 'polyrepo-status'],
      { workingDir: '/workspace' },
    );

    expect(stdout).toContain('[not synced]');
    expect(stdout).toContain('1 configured, 0 synced, 1 not synced');
  }, 300_000);
});
