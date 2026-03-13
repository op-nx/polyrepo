# Rule: satisfies Patterns

## Decision Tree

```
Need to type a value?
  |
  +-- Exported function? --> Return type annotation: function foo(): ReturnType { ... }
  |
  +-- Variable assignment?
  |     |
  |     +-- Need the narrow type at use sites? --> const x = { ... } satisfies WideType
  |     +-- Need the wide type at use sites?   --> const x: WideType = { ... }
  |     +-- Need both narrow + validated?       --> const x = { ... } as const satisfies WideType
  |
  +-- Inline object in function call? --> Usually no annotation needed (contextual typing)
```

## When to Use `satisfies`

Use `satisfies` when you want TypeScript to validate that a value conforms to a type
while preserving the **narrow literal type** for downstream usage.

```typescript
// GOOD: satisfies validates structure, type stays narrow
const config = {
  repos: {
    nx: 'https://github.com/nrwl/nx.git',
    angular: { path: '/local/angular' },
  },
} satisfies PolyrepoConfig;
// typeof config.repos.nx is string (narrow)

// COMPARE: type annotation widens
const config: PolyrepoConfig = { ... };
// typeof config.repos.nx is string | RepoEntry (wide)
```

## When to Use Type Annotations

Use type annotations on:
- **Exported function return types** (required by `explicit-function-return-type` rule)
- **Variable declarations** where the wide type is what consumers need

```typescript
// GOOD: return type annotation on exported function
export function resolvePluginConfig(workspaceRoot: string): ResolvedPluginConfig {
  // ...
}

// GOOD: type annotation when wide type is needed
const nodes: Record<string, TransformedNode> = {};
```

## When to Use `as const satisfies`

Use when you need an immutable literal type that also validates against a schema.
Note: `as const` is the ONLY permitted `as` keyword usage (via ESLint config).

```typescript
// GOOD: as const satisfies for immutable validated config
const DEFAULTS = {
  depth: 1,
  disableHooks: true,
} as const satisfies Partial<RemoteRepoEntry>;
// typeof DEFAULTS.depth is 1 (literal), not number
```

## Excess Property Checking

`satisfies` catches excess properties that type annotations miss in some contexts:

```typescript
interface Options { timeout: number }

// satisfies catches the typo
const opts = { timeout: 100, timout: 200 } satisfies Options;
//                          ~~~~~~ Error: 'timout' does not exist in type 'Options'
```

## Real Codebase Examples

### Stub objects in tests (detect.spec.ts)

```typescript
// GOOD: satisfies Partial<ChildProcess> validates structure, keeps narrow type
function createChildProcessStub(): ChildProcess {
  const emitter = new EventEmitter();
  return Object.assign(emitter, {
    stdin: null,
    stdout: null,
    stderr: null,
    stdio: [null, null, null, undefined, undefined] satisfies ChildProcess['stdio'],
    // ... remaining properties
  }) satisfies Partial<ChildProcess> as ChildProcess;
}
```

### Config objects (vitest.config.mts)

```typescript
// GOOD: as const on provider value for literal type
export default defineConfig({
  test: {
    provider: 'v8' as const,
  },
});
```
