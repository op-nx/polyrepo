import { defineConfig } from 'vitest/config';

export default defineConfig(() => ({
  root: __dirname,
  cacheDir: '../../node_modules/.vite/packages/nx-openpolyrepo-e2e',
  test: {
    name: 'nx-openpolyrepo-e2e',
    watch: false,
    globals: true,
    environment: 'node',
    include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    reporters: ['default'],
    testTimeout: 300_000,
    hookTimeout: 300_000,
    globalSetup: ['../../tools/scripts/start-local-registry.ts'],
    globalTeardown: ['../../tools/scripts/stop-local-registry.ts'],
    pool: 'forks',
    maxWorkers: 1,
    coverage: {
      reportsDirectory: './test-output/vitest/coverage',
      provider: 'v8' as const,
    },
  },
}));
