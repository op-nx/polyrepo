# Testing Patterns

**Analysis Date:** 2026-03-22

## Test Framework

**Runner:**

- Vitest `^4.0.0`
- Unit config: `packages/op-nx-polyrepo/vitest.config.mts`
- E2E config: `packages/op-nx-polyrepo-e2e/vitest.config.mts`
- Workspace config: `vitest.workspace.ts` (lists config files to discover)

**Assertion Library:**

- Vitest built-ins: `expect`, `expectTypeOf`
- Coverage provider: `@vitest/coverage-v8`

**Run Commands:**

```bash
npm exec nx -- test @op-nx/polyrepo          # Run unit tests
npm exec nx -- e2e op-nx-polyrepo-e2e        # Run e2e tests
npm exec nx -- run-many -t test              # Run all tests
npm run test                                  # Run all non-external tests via Nx
```

## Test File Organization

**Location:**

- Unit tests: co-located alongside source files in `packages/op-nx-polyrepo/src/`
- E2E tests: separate package at `packages/op-nx-polyrepo-e2e/src/`
- Test helpers: `packages/op-nx-polyrepo/src/lib/testing/` — shared utilities for tests

**Naming:**

- Pattern: `<module-name>.spec.ts`
- ESLint enforces `consistent-test-filename: ['error', { pattern: '.*\\.spec\\.[tj]sx?$' }]`

**Structure:**

```
packages/op-nx-polyrepo/src/
├── index.spec.ts                        # Plugin entry point tests
├── lib/
│   ├── config/
│   │   ├── resolve.spec.ts
│   │   ├── schema.spec.ts
│   │   └── validate.spec.ts
│   ├── executors/
│   │   ├── run/executor.spec.ts
│   │   ├── status/executor.spec.ts
│   │   └── sync/executor.spec.ts
│   ├── format/table.spec.ts
│   ├── git/
│   │   ├── commands.spec.ts
│   │   ├── detect.spec.ts
│   │   └── normalize-url.spec.ts
│   ├── graph/
│   │   ├── cache.spec.ts
│   │   ├── extract.spec.ts
│   │   └── transform.spec.ts
│   └── testing/
│       ├── asserts.ts                   # assertDefined() helper
│       └── mock-child-process.ts        # createMockChildProcess() factory

packages/op-nx-polyrepo-e2e/src/
├── cross-repo-deps.spec.ts
├── installed.spec.ts
├── polyrepo-status.spec.ts
└── setup/
    ├── container.ts
    ├── global-setup.ts
    └── provided-context.ts
```

## Test Structure

**Suite Organization:**

```typescript
// Preferred: use function reference as describe title (enforced by vitest/prefer-describe-function-title)
describe(extractGraphFromRepo, () => {
  it('calls exec with command containing node_modules/.bin/nx and graph --print', async () => {
    expect.hasAssertions();

    const { mockExec } = setupExecSuccess(
      JSON.stringify({ graph: { nodes: {}, dependencies: {} } }),
    );

    await extractGraphFromRepo('/workspace/.repos/repo-a');

    expect(mockExec).toHaveBeenCalledWith(/* ... */);
  });
});

// Nested describes for grouping related scenarios
describe(transformGraphForRepo, () => {
  describe('project name namespacing', () => {
    it('prefixes project names with repoAlias/ separator', () => {
      /* ... */
    });
  });

  describe('path rewriting', () => {
    it('rewrites project root to .repos/<alias>/<original-root>', () => {
      /* ... */
    });
  });
});
```

**Patterns:**

- `expect.hasAssertions()` / `expect.assertions(N)` required on all async tests (enforced by `vitest/prefer-expect-assertions: ['error', { onlyFunctionsWithAsyncKeyword: true }]`)
- No lifecycle hooks (`beforeEach`, `afterEach`, etc.) in unit tests — enforced by `vitest/no-hooks: error`. The `opNxE2e` ESLint override re-enables hooks for e2e only
- `vi.clearAllMocks()` called at the start of each `setup()` helper function instead of hooks
- Max 10 `expect` calls per test (`vitest/max-expects: ['error', { max: 10 }]`)
- Lowercase test titles (`vitest/prefer-lowercase-title: error`)
- Use `it` not `test` (`vitest/consistent-test-it: error`)

## Mocking

**Framework:** Vitest `vi.mock`, `vi.fn`, `vi.mocked`

**Hoisted module mock pattern (standard):**

```typescript
// 1. Type-only import of mocked module (before vi.mock)
import type * as ExtractModule from './extract.js';

// 2. vi.mock with factory — MUST be before any runtime imports of the module
vi.mock('./extract', () => ({
  extractGraphFromRepo: vi.fn<typeof ExtractModule.extractGraphFromRepo>(),
}));

// 3. Runtime import after mocking
import { extractGraphFromRepo } from './extract.js';

// 4. Get typed mock reference in test
const mock = vi.mocked(extractGraphFromRepo);
```

**Selective mock pattern (spread original):**

```typescript
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();

  return {
    ...actual,
    existsSync: vi.fn<(path: string) => boolean>(),
  };
});
```

**Module state reset pattern (for modules with module-level state):**

```typescript
// cache.spec.ts — cache.ts has module-level Map state that must be reset
describe('cache', () => {
  async function setup() {
    vi.clearAllMocks();
    vi.resetModules(); // Clears module registry → fresh module state

    const mocks = await loadMocks(); // Re-import mocked modules after reset
    setupMocksForExtraction(mocks);

    return { mocks };
  }

  async function loadCacheModule() {
    return import('./cache.js'); // Dynamic import gets fresh module instance
  }
});
```

