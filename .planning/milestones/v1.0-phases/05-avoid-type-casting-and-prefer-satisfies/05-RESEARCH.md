# Phase 5: Maximum Type Safety - Research

**Researched:** 2026-03-12
**Domain:** TypeScript type safety, ESLint strict presets, Vitest typed mocking, Zod validation, SIFER test patterns
**Confidence:** HIGH

## Summary

This phase hardens an Nx plugin TypeScript codebase (~15 source files, ~8 test files) for maximum type safety. The codebase already has `strict: true` in tsconfig and `consistent-type-assertions: never` enforced by ESLint, but relies on ~20 `eslint-disable` comments in test files to suppress cast violations. There are 3 unvalidated `JSON.parse` sites, no type-checked ESLint rules, and tests use `beforeEach` hooks rather than the SIFER pattern.

The research covers seven interconnected domains: (1) eliminating overloaded function mock casts via Vitest 4.x APIs, (2) replacing `JSON.parse` type annotations with Zod schemas, (3) upgrading ESLint from `recommended` to `strict-type-checked`, (4) hardening tsconfig with flags beyond `strict: true`, (5) adopting `satisfies` and `as const` patterns, (6) refactoring tests to SIFERs, and (7) setting up enforcement via skills and hooks.

**Primary recommendation:** Split into 4-5 sub-phases: ESLint/tsconfig hardening first (enables detection), then type-casting elimination (mocks + JSON.parse), then test SIFER refactoring, then skill creation. All changes land in one pass -- no eslint-disable comments remain.

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions

