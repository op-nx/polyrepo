# Phase 5: Maximum Type Safety - Context

**Gathered:** 2026-03-12
**Status:** Ready for planning

<domain>
## Phase Boundary

Harden the entire TypeScript codebase for maximum type safety. Eliminate all `as` type assertions, ban `any`, adopt the strictest ESLint presets and tsconfig flags, establish `satisfies`/Zod/value type patterns, refactor tests to SIFERs with typed mocks, and create project-local skills for ongoing enforcement. Split into decimal sub-phases determined by the planner after research.

</domain>

<decisions>
## Implementation Decisions

### Type casting elimination

- Ban all `as` type assertions (already enforced by `consistent-type-assertions: never`)
- Eliminate ALL existing `eslint-disable` comments for type casting rules — find proper solutions, not suppressions
- Research how to mock overloaded functions (e.g., `execFile`) in Vitest without `as` casts — do NOT add dependency injection through function parameters just for testing
- Research `vi.fn<T>()` generics, `vi.mocked()`, `MockedFunction`, `MockedObject` for cast-free mocking
- For partial test objects (e.g., `ExecutorContext`), research alternatives; fall back to factory functions with full defaults if no better solution exists
- For stub objects (`{} as never`), research alternatives; factory or minimal valid objects as fallback

### `satisfies` and `as const` adoption

- Research best practices for `satisfies` vs type annotation — keep "satisfies when narrow type matters" in mind
- Include `as const` in research — understand interaction with `consistent-type-assertions` rule (`allowAsConst` option)
- Return type annotation preferred over `satisfies` on return expressions for exported functions
- Research `satisfies SomeType as const` (TS 5.0+) patterns
- Research excess property checking behavior — `satisfies` catches excess properties that type annotations miss on intermediate values

### `any` elimination

- Ban `any` via `no-explicit-any` — use `unknown` and narrow instead
- Research the full `no-unsafe-*` rule family: `no-unsafe-assignment`, `no-unsafe-member-access`, `no-unsafe-call`, `no-unsafe-return`, `no-unsafe-argument`
- The stricter, the better — don't worry about impact, harden now while codebase is small

### Runtime validation

- Zod at ALL system boundaries — validate all `JSON.parse` results (3 sites: resolve.ts, executor.ts, extract.ts)
- Prefer `Zod.safeParse()` as type guard over hand-written type guards
- Research when `asserts` functions add value over Zod — fall back to preferring Zod
- Research DDD value types with Zod validation in constructors (e.g., `GitUrl.parse()`)
  - Which primitives warrant value types? (GitUrl, NormalizedUrl, RepoAlias, FilePath?)
  - Ergonomic cost of `.value` unwrapping
  - Can value types replace manual `normalizeGitUrl` + duplicate detection?
  - Pattern: `static parse()` vs constructor vs Zod `.transform()`

### ESLint strictness

- Audit ALL ESLint plugins for strictest available presets:
  1. `@nx/eslint-plugin` — `flat/base`, `flat/typescript`, `flat/javascript`
  2. `@typescript-eslint` — `strict-type-checked` preset
  3. `@eslint-community/eslint-plugin-eslint-comments` — strictest preset
  4. ESLint core rules
  5. Transitive plugins from Nx
- Research compatibility between Nx's `flat/typescript` preset and typescript-eslint's `strict-type-checked`
- ALL rules at severity `warn` in current/added presets must be promoted to `error`
- Accept type-checked lint performance cost — codebase is small, Nx parallelizes per project
- Research `eslint-plugin-vitest` — adopt strictest preset (key rules: `no-hooks` for SIFERs, `no-focused-tests`, `no-disabled-tests`, `expect-expect`, etc.)
- Research configurable rules (AST selectors, regex patterns) before creating custom rules
- Only create custom workspace rules (`@nx/eslint:workspace-rule`) for clear gaps after full audit
- Look for stricter presets in ALL direct and transitive ESLint plugin dependencies

### TSConfig hardening

- Audit tsconfig against official TypeScript reference for recommended strict flags
- Research flags beyond `strict: true`: `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noPropertyAccessFromIndexSignature`
- Research totality plugins (`eslint-plugin-total-functions`, `eslint-plugin-functional`) — prefer TSConfig options
- Verify `strictPropertyInitialization` is enabled (important for DDD value type classes)

### Type patterns

- Prefer `interface` over `type` for object shapes (research `consistent-type-definitions` rule)
- Prefer string literal unions over enums — ban enums, `as const` objects only when runtime access to values is needed
- Enforce `import type` for type-only imports (`consistent-type-imports`)
- Enforce `export type` for type-only exports (`consistent-type-exports`)
- Explicit return types on production code; inferred allowed in test SIFERs
- Ban non-null assertions (`!`) via `no-non-null-assertion`
- Research `Readonly<T>`, `ReadonlyArray<T>`, immutability patterns for config objects and parameters
- Research generic constraints, utility types (`Pick`, `Omit`, `Required`, etc.) for precise types
- Research template literal types for string patterns (namespaced project names, git refs, cache keys)
- Research Zod-inferred types as single source of truth (`z.infer<>`, `z.input<>`) instead of separate interfaces
- Research discriminated unions vs DDD patterns — discriminated unions for simple variants, DDD value types when complexity grows

