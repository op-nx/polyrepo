import nx from '@nx/eslint-plugin';
import tseslint from 'typescript-eslint';
import eslintComments from '@eslint-community/eslint-plugin-eslint-comments/configs';
import vitest from '@vitest/eslint-plugin';

export const opNxE2e = [
  {
    files: ['**/*.spec.ts'],
    rules: {
      'vitest/no-hooks': 'off',
      'vitest/no-duplicate-hooks': 'error',
      'vitest/prefer-hooks-in-order': 'error',
      'vitest/prefer-hooks-on-top': 'error',
      'vitest/expect-expect': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
    },
  },
];

export default [
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  ...nx.configs['flat/javascript'],
  ...tseslint.configs.strictTypeCheckedOnly,
  ...tseslint.configs.stylisticTypeCheckedOnly,
  eslintComments.recommended,
  {
    ignores: ['**/dist', '**/out-tsc', '.repos/**'],
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.cts', '**/*.mts'],
    languageOptions: {
      parserOptions: {
        projectService: true,
      },
    },
  },
  {
    files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.cts', '**/*.mts'],
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: true,
          allow: ['^.*/eslint(\\.base)?\\.config\\.[cm]?[jt]s$'],
          depConstraints: [
            {
              sourceTag: '*',
              onlyDependOnLibsWithTags: ['*'],
            },
          ],
        },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/consistent-type-assertions': [
        'error',
        { assertionStyle: 'never' },
      ],
      '@eslint-community/eslint-comments/require-description': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/consistent-type-exports': [
        'error',
        { fixMixedExportsWithInlineTypeSpecifier: true },
      ],
      '@typescript-eslint/consistent-type-definitions': ['error', 'interface'],
      '@typescript-eslint/explicit-function-return-type': [
        'error',
        {
          allowExpressions: true,
          allowTypedFunctionExpressions: true,
          allowHigherOrderFunctions: true,
        },
      ],
      // stylisticTypeCheckedOnly enables this, but its auto-fix produces x!
      // which violates no-non-null-assertion, and consistent-type-assertions
      // with assertionStyle: 'never' already bans all as-casts
      '@typescript-eslint/non-nullable-type-assertion-style': 'off',
    },
  },
  {
    files: ['**/*.spec.ts', '**/*.test.ts'],
    ...vitest.configs.recommended,
    rules: {
      ...vitest.configs.recommended.rules,
      // --- Promoted from warn to error (beyond recommended) ---
      'vitest/consistent-each-for': 'error',
      'vitest/consistent-test-it': 'error',
      'vitest/consistent-vitest-vi': 'error',
      'vitest/hoisted-apis-on-top': 'error',
      'vitest/max-nested-describe': 'error',
      'vitest/no-alias-methods': 'error',
      'vitest/no-conditional-in-test': 'error',
      'vitest/no-conditional-tests': 'error',
      'vitest/no-disabled-tests': 'error',
      'vitest/no-duplicate-hooks': 'off', // superseded by no-hooks; re-enabled in opNxE2e
      'vitest/no-large-snapshots': 'error',
      'vitest/no-restricted-matchers': 'error',
      'vitest/no-restricted-vi-methods': 'error',
      'vitest/no-test-prefixes': 'error',
      'vitest/no-test-return-statement': 'error',
      'vitest/padding-around-all': 'error',
      'vitest/prefer-comparison-matcher': 'error',
      'vitest/prefer-describe-function-title': 'error',
      'vitest/prefer-each': 'error',
      'vitest/prefer-equality-matcher': 'error',
      'vitest/prefer-expect-resolves': 'error',
      'vitest/prefer-expect-type-of': 'error',
      'vitest/prefer-hooks-in-order': 'off', // superseded by no-hooks; re-enabled in opNxE2e
      'vitest/prefer-hooks-on-top': 'off', // superseded by no-hooks; re-enabled in opNxE2e
      'vitest/prefer-lowercase-title': 'error',
      'vitest/prefer-mock-promise-shorthand': 'error',
      'vitest/prefer-snapshot-hint': 'error',
      'vitest/prefer-spy-on': 'error',
      'vitest/prefer-strict-boolean-matchers': 'error',
      'vitest/prefer-strict-equal': 'error',
      'vitest/prefer-to-be': 'error',
      'vitest/prefer-to-be-object': 'error',
      'vitest/prefer-to-contain': 'error',
      'vitest/prefer-to-have-been-called-times': 'error',
      'vitest/prefer-to-have-length': 'error',
      'vitest/prefer-todo': 'error',
      'vitest/prefer-vi-mocked': 'error',
      'vitest/require-awaited-expect-poll': 'error',
      'vitest/require-mock-type-parameters': 'error',
      'vitest/require-to-throw-message': 'error',
      'vitest/require-top-level-describe': 'error',
      // --- Custom-configured rules ---
      'vitest/no-hooks': 'error',
      'vitest/valid-title': ['error', { allowArguments: true }],
      'vitest/prefer-expect-assertions': [
        'error',
        { onlyFunctionsWithAsyncKeyword: true },
      ],
      'vitest/max-expects': ['error', { max: 10 }],
      'vitest/consistent-test-filename': [
        'error',
        { pattern: '.*\\.spec\\.[tj]sx?$' },
      ],
      // --- TypeScript rule relaxations for test files ---
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/restrict-template-expressions': 'off',
    },
  },
];