- Ban all `as` type assertions (already enforced by `consistent-type-assertions: never`)
- Eliminate ALL existing `eslint-disable` comments for type casting rules -- find proper solutions, not suppressions
- Research how to mock overloaded functions (e.g., `execFile`) in Vitest without `as` casts -- do NOT add dependency injection through function parameters just for testing
- Research `vi.fn<T>()` generics, `vi.mocked()`, `MockedFunction`, `MockedObject` for cast-free mocking
- For partial test objects (e.g., `ExecutorContext`), research alternatives; fall back to factory functions with full defaults if no better solution exists
- For stub objects (`{} as never`), research alternatives; factory or minimal valid objects as fallback
- Research best practices for `satisfies` vs type annotation -- keep "satisfies when narrow type matters" in mind
- Include `as const` in research -- understand interaction with `consistent-type-assertions` rule (`allowAsConst` option)
- Return type annotation preferred over `satisfies` on return expressions for exported functions
- Research `satisfies SomeType as const` (TS 5.0+) patterns
- Research excess property checking behavior -- `satisfies` catches excess properties that type annotations miss on intermediate values
- Ban `any` via `no-explicit-any` -- use `unknown` and narrow instead
- Research the full `no-unsafe-*` rule family: `no-unsafe-assignment`, `no-unsafe-member-access`, `no-unsafe-call`, `no-unsafe-return`, `no-unsafe-argument`
- The stricter, the better -- don't worry about impact, harden now while codebase is small
- Zod at ALL system boundaries -- validate all `JSON.parse` results (3 sites: resolve.ts, executor.ts, extract.ts)
- Prefer `Zod.safeParse()` as type guard over hand-written type guards
- Research when `asserts` functions add value over Zod -- fall back to preferring Zod
- Research DDD value types with Zod validation in constructors (e.g., `GitUrl.parse()`)
- Audit ALL ESLint plugins for strictest available presets
- Research compatibility between Nx's `flat/typescript` preset and typescript-eslint's `strict-type-checked`
- ALL rules at severity `warn` in current/added presets must be promoted to `error`
- Accept type-checked lint performance cost -- codebase is small, Nx parallelizes per project
- Research `eslint-plugin-vitest` -- adopt strictest preset
- Research configurable rules (AST selectors, regex patterns) before creating custom rules
- Only create custom workspace rules (`@nx/eslint:workspace-rule`) for clear gaps after full audit
- Look for stricter presets in ALL direct and transitive ESLint plugin dependencies
- Audit tsconfig against official TypeScript reference for recommended strict flags
- Research flags beyond `strict: true`: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noPropertyAccessFromIndexSignature`
- Research totality plugins (`eslint-plugin-total-functions`, `eslint-plugin-functional`) -- prefer TSConfig options
- Verify `strictPropertyInitialization` is enabled (important for DDD value type classes)
- Prefer `interface` over `type` for object shapes (research `consistent-type-definitions` rule)
- Prefer string literal unions over enums -- ban enums, `as const` objects only when runtime access to values is needed
- Enforce `import type` for type-only imports (`consistent-type-imports`)
- Enforce `export type` for type-only exports (`consistent-type-exports`)
- Explicit return types on production code; inferred allowed in test SIFERs
- Ban non-null assertions (`!`) via `no-non-null-assertion`
- Research `Readonly<T>`, `ReadonlyArray<T>`, immutability patterns for config objects and parameters
- Research generic constraints, utility types (`Pick`, `Omit`, `Required`, etc.) for precise types
- Research template literal types for string patterns (namespaced project names, git refs, cache keys)
- Research Zod-inferred types as single source of truth (`z.infer<>`, `z.input<>`) instead of separate interfaces
- Research discriminated unions vs DDD patterns
- Research `no-floating-promises`, `no-misused-promises` (included in `strict-type-checked`)
- Research Promise rejection typing and `useUnknownInCatchVariables`
- Adopt SIFERs across all test files
- Research lint rules enforcing SIFERs / preventing `beforeEach`/`afterEach` hooks (`vitest/no-hooks`)
- Prefer simple factory functions for test data; builder pattern only when factory doesn't cover the case
- Research Vitest strict config: `typecheck.enabled`, `typecheck.checker`, strict assertion typing
- Test files strict by default -- research which specific rules to relax in `.spec.ts` (configure as file-level overrides, NOT eslint-disable comments)
- Create project-local skills via `/skill-creator` with evals/benchmarks
- Skills teach HOW to resolve ESLint rule bans (satisfies patterns, Zod validation, value types, typed mocks)
- Do NOT add type safety rules to AGENTS.md -- ESLint enforces bans, skills teach alternatives
- Research Claude Code Stop hook vs Git pre-commit hook for lint enforcement
- Everything done in this phase, split into incremental sub-phases (decimal phases: 5.1, 5.2, etc.)
- Planner determines sub-phase split after research
- All at once: enable all strict rules and fix ALL violations -- zero eslint-disable comments remaining

### Claude's Discretion

- Exact sub-phase boundaries after research
- Which Vitest mock API best eliminates each casting pattern
- Whether totality plugins add value beyond TSConfig options
- Specific custom rules (if any) after gap analysis
- Skill content structure and trigger design

### Deferred Ideas (OUT OF SCOPE)

- **Biome/oxlint migration** -- faster linters as future option when codebase grows; current performance is acceptable
- **Best practices guide for human contributors** -- written documentation beyond AI skills; evaluate after skills are created
- **Promote skills to global plugin** -- start project-local, promote once proven via evals
  </user_constraints>

## Standard Stack

### Core (already installed)

| Library           | Version | Purpose               | Why Standard                                                                           |
| ----------------- | ------- | --------------------- | -------------------------------------------------------------------------------------- |
| typescript        | 5.9.3   | Compiler              | Current stable; supports `satisfies`, `as const satisfies`, `noUncheckedIndexedAccess` |
| typescript-eslint | 8.57.0  | ESLint parser/plugin  | Provides `strictTypeChecked` preset with 40+ rules                                     |
| eslint            | 9.39.4  | Linter                | Flat config native support                                                             |
| zod               | 4.3.6   | Schema validation     | Already in prod deps; `safeParse` as type guard                                        |
| vitest            | 4.0.18  | Test runner           | Overloaded function mock fix (v2.0.4+) included                                        |
| @nx/eslint-plugin | 22.5.4  | Nx ESLint integration | `flat/typescript` uses `recommended`; we layer on top                                  |

### To Install

| Library               | Version | Purpose           | When to Use                                               |
| --------------------- | ------- | ----------------- | --------------------------------------------------------- |
| @vitest/eslint-plugin | latest  | Vitest lint rules | `all` preset + promote to `error` + `no-hooks` for SIFERs |

### Not Needed

| Instead of                 | Don't Use                     | Reason                                                                                              |
| -------------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------- |
| `noUncheckedIndexedAccess` | eslint-plugin-total-functions | TSConfig flag covers the same ground; plugin adds 3K weekly downloads dependency for marginal value |
| `noUncheckedIndexedAccess` | eslint-plugin-functional      | Too opinionated (bans mutation entirely); overkill for an Nx plugin project                         |

**Installation:**

```bash
npm install --save-dev @vitest/eslint-plugin
```

## Architecture Patterns

### ESLint Config Architecture

The current `eslint.config.mjs` uses `@nx/eslint-plugin`'s `flat/typescript` which internally applies `typescript-eslint.configs.recommended`. To upgrade to `strict-type-checked`, we must layer the `strictTypeCheckedOnly` config ON TOP of Nx's config (not replace it, to preserve Nx-specific rules).

**Key insight:** Nx's `flat/typescript` sets `no-explicit-any: 'warn'`, `no-non-null-assertion: 'warn'`, and `no-unused-vars: 'warn'`. The `strictTypeChecked` preset sets these to `error`. Our config must override all `warn` rules to `error` last.

**Config layering order:**

1. `nx.configs['flat/base']` -- registers @nx plugin
2. `nx.configs['flat/typescript']` -- recommended + Nx overrides
3. `nx.configs['flat/javascript']` -- JS-specific
4. `tseslint.configs.strictTypeCheckedOnly` -- adds strict type-checked rules without re-declaring base rules
5. `tseslint.configs.stylisticTypeCheckedOnly` -- adds stylistic type-checked rules
6. `eslintComments.recommended` -- eslint-comments plugin
7. `vitest.configs.all` -- vitest rules (scoped to `**/*.spec.ts`)
8. `tseslint.configs.disableTypeChecked` -- for JS files
9. Custom overrides (promote all `warn` to `error`, project-specific rules)

**Critical: `parserOptions.projectService: true`** must be set for type-checked rules to work. This tells typescript-eslint to use TypeScript's project service for type information.

### TSConfig Hardening

Current `tsconfig.base.json` already has `strict: true` which enables:

- `strictNullChecks`, `strictFunctionTypes`, `strictBindCallApply`, `strictPropertyInitialization`
- `noImplicitThis`, `noImplicitAny`, `alwaysStrict`, `useUnknownInCatchVariables`

Also already enabled: `noFallthroughCasesInSwitch`, `noImplicitOverride`, `noImplicitReturns`, `noUnusedLocals`.

**Flags to add:**
| Flag | Effect | Risk |
|------|--------|------|
| `noUncheckedIndexedAccess` | `Record` and array indexing returns `T \| undefined` | May require null checks on array access; TS 5.9 `tsc --init` includes this by default |
| `exactOptionalPropertyTypes` | `foo?: string` means "missing OR string", NOT "undefined OR string" | Requires explicit `undefined` when assigning; TS 5.9 `tsc --init` includes this |
| `noPropertyAccessFromIndexSignature` | Forces bracket notation for index signature access | Clarifies intent; makes dynamic vs static access explicit |

**`strictPropertyInitialization` is already enabled** via `strict: true`. Confirmed.

### Zod Validation at System Boundaries

Three `JSON.parse` sites need Zod schemas:

1. **`resolve.ts:17`** -- `JSON.parse(readFileSync(nxJsonPath))` typed as `NxJsonConfiguration`
   - Create a minimal schema for the plugin-relevant subset of `NxJsonConfiguration`
   - Only need: `plugins` array with `plugin` string and `options` object
   - Use `z.safeParse()` -- throw descriptive error on failure

2. **`extract.ts:64`** -- `JSON.parse(jsonPayload)` typed as `ExternalGraphJson`
   - Create schema matching `ExternalGraphJson` interface
   - Already in a try/catch; replace with `safeParse` for type safety

3. **`executor.ts:51`** -- `JSON.parse(readFileSync(pkgJsonPath))` for package.json
   - Minimal schema: just `packageManager` field (string, optional)
   - Use `safeParse` with fallback

**Pattern:**

```typescript
// Source: Zod v4 docs - https://zod.dev/basics
const result = ExternalGraphJsonSchema.safeParse(JSON.parse(jsonPayload));

if (!result.success) {
  throw new Error(
    `Invalid graph JSON from ${repoPath}: ${result.error.message}`,
  );
}

// result.data is fully typed as ExternalGraphJson
resolve(result.data);
```

### Vitest Mock Patterns (Cast-Free)

**Finding:** Vitest 4.0.18 includes the overloaded function mock fix from PR #6181 (merged v2.0.4). The fix normalizes `MockInstance<T>` to `(...args: Parameters<T>) => ReturnType<T>`, which resolves to the **last overload signature** of the function.

**For `execFile` and `exec` overloaded function mocks**, there are two strategies:

#### Strategy A: Test if fix is sufficient (HIGH confidence)

With Vitest 4.0.18, `vi.mocked(execFile).mockImplementation(fn)` may work without casting if the implementation matches the last overload signature. The overloaded `exec`/`execFile` functions have the callback variant as the last overload, which is exactly what our tests use.

**Action:** Try removing `as typeof execFile` casts and run `npm exec nx typecheck @op-nx/polyrepo`. If it compiles, the fix resolves the issue.

#### Strategy B: Wrapper function approach (fallback)

If Strategy A fails, create a typed mock helper:

```typescript
function mockExecFileCallback(
  impl: (
    file: string,
    args: readonly string[],
    options: unknown,
    callback?: (
      error: ExecFileException | null,
      stdout: string,
      stderr: string,
    ) => void,
  ) => void,
): void {
  mockExecFile.mockImplementation(impl);
}
```

This avoids the cast by typing the parameter explicitly and letting TypeScript infer assignability.

#### For partial `ExecutorContext` objects

Use factory function with full defaults:

```typescript
function createTestContext(
  overrides: Partial<ExecutorContext> = {},
): ExecutorContext {
  return {
    root: '/workspace',
    cwd: '/workspace',
    isVerbose: false,
    projectsConfigurations: { version: 2, projects: {} },
    nxJsonConfiguration: {},
    projectGraph: { nodes: {}, dependencies: {} },
    ...overrides,
  };
}
```

#### For stub objects (`{} as never`)

Replace with minimal valid objects. For graph node stubs not inspected by SUT, create a factory:

```typescript
function createStubNode(name: string): TransformedNode {
  return {
    name,
    root: `libs/${name}`,
    targets: {},
    tags: [],
  };
}
```

#### For `EventEmitter as ChildProcess` pattern

This is the hardest cast to eliminate. The `spawn` return type (`ChildProcess`) has many required properties. Options:

1. **`Object.create(EventEmitter.prototype)`** with `Object.defineProperties` for required fields (already partially done)
2. **Vitest's `vi.fn()` returning a mock ChildProcess** -- define the full shape upfront
3. **Accept a scoped override in ESLint config for test files** for this specific pattern -- the `ChildProcess` type has 20+ required properties and creating all of them is pure busywork

**Recommendation:** Create a `createMockChildProcess` factory returning a fully-typed object. The current code already does most of this with `Object.defineProperty`. Restructure it to construct the object with all properties upfront rather than mutating after cast.

### SIFER Pattern

**Source:** [Testing With SIFERS by Moshe Kolodny](https://medium.com/@kolodny/testing-with-sifers-c9d6bb5b362)

SIFERs (Simple Injectable Functions Explicitly Returning State) replace `beforeEach` setup with explicit setup functions:

```typescript
// BEFORE: beforeEach with shared mutable state
let mockExec: MockedFunction<typeof exec>;
beforeEach(() => {
  vi.clearAllMocks();
  mockExec = vi.mocked(exec);
});

// AFTER: SIFER pattern
function setup(overrides?: { stdout?: string }) {
  vi.clearAllMocks();
  const mockExec = vi.mocked(exec);
  setupExecSuccess(overrides?.stdout ?? '{}');

  return { mockExec };
}

it('calls exec with correct args', () => {
  const { mockExec } = setup();
  // ... test logic ...
});
```

**Key principles:**

- Each test calls `setup()` explicitly -- no hidden state
- Setup function returns all mutable state the test needs
- Injectable parameters allow per-test customization
- `vi.clearAllMocks()` moves inside setup, not `beforeEach`

**Enforcement:** `@vitest/eslint-plugin` `no-hooks` rule bans `beforeEach`/`afterEach`/`beforeAll`/`afterAll`. Configure with `{ allow: [] }` for full ban.

### `satisfies` vs Type Annotation Decision Tree

```
Need the VALUE to keep its narrow/literal type?
  YES --> use `satisfies`
    Need it readonly too? --> `as const satisfies Type`
  NO --> use type annotation (`: Type`)

Exported function return?
  --> Always use return type annotation (`: ReturnType`)

Config object / lookup table?
  --> `as const satisfies Shape` (preserves literal types + validates shape)

Intermediate value passed to typed function?
  --> `satisfies` catches excess properties that annotations miss
```

### Anti-Patterns to Avoid

- **`as` type assertions anywhere** -- already banned, but ensure zero eslint-disable overrides
- **`any` type anywhere** -- use `unknown` and narrow; `no-explicit-any` + `no-unsafe-*` family
- **`!` non-null assertions** -- use narrowing or optional chaining
- **Enum declarations** -- use string literal unions; `as const` objects only for runtime value iteration
- **`beforeEach`/`afterEach` in tests** -- use SIFER setup functions

## Don't Hand-Roll

| Problem                 | Don't Build                           | Use Instead                                                                             | Why                                               |
| ----------------------- | ------------------------------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------- |
| JSON.parse type safety  | Type annotation after parse           | Zod `safeParse()`                                                                       | Runtime validation + type inference in one call   |
| Config validation       | Custom type guards                    | Zod schemas (already exist in `schema.ts`)                                              | Zod handles nested objects, unions, defaults      |
| Overloaded mock typing  | Manual `as` cast workarounds          | `vi.mocked()` + Vitest 4.x type system                                                  | Fix landed in v2.0.4; mock types handle overloads |
| Test data factories     | Inline object construction with casts | Shared factory functions per type                                                       | Single source of truth for required fields        |
| ESLint rule enforcement | AGENTS.md instructions                | ESLint config + lint CI check                                                           | "Never send an LLM to do a linter's job"          |
| Type-safe catch clauses | Manual `instanceof` checks            | `useUnknownInCatchVariables` (already enabled via `strict`) + Zod for structured errors | Compiler catches unsafe access automatically      |

**Key insight:** The codebase already has Zod as a production dependency with schemas in `schema.ts`. Extend this pattern to all `JSON.parse` boundaries rather than hand-writing type guards.

## Common Pitfalls

### Pitfall 1: Nx flat/typescript and strictTypeChecked conflict

**What goes wrong:** Using `tseslint.configs.strictTypeChecked` (not `...Only`) re-declares parser and plugin settings that Nx's `flat/typescript` already set, causing duplicate rule applications or config conflicts.
**Why it happens:** `strictTypeChecked` includes base recommended rules. Nx's preset also includes recommended.
**How to avoid:** Use `strictTypeCheckedOnly` and `stylisticTypeCheckedOnly` -- these add ONLY the additional rules, not the base recommended set.
**Warning signs:** Rules firing twice, unexpected severity levels, parser configuration warnings.

### Pitfall 2: Missing parserOptions.projectService

**What goes wrong:** Type-checked rules silently fall back to non-type-checked behavior or error with "you must configure parser options".
**Why it happens:** Nx's `flat/typescript` sets `tsconfigRootDir` but does NOT enable `projectService`.
**How to avoid:** Add `languageOptions: { parserOptions: { projectService: true } }` in the config.
**Warning signs:** Type-checked rules not catching obvious violations.

### Pitfall 3: Type-checked linting on JS files

**What goes wrong:** ESLint errors on `.js`/`.mjs` files: "no program found for file".
**Why it happens:** Type-checked rules require TypeScript programs; JS files are not included in tsconfig.
**How to avoid:** Add `tseslint.configs.disableTypeChecked` scoped to `['**/*.js', '**/*.mjs', '**/*.cjs']`.
**Warning signs:** Lint failures on `eslint.config.mjs` or other config files.

