# Coding Conventions

**Analysis Date:** 2026-03-22

## Naming Patterns

**Files:**
- kebab-case for all source files: `mock-child-process.ts`, `normalize-url.ts`, `global-setup.ts`
- Test files co-located with source, using `.spec.ts` suffix: `extract.spec.ts`, `cache.spec.ts`
- Config files use `.mts` extension for ESM Vitest configs: `vitest.config.mts`

**Functions:**
- camelCase for all functions: `extractGraphFromRepo`, `transformGraphForRepo`, `normalizeRepos`
- Verb-first naming: `tryReadCachedGraph`, `setupExecSuccess`, `createChildProcessStub`
- Boolean-returning helpers prefixed with verb: `existsSync`, guard helper named `assertDefined`

**Variables:**
- camelCase for local variables: `repoPath`, `nxBin`, `mockExec`
- SCREAMING_SNAKE_CASE for module-level constants: `LARGE_BUFFER`, `CACHE_FILENAME`, `PROXY_EXECUTOR`
- Prefix unused parameters with underscore: `_command`, `_options`, `_args`

**Types/Interfaces:**
- PascalCase for interfaces and types: `RunExecutorOptions`, `CloneOptions`, `RepoGraphData`
- Prefer `interface` over `type` alias (enforced by `@typescript-eslint/consistent-type-definitions: ['error', 'interface']`)
- Inline type imports required: `import { type ExternalGraphJson } from './types'` not `import type { ExternalGraphJson }`

## Code Style

**Formatting:**
- Tool: Prettier `~3.6.2`
- Config: `.prettierrc` — `{ "singleQuote": true }`
- Single quotes for string literals throughout

**Linting:**
- Tool: ESLint 9 flat config in `eslint.config.mjs`
- Profiles: `@nx/eslint-plugin flat/base,typescript,javascript`, `typescript-eslint strictTypeCheckedOnly`, `stylisticTypeCheckedOnly`
- Max warnings: 0 (enforced in CI)

**Key enforced rules:**
- `@typescript-eslint/no-explicit-any: error` — never use `any`
- `@typescript-eslint/no-non-null-assertion: error` — no `!` assertions
- `@typescript-eslint/consistent-type-assertions: ['error', { assertionStyle: 'never' }]` — no `as` casts in source code (exceptions must use ESLint disable comment with description)
- `@typescript-eslint/explicit-function-return-type: error` — all exported and non-trivial functions must declare return types
- `@typescript-eslint/consistent-type-imports: error` — use inline `import { type X }` syntax
- `@typescript-eslint/consistent-type-exports: error` — use inline `export { type X }` syntax
- `@eslint-community/eslint-comments/require-description: error` — every ESLint disable comment must include a reason

**TypeScript config** (`tsconfig.base.json`):
- `strict: true`, `noUncheckedIndexedAccess: true`, `noImplicitReturns: true`, `noUnusedLocals: true`
- `module: nodenext`, `moduleResolution: nodenext`
- `noPropertyAccessFromIndexSignature: true`
- Target: `es2022`

## Import Organization

**Order:**
1. Node.js built-ins with `node:` prefix: `import { exec } from 'node:child_process'`
2. Third-party packages: `import { hashArray } from '@nx/devkit'`
3. Local modules using relative paths: `import { extractGraphFromRepo } from './extract.js'`

**Path Aliases:**
- None in production code — all imports use explicit relative paths with `.js` extension (required by NodeNext module resolution)
- Example: `import { transformGraphForRepo } from './transform.js'`

**Mock hoisting pattern:**
- `vi.mock(...)` calls placed at the top of the file before any imports
- Module re-imported after mocking using dynamic `import()` in test setup functions
- When using `vi.mock` with factory, type-only imports of the mocked module are imported above the mock call, then actual imports come after

## Error Handling

**Patterns:**
- Errors thrown as `new Error(descriptive message including context)`: `new Error(\`Failed to extract graph from ${repoPath}: ${stderr || error.message}\`)`
- Silent catch pattern for non-critical failures: `catch { return undefined; }` with no binding
- Degraded-mode pattern: catch errors from optional operations and return empty/undefined rather than propagating
- `try/catch` without a binding variable (`catch {`) when the error itself is not needed (TypeScript 4.0+ syntax, used throughout)
- Wrap external calls that should never crash the plugin in `try/catch`, re-throw intentional validation errors without catching

## Logging

**Framework:** `logger` from `@nx/devkit`

**Patterns:**
- `logger.warn(message)` for actionable warnings shown to users (unsynced repos, missing `.gitignore` entries, extraction failures)
- `logger.info(message)` for one-time side-effect notifications (e.g., nx.json mutation)
- No `console.log` in production code; `console.log` used in e2e global setup for timing output

## Comments

**When to Comment:**
- JSDoc on all exported functions: documents purpose, parameters, non-obvious behavior
- Inline comments explain "why" not "what" for complex logic
- Reference tracking IDs for planned/deferred behavior: `// DETECT-07 (nx affected cross-repo) is deferred...`
- Inline ESLint disable comments MUST include a description: `// eslint-disable-next-line @typescript-eslint/consistent-type-assertions -- sole bridging assertion: EventEmitter-to-ChildProcess, encapsulated in factory`

**JSDoc/TSDoc:**
- Used on module-level constants and exported functions
- Documents non-obvious constraints (e.g., buffer sizes, Windows compatibility requirements)

## Function Design

**Size:** Functions kept small and single-purpose; complex operations broken into named private helpers

**Parameters:** Options objects preferred over positional parameters for functions with 3+ params

**Return Values:**
- Async functions return `Promise<T>` with explicit return type
- Fallible synchronous operations return `T | undefined` rather than throwing
- Executor functions return `Promise<{ success: boolean }>` (Nx executor contract)

## Module Design

**Exports:**
- Named exports only — no default exports except Nx executor entry points (where Nx requires `export default`)
- Plugin entry points (`createNodesV2`, `createDependencies`) exported from `src/index.ts`

**Barrel Files:**
- `src/index.ts` is the single public API barrel
- Internal modules export only what sibling modules need — no re-exporting internals through the barrel

**Satisfies keyword:**
- Used for typed stubs: `}) satisfies ChildProcess;`
- Preferred over `as` casts to retain structural checking

---

*Convention analysis: 2026-03-22*
