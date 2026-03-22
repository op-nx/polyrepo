import { describe, it, expect, beforeAll, afterAll, inject } from 'vitest';
import { type StartedTestContainer } from 'testcontainers';

import { startContainer, nxVersion, writeNxJson } from './setup/container.js';

describe('proxy target caching', () => {
  let container: StartedTestContainer;

  beforeAll(async () => {
    container = await startContainer(inject('snapshotImage'), 'proxy-caching');

    await writeNxJson(container, {
      repos: {
        nx: { url: 'file:///repos/nx', depth: 1, ref: nxVersion },
      },
    });
  });

  afterAll(async () => {
    await container.stop();
  });

  it('should set cache: true on proxy targets', async () => {
    expect.hasAssertions();

    const result = await container.exec(
      ['npx', 'nx', 'show', 'project', 'nx/nx', '--json'],
      { workingDir: '/workspace' },
    );

    const jsonMatch = /\{[\s\S]*\}/.exec(result.stdout);
    const project: {
      targets: Record<
        string,
        { cache?: boolean; executor?: string; inputs?: unknown[] }
      >;
    } = JSON.parse(jsonMatch?.[0] ?? '{}');

    // Find a proxy target (any target with our executor)
    const proxyTargets = Object.entries(project.targets).filter(
      ([, cfg]) => cfg.executor === '@op-nx/polyrepo:run',
    );

    expect(proxyTargets.length).toBeGreaterThan(0);

    // Every proxy target should have cache: true
    for (const [name, cfg] of proxyTargets) {
      expect(cfg.cache, `${name} should have cache: true`).toBe(true);
    }
  }, 300_000);

  it('should include env-based hash input tied to repo alias', async () => {
    expect.hasAssertions();

    const result = await container.exec(
      ['npx', 'nx', 'show', 'project', 'nx/nx', '--json'],
      { workingDir: '/workspace' },
    );

    const jsonMatch = /\{[\s\S]*\}/.exec(result.stdout);
    const project: {
      targets: Record<
        string,
        { inputs?: Array<{ env?: string }>; executor?: string }
      >;
    } = JSON.parse(jsonMatch?.[0] ?? '{}');

    const proxyTargets = Object.entries(project.targets).filter(
      ([, cfg]) => cfg.executor === '@op-nx/polyrepo:run',
    );

    expect(proxyTargets.length).toBeGreaterThan(0);

    // Every proxy target should have exactly one env input for POLYREPO_HASH_NX
    for (const [name, cfg] of proxyTargets) {
      const envInputs = (cfg.inputs ?? []).filter((i) => i.env !== undefined);

      expect(
        envInputs,
        `${name} should have exactly one env input`,
      ).toHaveLength(1);
      expect(
        envInputs[0]?.env,
        `${name} env input should be POLYREPO_HASH_NX`,
      ).toBe('POLYREPO_HASH_NX');
    }
  }, 300_000);

  it('should export preTasksExecution in the installed plugin', async () => {
    expect.hasAssertions();

    // Verify the compiled plugin exports preTasksExecution
    const result = await container.exec(
      [
        'node',
        '-e',
        "const p = require('@op-nx/polyrepo'); console.log(JSON.stringify({ hasDefault: !!p.default, hasPreTasks: typeof p.preTasksExecution === 'function', defaultHasPreTasks: typeof p.default?.preTasksExecution === 'function' }))",
      ],
      { workingDir: '/workspace' },
    );

    expect(result.exitCode).toBe(0);

    const exports: {
      hasDefault: boolean;
      hasPreTasks: boolean;
      defaultHasPreTasks: boolean;
    } = JSON.parse(result.stdout.trim());

    // preTasksExecution must be exported (either directly or via default)
    expect(
      exports.hasPreTasks || exports.defaultHasPreTasks,
      'preTasksExecution should be exported from the compiled plugin',
    ).toBe(true);
  }, 300_000);
});