### Pitfall 4: `exactOptionalPropertyTypes` with Nx types

**What goes wrong:** Third-party types (e.g., `ExecutorContext`, `CreateNodesContextV2`) may use `property?: Type` where code assigns `undefined` explicitly.
**Why it happens:** `exactOptionalPropertyTypes` distinguishes "missing" from "undefined".
**How to avoid:** Test the flag incrementally. If third-party type conflicts arise, may need to omit this flag or use `Omit`/`Pick` utility types.
**Warning signs:** Type errors in code that interfaces with `@nx/devkit` types.

### Pitfall 5: `noUncheckedIndexedAccess` with Record iteration

**What goes wrong:** Every `Record<string, T>` access now returns `T | undefined`, requiring null checks even in `for...of Object.entries()` loops where the value is guaranteed.
**Why it happens:** TypeScript cannot narrow Record index access even after Object.entries().
**How to avoid:** Use destructuring in for-of loops: `for (const [key, value] of Object.entries(record))` -- the destructured `value` is `T`, not `T | undefined`. If this doesn't suffice, use a null assertion ONLY if the value existence is guaranteed by the iteration pattern, but prefer an `if` guard.
**Warning signs:** Excessive `!` assertions or unnecessary null checks.

### Pitfall 6: `vi.mocked()` + overloads resolves to LAST overload only