**What to Mock:**

- All Node.js built-ins that perform I/O: `node:fs`, `node:child_process`
- All `@nx/devkit` functions when testing plugin internals
- All sibling modules at the boundary of the unit under test

**What NOT to Mock:**

- Zod schemas and validation logic — test them directly with `.safeParse()`
- Pure transformation functions — test them directly with real input/output
- Type utilities

## Fixtures and Factories

**Test Data:**

```typescript
// Factory function pattern — returns fresh object each call to prevent mutation bleed
function makeFixtureGraph(): ExternalGraphJson {
  return {
    graph: {
      nodes: {
        'my-lib': {
          name: 'my-lib',
          type: 'lib',
          data: {
            root: 'libs/my-lib',
            targets: { build: { executor: '@nx/js:tsc' } },
          },
        },
      },
      dependencies: { 'my-lib': [] },
    },
  };
}

// Module-level const fixtures for simple, immutable test data
const testConfig: PolyrepoConfig = {
  repos: {
    'repo-a': 'https://github.com/org/repo-a.git',
  },
};
```

**Typed guard helpers (for noUncheckedIndexedAccess compatibility):**

```typescript
// In test files — avoids "possibly undefined" on index access
function getNode(
  nodes: Record<string, TransformedNode>,
  key: string,
): TransformedNode {
  const node = nodes[key];

  if (!node) {
    throw new Error(`Expected node "${key}" not found in result`);
  }

  return node;
}
```

**Shared test utilities** (`src/lib/testing/`):

- `assertDefined<T>(value, message?)` — narrows `T | undefined | null` to `T` with a helpful throw; used instead of repeated `if (!x) throw` guards
- `createMockChildProcess(exitCode?)` — returns a typed `ChildProcess` stub built from `EventEmitter + Object.defineProperties`; encapsulates the single `as unknown as ChildProcess` cast so test files stay assertion-free

**Location:**

- Module-level constants for static fixtures at the top of test file
- Factory functions for mutable fixtures as named functions within the describe block or at module scope
- Shared cross-test utilities in `packages/op-nx-polyrepo/src/lib/testing/`

## Coverage

**Requirements:** Not enforced (no threshold configured in `vitest.config.mts`)

**View Coverage:**

```bash
npm exec nx -- test @op-nx/polyrepo --coverage
# Report written to packages/op-nx-polyrepo/test-output/vitest/coverage/
```

## Test Types

**Unit Tests:**

- Scope: individual functions/modules with all I/O mocked
- Globals enabled: `vi`, `describe`, `it`, `expect`, `expectTypeOf` available without imports (but the codebase imports them explicitly per ESLint rules)
- Location: co-located at `packages/op-nx-polyrepo/src/**/*.spec.ts`

**Integration Tests:**

- None distinct from unit tests — the unit tests cover integration between internal modules via mocked I/O boundaries

**E2E Tests:**

- Framework: Vitest with `testcontainers` (`^11.12.0`)
- Location: `packages/op-nx-polyrepo-e2e/src/`
- Strategy: Docker-based — builds a workspace snapshot image, starts containers per test file, runs real `nx` commands inside the container
- Global setup: `packages/op-nx-polyrepo-e2e/src/setup/global-setup.ts` orchestrates: Verdaccio start → plugin publish → snapshot image build → `project.provide('snapshotImage', name)`
- Test timeout: `60_000ms`, hook timeout: `120_000ms`
- Pool: `forks` (required by testcontainers)
- Hooks (`beforeAll`/`afterAll`) are allowed in e2e tests only (via `opNxE2e` ESLint override in `packages/op-nx-polyrepo-e2e/eslint.config.mjs`)

## Common Patterns

**Async Testing:**

```typescript
it('rejects when stdout contains no valid JSON', async () => {
  expect.hasAssertions(); // REQUIRED for all async tests

  setupExecSuccess('[isolated-plugin] log only\nno json here');

  await expect(
    extractGraphFromRepo('/workspace/.repos/repo-a'),
  ).rejects.toThrowError('/workspace/.repos/repo-a');
});
```

**Error Testing:**

```typescript
it('throws with zod error details for invalid input', () => {
  setup();

  expect(() => validateConfig({})).toThrowError(
    'Invalid @op-nx/polyrepo config',
  );
});
```

**Type-checking in tests:**

```typescript
// expectTypeOf for structural type assertions
it('dependencies use string type value (passed through)', () => {
  const dep = result.dependencies.find((d) => d.source === 'repo-b/my-app');

  expectTypeOf(dep?.type).toEqualTypeOf<string | undefined>();
  expect(dep?.type).toBe('static');
});
```

**Nth-call verification:**

```typescript
expect(mockExecFile).toHaveBeenNthCalledWith(
  1,
  'git',
  ['fetch', '--depth', '1', 'origin', 'tag', 'v1.0.0'],
  expect.objectContaining({ cwd: 'D:/workspace/.repos/repo' }),
  expect.any(Function),
);
```

**Zod failure assertion helper pattern:**

```typescript
interface ZodFailureResult {
  success: false;
  error: ZodError;
}

function expectZodFailure(result: { success: boolean }): asserts result is ZodFailureResult {
  expect(result.success).toBe(false);
}

// Usage
const result = polyrepoConfigSchema.safeParse({ ... });
expectZodFailure(result);
const message = result.error.issues[0]?.message ?? '';
expect(message).toContain('repo-a');
```

---

_Testing analysis: 2026-03-22_
