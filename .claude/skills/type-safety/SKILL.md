---
name: type-safety
description: "Project-specific type safety patterns and alternatives to banned TypeScript constructs. Use this skill whenever writing or modifying TypeScript code in this project, especially when encountering ESLint errors for: `as` type assertions (assertionStyle: 'never'), `any` type, non-null assertions (`!`), test hooks (beforeEach/afterEach), or consistent-type-imports. Covers: `satisfies` vs type annotations, Zod `safeParse` at system boundaries, SIFERS test setup pattern replacing hooks, cast-free Vitest mock patterns with `vi.mocked()`, custom type guards for `unknown` narrowing, and `assertDefined()` for checked index access."
---

# Type Safety Patterns

## Overview

This project enforces maximum type safety via ESLint and tsconfig rules. Every `as` cast, `any` type, non-null assertion, and test hook produces a lint error that blocks the build. This skill teaches the approved alternatives so you write code that passes on the first attempt.

**Enforced rules:**
- **`assertionStyle: 'never'`** -- ALL `as` type assertions are banned (no exceptions in source code; `as const` is the sole permitted usage)
- **`no-explicit-any`** -- `any` type is banned everywhere
- **`no-non-null-assertion`** -- `!` postfix operator is banned
- **`non-nullable-type-assertion-style: off`** -- disabled because its auto-fix produces `x!`, violating `no-non-null-assertion`
- **`noUncheckedIndexedAccess`** -- indexed access returns `T | undefined`
- **`noPropertyAccessFromIndexSignature`** -- index signatures require bracket notation
- **`consistent-type-imports`** -- use `import type` / `import { type Foo }` for type-only imports
- **`consistent-type-exports`** -- use inline `export { type Foo }` for type-only re-exports
- **`consistent-type-definitions`** -- prefer `interface` over `type` for object shapes
- **`explicit-function-return-type`** -- exported functions must declare return types (with `allowExpressions`, `allowTypedFunctionExpressions`, `allowHigherOrderFunctions`)
- **`vitest/no-hooks`** -- `beforeEach`, `afterEach`, `beforeAll`, `afterAll` are banned in tests
- **`eslint-comments/require-description`** -- every `eslint-disable` comment must explain why

## Rule Index

| Rule File | What It Teaches | When to Use |
|-----------|----------------|-------------|
| [satisfies-patterns.md](rules/satisfies-patterns.md) | `satisfies` vs type annotation vs `as const satisfies` | Writing config objects, lookup tables, typed literals |
| [zod-validation.md](rules/zod-validation.md) | Zod `safeParse` at system boundaries | Any `JSON.parse`, API response, or file read |
| [typed-mocks.md](rules/typed-mocks.md) | Cast-free Vitest mock patterns, custom type guards | Writing or modifying test files, narrowing `unknown` without casts |
| [sifers-pattern.md](rules/sifers-pattern.md) | SIFERS test setup replacing hooks | Writing `describe` blocks in test files |

## Quick Reference: Banned Pattern -> Approved Alternative

| Banned Pattern | ESLint Rule | Approved Alternative |
|---------------|------------|---------------------|
| `value as Type` | `consistent-type-assertions` | Type guards, `satisfies`, Zod validation |
| `value as unknown as Type` | `consistent-type-assertions` | Restructure code, typed factories |
| `value!` | `no-non-null-assertion` | Optional chaining `?.`, undefined guards, `assertDefined()` |
| `any` | `no-explicit-any` | `unknown` + type guards (`isRecord()`), generic `<T>` |
| `type Foo = { ... }` | `consistent-type-definitions` | `interface Foo { ... }` (prefer interface for objects) |
| `import { Foo } from './m'` (type-only) | `consistent-type-imports` | `import { type Foo } from './m'` |
| `obj.prop` on index sig | `noPropertyAccessFromIndexSignature` | `obj['prop']` bracket notation |
| `arr[i]` used directly | `noUncheckedIndexedAccess` | `const val = arr[i]; if (val !== undefined) { ... }` |
| `beforeEach(() => { ... })` | `vitest/no-hooks` | SIFERS `setup()` function pattern |
| `// eslint-disable ...` | `require-description` | Fix the violation; if truly needed, add description |

## ESLint Config Reference

The enforcement rules live in `eslint.config.mjs`:
- **Production files** (`**/*.ts`): Full `strictTypeCheckedOnly` + `stylisticTypeCheckedOnly` + custom rules (type imports/exports, interface preference, return types, assertion ban)
- **Test files** (`**/*.spec.ts`): `vitest.configs.recommended` with 30+ rules individually promoted to error (including `no-hooks`); `explicit-function-return-type` is relaxed for test files
- **JS files** (`**/*.js`, `**/*.mjs`): Type-checked rules disabled via `disableTypeChecked`

## Key Project Files Demonstrating Patterns

- `src/lib/graph/types.ts` -- Zod schemas with `z.infer` type derivation
- `src/lib/graph/transform.ts` -- `isRecord`/`isRecordOfRecords` custom type guards for `unknown` narrowing
- `src/lib/config/schema.ts` -- Zod schema composition with `.strict()`, `.refine()`, `.check()`, and discriminated unions
- `src/lib/config/validate.ts` -- Zod `safeParse` for config validation with descriptive errors
- `src/lib/config/resolve.ts` -- Zod `safeParse` at JSON.parse boundary with `.loose()` for partial validation
- `src/lib/testing/asserts.ts` -- `assertDefined` utility for index access
- `src/lib/testing/mock-child-process.ts` -- Encapsulated factory with sole type assertion
- `src/lib/git/detect.spec.ts` -- SIFERS pattern with `satisfies` for stubs
- `src/lib/graph/cache.spec.ts` -- Async SIFERS with `vi.mocked()` pattern