**What goes wrong:** `vi.mocked(execFile).mockImplementation(...)` resolves to the last overload signature of `execFile`, which may not match the overload your test actually uses.
**Why it happens:** TypeScript's `Parameters<T>` and `ReturnType<T>` only resolve the last overload.
**How to avoid:** Verify the callback-style overload is the last one for `exec`/`execFile`. If not, the wrapper function approach (Strategy B) is needed.
**Warning signs:** Type errors on `mockImplementation` even with Vitest 4.x.

## Code Examples

### ESLint Config Upgrade (Verified Pattern)

```typescript
// Source: typescript-eslint docs - https://typescript-eslint.io/users/configs/
// Source: Nx docs - https://nx.dev/docs/technologies/eslint/guides/eslint
import nx from '@nx/eslint-plugin';
import tseslint from 'typescript-eslint';
import eslintComments from '@eslint-community/eslint-plugin-eslint-comments/configs';
import vitest from '@vitest/eslint-plugin';

export default [
  ...nx.configs['flat/base'],
  ...nx.configs['flat/typescript'],
  ...nx.configs['flat/javascript'],
  // Layer strict type-checked rules ON TOP of Nx's recommended
  ...tseslint.configs.strictTypeCheckedOnly,
  ...tseslint.configs.stylisticTypeCheckedOnly,
  eslintComments.recommended,
  {
    ignores: ['**/dist', '**/out-tsc', '.repos/**'],
  },
  // Enable type-checking for TS files
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.cts', '**/*.mts'],
    languageOptions: {
      parserOptions: {
        projectService: true,
      },
    },
  },
  // Disable type-checked rules for JS files
  {
    files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
    ...tseslint.configs.disableTypeChecked,
  },
  // Vitest rules for test files
  {
    files: ['**/*.spec.ts', '**/*.test.ts'],
    ...vitest.configs.all,
    rules: {
      ...vitest.configs.all.rules,
      // Promote all vitest warn rules to error
      // Ban hooks for SIFER enforcement
      'vitest/no-hooks': 'error',
      // Allow inferred return types in test SIFERs
      '@typescript-eslint/explicit-function-return-type': 'off',
    },
  },
  // Project-wide overrides
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.cts', '**/*.mts'],
    rules: {
      // Promote Nx's warn-level rules to error
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      // Keep existing rules
      '@typescript-eslint/consistent-type-assertions': [
        'error',
        { assertionStyle: 'never' },
      ],
      '@eslint-community/eslint-comments/require-description': 'error',
      // Type safety rules
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
];
```

