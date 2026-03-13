import nx from '@nx/eslint-plugin';
import tseslint from 'typescript-eslint';
import eslintComments from '@eslint-community/eslint-plugin-eslint-comments/configs';
import vitest from '@vitest/eslint-plugin';

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
    },
  },
  {
    files: ['**/*.spec.ts', '**/*.test.ts'],
    ...vitest.configs.all,
    rules: {
      ...Object.fromEntries(
        Object.entries(vitest.configs.all.rules).map(([k, v]) => [
          k,
          Array.isArray(v) ? ['error', ...v.slice(1)] : 'error',
        ]),
      ),
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
      // Mutually exclusive pair — we use explicit imports from 'vitest'
      'vitest/no-importing-vitest-globals': 'off',
      'vitest/prefer-importing-vitest-globals': 'off',
      // Superseded by prefer-strict-boolean-matchers (stricter)
      'vitest/prefer-to-be-truthy': 'off',
      'vitest/prefer-to-be-falsy': 'off',
      // Vitest handles timeouts via testTimeout config; per-test timeouts add noise
      'vitest/require-test-timeout': 'off',
      // Mutually exclusive pair — prefer-called-times (toHaveBeenCalledTimes(1)) wins
      'vitest/prefer-called-once': 'off',
      // toHaveBeenCalled() is valid when exact args aren't relevant to the test
      'vitest/prefer-called-with': 'off',
      // vi.mock(import('...')) causes TS errors with partial mock factories
      'vitest/prefer-import-in-mock': 'off',
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/restrict-template-expressions': 'off',
    },
  },
];
