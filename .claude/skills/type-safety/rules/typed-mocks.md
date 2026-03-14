# Rule: Cast-Free Vitest Mock Patterns

## Core Principle

No `as` casts in test files. No `eslint-disable` comments. All mock types must be
inferred or narrowed through Vitest's built-in typing utilities.

## Pattern: vi.mocked() for Overloaded Functions

Vitest 4.x `vi.mocked()` correctly resolves overloaded function types. Use it instead
of casting `vi.fn()` results.

```typescript
// BAD: cast to mock type
const mockExec = vi.fn() as unknown as typeof exec;

// GOOD: vi.mocked() resolves the type from the import
import { exec } from 'node:child_process';
vi.mock('node:child_process', () => ({ exec: vi.fn() }));

// Later in setup():
const mockExec = vi.mocked(exec);
mockExec.mockImplementation((cmd, opts, callback) => { ... });
```

**Reference:** `src/lib/graph/cache.spec.ts` -- all mocks use `vi.mocked()`.

## Pattern: import type * as Mod for Factory Generics

When `vi.mock()` needs a factory with typed return, use `import type * as Mod`.

```typescript
// GOOD: typed mock factory
import type * as FsModule from 'node:fs';

vi.mock('node:fs', (): typeof FsModule => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  // ...
}));
```

## Pattern: Typed Test Factories

Replace `{} as Type` stubs with properly typed factory functions.

### ExecutorContext Factory

```typescript
function createTestContext(
  overrides: Partial<ExecutorContext> = {},
): ExecutorContext {
  return {
    root: '/workspace',
    cwd: '/workspace',
    isVerbose: false,
    projectName: 'test-project',
    projectsConfigurations: { version: 2, projects: {} },
    nxJsonConfiguration: {},
    projectGraph: { nodes: {}, dependencies: {} },
    ...overrides,
  };
}
```

**Reference:** `src/lib/executors/sync/executor.spec.ts`, `status/executor.spec.ts`, `run/executor.spec.ts`.

### ChildProcess Factory

The sole type assertion in the entire codebase is encapsulated in a shared factory:

```typescript
// src/lib/testing/mock-child-process.ts
export function createMockChildProcess(exitCode = 0): ChildProcess {
  const child = new EventEmitter();
  Object.defineProperties(child, {
    stdin: { value: null, writable: true, configurable: true },
    stdout: { value: new EventEmitter(), writable: true, configurable: true },
    stderr: { value: new EventEmitter(), writable: true, configurable: true },
    // ... all ChildProcess properties
  });
  Object.assign(child, { kill: vi.fn(), send: vi.fn(), /* ... */ });
  process.nextTick(() => child.emit('close', exitCode));
  // eslint-disable-next-line -- sole bridging assertion, encapsulated
  return child as unknown as ChildProcess;
}
```

Tests import this factory and never need their own casts.

## Pattern: assertDefined for Index Access

With `noUncheckedIndexedAccess`, array/record indexing returns `T | undefined`.
Use `assertDefined` instead of non-null assertions or repetitive if-throw guards.

```typescript
import { assertDefined } from '../testing/asserts';

const node = nodes['my-project'];
assertDefined(node, 'Expected my-project node to exist');
// node is now narrowed to TransformedNode (not TransformedNode | undefined)
```

**Reference:** `src/lib/testing/asserts.ts`.

## Pattern: Typed Record Access Helpers

For test assertions on Record types, create local helpers:

```typescript
function getNode(name: string): TransformedNode {
  const node = result.nodes[name];
  assertDefined(node, `Expected node '${name}' in result`);
  return node;
}
```

## Pattern: Custom Type Guards for `unknown` Narrowing

When dealing with unvalidated data (e.g., raw target configs from external graphs),
use custom type guard functions instead of casts. This is the production-code
equivalent of `assertDefined` — it narrows `unknown` safely at runtime.

```typescript
// GOOD: type guard narrows unknown without any casts
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRecordOfRecords(
  value: unknown,
): value is Record<string, Record<string, unknown>> {
  if (!isRecord(value)) {
    return false;
  }

  return Object.values(value).every((v) => isRecord(v));
}

// Usage: safely extract from unknown data
const config = isRecord(rawTargetConfig) ? rawTargetConfig : {};
const metadata = isRecord(config['metadata']) ? config['metadata'] : undefined;
```

**Reference:** `src/lib/graph/transform.ts` -- `isRecord`/`isRecordOfRecords` for target config extraction.

## What NOT to Do

```typescript
// BAD: eslint-disable to allow cast
// eslint-disable-next-line @typescript-eslint/consistent-type-assertions
const ctx = {} as ExecutorContext;

// BAD: any to bypass types
const mock = vi.fn() as any;

// BAD: non-null assertion
const value = arr[0]!;
```