### TSConfig Hardening

```jsonc
// tsconfig.base.json additions
{
  "compilerOptions": {
    // ... existing strict: true and other flags ...
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noPropertyAccessFromIndexSignature": true,
  },
}
```

### Zod Schema for JSON.parse Validation

```typescript
// Source: Zod v4 docs - https://zod.dev/basics
import { z } from 'zod';

// For extract.ts -- ExternalGraphJson schema
const externalGraphJsonSchema = z.object({
  graph: z.object({
    nodes: z.record(
      z.string(),
      z.object({
        name: z.string(),
        type: z.string(),
        data: z.object({
          root: z.string(),
          targets: z.record(z.string(), z.unknown()).optional(),
          tags: z.array(z.string()).optional(),
          metadata: z.record(z.string(), z.unknown()).optional(),
          sourceRoot: z.string().optional(),
          projectType: z.string().optional(),
        }),
      }),
    ),
    dependencies: z.record(
      z.string(),
      z.array(
        z.object({
          source: z.string(),
          target: z.string(),
          type: z.string(),
        }),
      ),
    ),
  }),
});

// Usage -- replaces typed annotation
const result = externalGraphJsonSchema.safeParse(JSON.parse(jsonPayload));

if (!result.success) {
  throw new Error(
    `Invalid graph JSON from ${repoPath}: ${result.error.message}`,
  );
}

resolve(result.data);
```

