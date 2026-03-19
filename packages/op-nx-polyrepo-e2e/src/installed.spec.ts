import { describe, it, expect, beforeAll, afterAll, inject } from 'vitest';
import { type StartedTestContainer } from 'testcontainers';

import { startContainer } from './setup/container.js';

describe('@op-nx/polyrepo installation', () => {
  let container: StartedTestContainer;

  beforeAll(async () => {
    container = await startContainer(inject('snapshotImage'), 'installed');
  });

  afterAll(async () => {
    await container.stop();
  });

  it('should be installed', async () => {
    expect.assertions(1);

    const { exitCode } = await container.exec(
      ['npm', 'ls', '@op-nx/polyrepo'],
      { workingDir: '/workspace' },
    );

    expect(exitCode).toBe(0);
  });
});
