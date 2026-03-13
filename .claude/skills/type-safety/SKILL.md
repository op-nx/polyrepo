# Skill: Type Safety Patterns

## Trigger

This skill applies when:
- An AI agent encounters ESLint errors for banned patterns (`as` assertions, `any`, non-null assertions, test hooks)
- Writing new code in this project (production or test)
- Refactoring existing code to pass strict lint/typecheck rules

## Overview

This project enforces maximum type safety via:
- **ESLint `strict-type-checked`** preset from `typescript-eslint`
- **`assertionStyle: 'never'`** -- ALL `as` type assertions are banned (no exceptions in source code)
- **`no-explicit-any`** -- `any` type is banned everywhere
- **`no-non-null-assertion`** -- `!` postfix operator is banned
- **`noUncheckedIndexedAccess`** -- indexed access returns `T | undefined`
- **`noPropertyAccessFromIndexSignature`** -- index signatures require bracket notation
- **`vitest/no-hooks`** -- `beforeEach`, `afterEach`, `beforeAll`, `afterAll` are banned in tests

ESLint enforces these bans. This skill teaches the approved alternatives.

## Rule Index

| Rule File | What It Teaches | When to Use |
|-----------|----------------|-------------|
| [satisfies-patterns.md](rules/satisfies-patterns.md) | `satisfies` vs type annotation vs `as const satisfies` | Writing config objects, lookup tables, typed literals |
| [zod-validation.md](rules/zod-validation.md) | Zod `safeParse` at system boundaries | Any `JSON.parse`, API response, or file read |
| [typed-mocks.md](rules/typed-mocks.md) | Cast-free Vitest mock patterns | Writing or modifying test files |
| [sifer-pattern.md](rules/sifer-pattern.md) | SIFERS test setup replacing hooks | Writing `describe` blocks in test files |

## Quick Reference: Banned Pattern -> Approved Alternative

| Banned Pattern | ESLint Rule | Approved Alternative |
|---------------|------------|---------------------|
| `value as Type` | `consistent-type-assertions` | Type guards, `satisfies`, Zod validation |
| `value as unknown as Type` | `consistent-type-assertions` | Restructure code, typed factories |
| `value!` | `no-non-null-assertion` | Optional chaining `?.`, undefined guards, `assertDefined()` |
| `any` | `no-explicit-any` | `unknown` + type guards, generic `<T>` |
| `obj.prop` on index sig | `noPropertyAccessFromIndexSignature` | `obj['prop']` bracket notation |
| `arr[i]` used directly | `noUncheckedIndexedAccess` | `const val = arr[i]; if (val !== undefined) { ... }` |
| `beforeEach(() => { ... })` | `vitest/no-hooks` | SIFERS `setup()` function pattern |
| `// eslint-disable ...` | `require-description` | Fix the violation; if truly needed, add description |

## ESLint Config Reference

The enforcement rules live in `eslint.config.mjs`:
- **Production files** (`**/*.ts`): Full `strictTypeCheckedOnly` + `stylisticTypeCheckedOnly`
- **Test files** (`**/*.spec.ts`): Same + `vitest.configs.all` with `no-hooks: error`
- **JS files** (`**/*.js`, `**/*.mjs`): Type-checked rules disabled via `disableTypeChecked`

## Key Project Files Demonstrating Patterns

- `src/lib/graph/types.ts` -- Zod schemas with `z.infer` type derivation
- `src/lib/graph/transform.ts` -- `isRecord` type guards for `unknown` narrowing
- `src/lib/config/resolve.ts` -- Zod `safeParse` at JSON.parse boundary
- `src/lib/testing/asserts.ts` -- `assertDefined` utility for index access
- `src/lib/testing/mock-child-process.ts` -- Encapsulated factory with sole type assertion
- `src/lib/git/detect.spec.ts` -- SIFERS pattern with `satisfies` for stubs
- `src/lib/graph/cache.spec.ts` -- Async SIFERS with `vi.mocked()` pattern
