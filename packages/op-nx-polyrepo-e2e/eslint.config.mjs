import baseConfig from '../../eslint.config.mjs';

export default [
  ...baseConfig,
  {
    // e2e tests use beforeAll/afterAll for workspace lifecycle and execSync for assertions
    files: ['**/*.spec.ts'],
    rules: {
      'vitest/no-hooks': 'off',
      'vitest/expect-expect': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
    },
  },
];