### Async/Promise type safety

- Research `no-floating-promises`, `no-misused-promises` (included in `strict-type-checked`)
- Research Promise rejection typing and `useUnknownInCatchVariables`
- Executor code is heavily async — these are real risks

### Test refactoring

- Adopt SIFERs (Simple Injectable Functions Explicitly Returning State) across all test files
- Research lint rules enforcing SIFERs / preventing `beforeEach`/`afterEach` hooks (`vitest/no-hooks`)
- Prefer simple factory functions for test data; builder pattern only when factory doesn't cover the case
- Research Vitest strict config: `typecheck.enabled`, `typecheck.checker`, strict assertion typing
- Test files strict by default — research which specific rules to relax in `.spec.ts` (configure as file-level overrides, NOT eslint-disable comments)

### Skills and enforcement

- Create project-local skills via `/skill-creator` with evals/benchmarks
- Skills teach HOW to resolve ESLint rule bans (satisfies patterns, Zod validation, value types, typed mocks)
- Research the right skill granularity and boundaries
- Do NOT add type safety rules to AGENTS.md — ESLint enforces bans, skills teach alternatives (per HumanLayer blog: "never send an LLM to do a linter's job")
- Research Claude Code Stop hook vs Git pre-commit hook for lint enforcement

### Migration strategy

- Everything done in this phase, split into incremental sub-phases (decimal phases: 5.1, 5.2, etc.)
- Planner determines sub-phase split after research
- All at once: enable all strict rules and fix ALL violations — zero eslint-disable comments remaining

### Claude's Discretion

- Exact sub-phase boundaries after research
- Which Vitest mock API best eliminates each casting pattern
- Whether totality plugins add value beyond TSConfig options
- Specific custom rules (if any) after gap analysis
- Skill content structure and trigger design

</decisions>

<specifics>
## Specific Ideas

- Research ncjamieson.com blog posts: `catching-unknowns` (unknown in catch clauses), `dont-export-const-enums`, and all other relevant TypeScript strictness articles on that domain
- Research Kolodny's SIFER article: https://medium.com/@kolodny/testing-with-sifers-c9d6bb5b362
- Reference HumanLayer blog on CLAUDE.md best practices — ESLint for enforcement, skills for progressive disclosure, keep AGENTS.md lean
- Enum alternatives hierarchy: string literal unions first, `as const` objects only when runtime access needed, DDD patterns for complex variants
- The codebase is small (~15 source files, ~8 test files) — hardening now is strategic before it grows

</specifics>

<code_context>

## Existing Code Insights

### Current State

- `consistent-type-assertions: never` already enforced — 18+ eslint-disable comments in test files suppressing it
- `satisfies` used once in production (`executor.ts:244`)
- Zero `as` casts in production code — all ~40 casts are in `.spec.ts` files
- Zod already used for config validation (`schema.ts`)
- 3 `JSON.parse` sites typed via annotation without validation (resolve.ts, executor.ts, extract.ts)

### Cast Patterns in Tests

- **Overloaded function mocks** (~12 occurrences): `vi.fn().mockImplementation(callback as typeof execFile)`
- **Partial context objects** (~3 occurrences): `{ root, cwd } as ExecutorContext`
- **Stub objects** (~12 occurrences): `{} as never` for graph nodes not inspected by SUT
- **EventEmitter-based mocks** (~4 occurrences): `new EventEmitter() as ChildProcess` with property assignments

### ESLint Config

- Currently uses `@nx/eslint-plugin` flat configs + `@eslint-community/eslint-plugin-eslint-comments` recommended
- Rules added manually: `no-unused-vars`, `consistent-type-assertions`, `require-description`
- No type-checked rules currently (no `parserOptions.project`)

### Reusable Assets

- Zod schemas in `config/schema.ts` — extend pattern to all external data boundaries
- `normalizeGitUrl` function — candidate for DDD value type encapsulation

### Integration Points

- `eslint.config.mjs` — central config, needs preset overhaul
- `tsconfig.base.json` / `tsconfig.lib.json` — compiler strictness flags
- All `.spec.ts` files — test refactoring to SIFERs
- `.claude/skills/` — new project-local skills

</code_context>

<deferred>
## Deferred Ideas

- **Biome/oxlint migration** — faster linters as future option when codebase grows; current performance is acceptable
- **Best practices guide for human contributors** — written documentation beyond AI skills; evaluate after skills are created
- **Promote skills to global plugin** — start project-local, promote once proven via evals

</deferred>

---

_Phase: 05-avoid-type-casting-and-prefer-satisfies_
_Context gathered: 2026-03-12_