### SIFER Test Refactoring

```typescript
// Source: https://medium.com/@kolodny/testing-with-sifers-c9d6bb5b362

// Factory for ExecutorContext (replaces partial cast)
function createTestContext(
  overrides: Partial<ExecutorContext> = {},
): ExecutorContext {
  return {
    root: '/workspace',
    cwd: '/workspace',
    isVerbose: false,
    projectsConfigurations: { version: 2, projects: {} },
    nxJsonConfiguration: {},
    projectGraph: { nodes: {}, dependencies: {} },
    ...overrides,
  };
}

// SIFER setup function (replaces beforeEach)
function setup(overrides?: { config?: PolyrepoConfig }) {
  vi.clearAllMocks();

  const context = createTestContext();
  const mockReadFileSync = vi.mocked(readFileSync);
  // ... configure mocks ...

  return { context, mockReadFileSync };
}

// Usage in tests
it('returns success when all repos sync', async () => {
  const { context } = setup();
  const result = await syncExecutor({}, context);
  expect(result.success).toBe(true);
});
```

### `as const` with `allowAsConst` Option

```typescript
// The consistent-type-assertions rule with assertionStyle: 'never' bans ALL as assertions,
// including `as const`. To allow `as const` specifically:
'@typescript-eslint/consistent-type-assertions': [
  'error',
  { assertionStyle: 'never', allowAsConst: true },
],

// Usage -- vitest.config.mts currently has `provider: 'v8' as const`
// With allowAsConst: true, this is permitted
// Alternatively, use satisfies: `provider: 'v8' satisfies 'v8'` (more verbose, same effect)
```

