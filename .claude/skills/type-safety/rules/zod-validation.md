# Rule: Zod Validation at System Boundaries

## When to Use

Apply Zod `safeParse` at every **system boundary** where external data enters:

- `JSON.parse()` results
- File reads (`readFileSync`, `readJsonFile`)
- API responses
- CLI stdout parsing
- Environment variable parsing

## Pattern: Schema-First Type Derivation

Define the Zod schema first, then derive the TypeScript type from it using `z.infer`.
This creates a single source of truth -- the schema and type cannot drift.

```typescript
// GOOD: schema is source of truth, type derived from it
import { z } from 'zod';

const externalProjectNodeDataSchema = z.object({
  root: z.string(),
  targets: z.record(z.string(), z.unknown()).optional(),
  tags: z.array(z.string()).optional(),
});

export type ExternalProjectNodeData = z.infer<
  typeof externalProjectNodeDataSchema
>;
```

**Reference:** `src/lib/graph/types.ts` -- all graph types derived from Zod schemas.
**Reference:** `src/lib/config/schema.ts` -- config schemas with `.strict()`, `.refine()`, `.check()`, and discriminated unions.

## Pattern: safeParse with Descriptive Errors

Always use `safeParse` (not `parse`) and provide context in the error message.

```typescript
// GOOD: safeParse with descriptive error
const result = externalGraphJsonSchema.safeParse(JSON.parse(rawStdout));

if (!result.success) {
  throw new Error(
    `Invalid graph JSON from ${repoPath}: ${result.error.message}`,
  );
}

const graphData = result.data; // fully typed
```

**Reference:** `src/lib/graph/extract.ts` -- graph JSON validation.
**Reference:** `src/lib/config/validate.ts` -- config validation with descriptive errors.

## Pattern: Loose Schemas for Partial Validation

When you only need a subset of fields from a large external object (like `nx.json`
or `package.json`), use `.loose()` (Zod's passthrough) to allow extra fields.

```typescript
// GOOD: only validate the fields we need, allow everything else
const nxJsonPluginSubsetSchema = z
  .object({
    plugins: z
      .array(
        z.union([
          z.string(),
          z
            .object({ plugin: z.string(), options: z.unknown().optional() })
            .loose(),
        ]),
      )
      .optional(),
  })
  .loose();
```

**Reference:** `src/lib/config/resolve.ts` -- nx.json plugin discovery.

## Pattern: Graceful Fallback on Failure

For non-critical data, return `undefined` on parse failure instead of throwing.

```typescript
// GOOD: graceful fallback for optional data
const result = packageJsonSchema.safeParse(JSON.parse(content));

if (!result.success) {
  return undefined; // caller handles missing data
}

return result.data.packageManager;
```

**Reference:** `src/lib/executors/sync/executor.ts` -- packageManager field detection.

## When NOT to Use Zod

- **Internal function parameters**: Use TypeScript types directly. Zod is for boundaries.
- **Already-typed Nx APIs**: `readJsonFile<T>()` from `@nx/devkit` returns typed data -- but if
  the type parameter is `any` or too broad, add Zod validation.
- **Performance-critical hot paths**: Zod adds overhead. For data validated once at startup, this
  is fine. For per-request validation in tight loops, consider alternatives.

## Schema Design Tips

- Use `z.unknown()` for complex nested types you do not need to validate (e.g., `TargetConfiguration`).
- Use `z.record(z.string(), schema)` for `Record<string, T>` types.
- Use `.optional()` for fields that may be absent.
- Prefer `z.infer<typeof schema>` over manually writing the interface.
