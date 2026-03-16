import { defineConfig } from 'vitest/config';

export default defineConfig(() => ({
  root: __dirname,
  cacheDir: '../../node_modules/.vite/packages/op-nx-polyrepo-e2e',
  test: {
    name: 'op-nx-polyrepo-e2e',
    watch: false,
    globals: true,
    environment: 'node',
    include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    reporters: ['default'],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    globalSetup: ['./src/setup/global-setup.ts'],
    pool: 'forks',
    maxWorkers: 1,
    coverage: {
      reportsDirectory: './test-output/vitest/coverage',
      provider: 'v8' as const,
    },
  },
}));