## State of the Art

| Old Approach                              | Current Approach                                                                   | When Changed                | Impact                                                   |
| ----------------------------------------- | ---------------------------------------------------------------------------------- | --------------------------- | -------------------------------------------------------- |
| `typescript-eslint recommended`           | `strict-type-checked`                                                              | typescript-eslint v6 (2023) | 40+ additional rules including no-unsafe-\* family       |
| `parserOptions.project`                   | `parserOptions.projectService`                                                     | typescript-eslint v8        | Faster type resolution, better monorepo support          |
| `eslint-plugin-vitest`                    | `@vitest/eslint-plugin`                                                            | 2024                        | Package renamed; old package redirects to new            |
| `tseslint.config()`                       | `defineConfig()` from eslint/config                                                | typescript-eslint v8+       | Deprecated in favor of ESLint core utility               |
| Vitest `MockInstance` breaks on overloads | Fixed `MockInstance`                                                               | Vitest 2.0.4 (Jul 2024)     | Overloaded function mocks work without casts             |
| `strict: true` is enough                  | TS 5.9 `tsc --init` adds `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` | TS 5.9 (2025)               | Official recognition these flags should be on by default |

**Deprecated/outdated:**

- `eslint-plugin-vitest` npm package -- renamed to `@vitest/eslint-plugin`
- `tseslint.config()` utility -- use `defineConfig()` from `eslint/config`

## Open Questions

