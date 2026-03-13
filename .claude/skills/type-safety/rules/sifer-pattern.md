# Rule: SIFERS Test Setup Pattern

## What is SIFERS?

SIFERS (Setup In Function, Explicit Return, Single-use) is a test pattern that replaces
`beforeEach`/`afterEach` hooks with a plain `setup()` function called at the start of
each test. Each test explicitly destructures only the state it needs.

**Origin:** [Yonatan Kra's SIFERS article](https://medium.com/@kolodny/testing-with-sifers-c9d6bb5b36)

## Why: Hooks Are Banned

This project enforces `vitest/no-hooks: error` in ESLint. The following are all banned:
- `beforeEach`
- `afterEach`
- `beforeAll`
- `afterAll`

Violations produce lint errors that block the build.

## Pattern: setup() Function

Replace `beforeEach` with a `setup()` function inside each `describe` block.

```typescript
describe('myModule', () => {
  function setup() {
    vi.clearAllMocks();

    const mockFn = vi.mocked(someImport);
    mockFn.mockReturnValue('default');

    return { mockFn };
  }

  it('should do something', () => {
    const { mockFn } = setup();

    mockFn.mockReturnValue('custom');
    // ... test logic
  });

  it('should do something else', () => {
    setup(); // destructure nothing if defaults are sufficient

    // ... test logic
  });
});
```

## Key Rules

### 1. vi.clearAllMocks() Inside setup()

Always call `vi.clearAllMocks()` as the first line of `setup()`. This replaces
the implicit cleanup that `beforeEach` provided.

```typescript
function setup() {
  vi.clearAllMocks(); // ALWAYS first

  // ... configure mocks
  return { ... };
}
```

### 2. Return All Mutable State

Everything a test might need must be returned from `setup()`. No module-level
`let` variables that get reassigned in hooks.

```typescript
// BAD: mutable module-level state
let mockExec: MockInstance;
beforeEach(() => { mockExec = vi.fn(); });

// GOOD: returned from setup
function setup() {
  vi.clearAllMocks();
  const mockExec = vi.mocked(exec);
  return { mockExec };
}
```

### 3. Injectable Parameters for Customization

When tests need different setup configurations, add parameters to `setup()`.

```typescript
function setup(options: { exitCode?: number } = {}) {
  vi.clearAllMocks();

  const mockChild = createMockChildProcess(options.exitCode ?? 0);
  const mockExec = vi.mocked(exec);
  mockExec.mockReturnValue(mockChild);

  return { mockExec, mockChild };
}

it('handles failure', () => {
  const { mockExec } = setup({ exitCode: 1 });
  // ...
});
```

### 4. Async setup() for Module Reset

When tests need isolated module state (e.g., module-level caches), use
`async setup()` with `vi.resetModules()`.

```typescript
async function setup() {
  vi.clearAllMocks();
  vi.resetModules();

  // Re-apply mocks after module reset
  vi.mock('node:fs', () => ({ existsSync: vi.fn() }));

  // Dynamic import to get fresh module
  const mocks = await loadMocks();
  return { mocks };
}

it('should work', async () => {
  const { mocks } = await setup();
  // ...
});
```

**Reference:** `src/lib/graph/cache.spec.ts` -- async SIFERS with module reset.

## Real Codebase Examples

### Simple synchronous setup (transform.spec.ts)

```typescript
describe('transformGraphForRepo', () => {
  function setup() {
    vi.clearAllMocks();
    return { result: transformGraphForRepo('my-repo', rawGraph, '/workspace') };
  }

  it('namespaces project names', () => {
    const { result } = setup();
    expect(Object.keys(result.nodes)).toEqual(['my-repo/my-lib']);
  });
});
```

### Setup with mock configuration (commands.spec.ts)

```typescript
describe('execGit', () => {
  function setup() {
    vi.clearAllMocks();
    const mockExec = vi.mocked(exec);
    return { mockExec };
  }

  it('resolves with trimmed stdout', async () => {
    const { mockExec } = setup();
    mockExec.mockImplementation((_cmd, _opts, cb) => {
      cb(null, '  output  \n', '');
      return createChildProcessStub();
    });
    // ...
  });
});
```

## Migration Checklist

When converting a file from hooks to SIFERS:

1. Remove all `beforeEach`, `afterEach`, `beforeAll`, `afterAll` calls
2. Remove unused imports of hook functions from vitest
3. Create `setup()` inside each `describe` block
4. Move mock configuration from hooks into `setup()`
5. Add `vi.clearAllMocks()` as first line of `setup()`
6. Return all mutable state from `setup()`
7. Update each `it()` to call `setup()` and destructure what it needs
8. Convert module-level `let` declarations to `const` where possible
