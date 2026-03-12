# Quick Task 6: Ban as-type assertions via lint rule

## Result: Complete

## Research Findings

- `@typescript-eslint/consistent-type-assertions` with `assertionStyle: 'never'` is the correct rule
- No dedicated "prefer satisfies" rule exists — typescript-eslint closed #10027 and #8900 as wontfix
- `eslint-plugin-no-type-assertion` (3rd party) does the same thing, no added value
- `no-restricted-syntax` with `TSAsExpression` AST selector is an alternative but unnecessary when banning all `as`

## Changes

### eslint.config.mjs
- Added `@typescript-eslint/consistent-type-assertions: ['error', { assertionStyle: 'never' }]`

### Production code (0 eslint-disable annotations)
- `extract.ts`: `JSON.parse() as Type` replaced with `: Type` annotation
- `extract.ts`: `(error as Error).message` replaced with `instanceof` narrowing
- `status/executor.ts`: Removed unnecessary `as const` from typed object literals
- `index.ts`: `node.projectType as 'application' | 'library'` replaced with `toProjectType()` runtime validator

### Test code (eslint-disable only for overloaded function mocks)
- `Error as ExecException` replaced with `: ExecException` annotation (all fields optional)
- `Error as ExecFileException` replaced with `createExecError()` helper functions
- `{} as ExecutorContext` replaced with full required-field constructors
- `string as unknown as string` nonsensical casts removed
- `as typeof exec/execFile` on mock implementations: eslint-disable (overloaded function limitation)

### E2E
- `err as { ... }` replaced with `instanceof`/`in` narrowing
- `(p as { plugin: string }).plugin` replaced with `in` operator narrowing

## Commits
- `ba4167f` — remove as-casts from production code (status/executor.ts, extract.ts)
- `919640b` — replace as-cast with runtime validation in index.ts
- `eabbc1f` — add lint rule and fix all test/e2e violations

## Verification
- `npm run lint` passes (zero warnings)
- `npm run test` passes (280 tests)
- `npm run typecheck` passes
- `npm run format:check` passes
- `npm exec nx lint op-nx-polyrepo-e2e` passes