1. **Vitest overloaded mock casting elimination -- does it actually compile?**
   - What we know: Vitest 4.0.18 includes the fix for `MockInstance<T>` with overloads (PR #6181). The fix resolves to the last overload signature.
   - What's unclear: Whether the `execFile` and `exec` callback overloads are the last signature. Node.js types typically declare callback variants last, which would make this work.
   - Recommendation: First task in the implementation should be a compile test -- remove one `as typeof execFile` cast and run typecheck. This determines Strategy A vs Strategy B for all ~12 overloaded mock casts.

2. **`exactOptionalPropertyTypes` compatibility with `@nx/devkit` types**
   - What we know: The flag enforces strict distinction between "missing" and "explicitly undefined".
   - What's unclear: Whether `@nx/devkit` types like `ExecutorContext`, `CreateNodesContextV2` assign `undefined` to optional properties internally.
   - Recommendation: Enable the flag and run typecheck. If third-party type conflicts arise, the flag can be dropped -- it's the most aggressive of the three new flags.

3. **DDD value types -- practical benefit vs ergonomic cost**
   - What we know: `normalizeGitUrl` is a pure function that could be encapsulated in a `GitUrl` value type. Zod can validate in constructors via `.transform()`.
   - What's unclear: Whether `.value` unwrapping throughout the codebase outweighs the safety benefit for a ~15-file codebase.
   - Recommendation: Research and prototype during implementation. If the ergonomic cost is high, defer to a future phase when the codebase grows. String literal/template types may provide similar safety with less friction.

## Validation Architecture

### Test Framework

| Property           | Value                                                |
| ------------------ | ---------------------------------------------------- |
| Framework          | Vitest 4.0.18                                        |
| Config file        | `packages/op-nx-polyrepo/vitest.config.mts`          |
| Quick run command  | `npm exec nx test @op-nx/polyrepo`                   |
| Full suite command | `npm exec nx run-many --targets=test,lint,typecheck` |

### Phase Requirements -> Test Map

This phase is a refactoring/hardening phase with no new functional requirements. Validation is through existing tests passing after changes + lint/typecheck passing with stricter rules.

| Area                | Behavior                              | Test Type | Automated Command                       | File Exists?         |
| ------------------- | ------------------------------------- | --------- | --------------------------------------- | -------------------- |
| ESLint config       | Strict rules enabled, zero violations | lint      | `npm exec nx lint @op-nx/polyrepo`      | N/A (config)         |
| TSConfig flags      | Codebase compiles with strict flags   | typecheck | `npm exec nx typecheck @op-nx/polyrepo` | N/A (config)         |
| Mock refactoring    | All existing tests still pass         | unit      | `npm exec nx test @op-nx/polyrepo`      | Yes (8 files)        |
| Zod validation      | JSON.parse sites validated            | unit      | `npm exec nx test @op-nx/polyrepo`      | Yes (existing + new) |
| Zero eslint-disable | No suppression comments remain        | lint      | `npm exec nx lint @op-nx/polyrepo`      | N/A                  |

### Sampling Rate

- **Per task commit:** `npm exec nx test @op-nx/polyrepo && npm exec nx lint @op-nx/polyrepo && npm exec nx typecheck @op-nx/polyrepo`
- **Per wave merge:** `npm exec nx run-many --targets=test,lint,typecheck`
- **Phase gate:** Full suite green + zero `eslint-disable` comments verified via `git grep`

### Wave 0 Gaps

- [ ] `@vitest/eslint-plugin` must be installed before ESLint config update
- [ ] `parserOptions.projectService: true` must be configured before type-checked rules activate
- None for test infrastructure -- existing test files cover all source modules

## Sources

### Primary (HIGH confidence)

- [typescript-eslint shared configs](https://typescript-eslint.io/users/configs/) -- strictTypeChecked preset, config layering
- [typescript-eslint typed linting](https://typescript-eslint.io/getting-started/typed-linting/) -- projectService setup
- [TypeScript TSConfig reference](https://www.typescriptlang.org/tsconfig/) -- noUncheckedIndexedAccess, exactOptionalPropertyTypes
- [Zod v4 basics](https://zod.dev/basics) -- safeParse type guard pattern
- [Vitest PR #6181](https://github.com/vitest-dev/vitest/pull/6181) -- overloaded function mock fix, included in v2.0.4+
- [Vitest Issue #6182](https://github.com/vitest-dev/vitest/issues/6182) -- overloaded mock TypeScript errors, CLOSED
- [Vitest Issue #6085](https://github.com/vitest-dev/vitest/issues/6085) -- MockInstance overload support, CLOSED
- Nx `flat/typescript` source (local `node_modules/@nx/eslint-plugin/src/flat-configs/typescript.js`) -- uses `recommended`, not type-checked

### Secondary (MEDIUM confidence)

- [@vitest/eslint-plugin npm](https://www.npmjs.com/package/@vitest/eslint-plugin) -- configs.all preset, ~70 rules
- [Nx ESLint guide](https://nx.dev/docs/technologies/eslint/guides/eslint) -- Nx + typescript-eslint integration
- [The Strictest TypeScript Config](https://whatislove.dev/articles/the-strictest-typescript-config/) -- flags beyond strict
- [ncjamieson.com Catching Unknowns](https://ncjamieson.com/catching-unknowns/) -- useUnknownInCatchVariables rationale
- [Testing With SIFERS](https://medium.com/@kolodny/testing-with-sifers-c9d6bb5b362) -- SIFER pattern definition
- [TypeScript satisfies operator](https://2ality.com/2025/02/satisfies-operator.html) -- satisfies patterns, excess property checking
- [eslint-plugin-total-functions](https://github.com/danielnixon/eslint-plugin-total-functions) -- evaluated and NOT recommended
- [Claude Code Hooks](https://code.claude.com/docs/en/hooks) -- PreToolUse hook for lint enforcement

### Tertiary (LOW confidence)

- [eslint-plugin-vitest GitHub](https://github.com/vitest-dev/eslint-plugin-vitest) -- no-hooks rule docs (need to verify exact rule names after install)

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH -- all tools verified via installed versions and official docs
- Architecture: HIGH -- ESLint config layering verified against Nx source code + typescript-eslint docs
- Pitfalls: HIGH -- identified from real config analysis and known issues
- Mock casting elimination: MEDIUM -- Vitest fix confirmed but actual compile test needed per Open Question 1
- DDD value types: LOW -- theoretical benefit, practical cost unclear for this codebase size

**Research date:** 2026-03-12
**Valid until:** 2026-04-12 (stable ecosystem, 30 days)
