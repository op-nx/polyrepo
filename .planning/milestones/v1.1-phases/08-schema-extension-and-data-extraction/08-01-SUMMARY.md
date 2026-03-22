---
phase: 08-schema-extension-and-data-extraction
plan: '01'
subsystem: graph-pipeline
tags: [schema, types, transform, tdd, zod, package-json]
dependency_graph:
  requires: []
  provides:
    [
      implicitDependencies-schema,
      TransformedNode-enriched,
      packageName-extraction,
      dep-list-extraction,
    ]
  affects:
    [
      packages/op-nx-polyrepo/src/lib/config/schema.ts,
      packages/op-nx-polyrepo/src/lib/graph/types.ts,
      packages/op-nx-polyrepo/src/lib/graph/transform.ts,
    ]
tech_stack:
  added: []
  patterns: [tdd-red-green, zod-passthrough-refinement, fs-mock-in-unit-tests]
key_files:
  created: []
  modified:
    - packages/op-nx-polyrepo/src/lib/config/schema.ts
    - packages/op-nx-polyrepo/src/lib/config/schema.spec.ts
    - packages/op-nx-polyrepo/src/lib/graph/types.ts
    - packages/op-nx-polyrepo/src/lib/graph/transform.ts
    - packages/op-nx-polyrepo/src/lib/graph/transform.spec.ts
decisions:
  - 'implicitDependencies validated as Record<string, string[]> at schema level; glob pattern semantics deferred to Phase 9 where full project graph is available'
  - 'metadataSchema uses z.passthrough() on both outer and js sub-object to preserve unknown metadata fields'
  - 'package.json path constructed from original node.data.root (not rewritten hostRoot) to avoid double-path pitfall'
  - "vi.mock('node:fs') at module level with per-test beforeEach default mock (returns '{}') keeps existing tests unaffected"
metrics:
  duration: '~4 minutes'
  completed_date: '2026-03-17'
  tasks_completed: 2
  files_modified: 5
requirements_completed: [DETECT-05]
---

# Phase 8 Plan 01: Config Schema Extension and Graph Type Enrichment Summary

**One-liner:** Optional `implicitDependencies` config field validated by Zod plus typed `metadata.js.packageName` extraction and `package.json` dep lists stored on every `TransformedNode`.

## Tasks Completed

| Task      | Name                                   | Commit  | Files               |
| --------- | -------------------------------------- | ------- | ------------------- |
| 1 (RED)   | Failing tests for schema and types     | 163a901 | schema.spec.ts      |
| 1 (GREEN) | Extend config schema and graph types   | eb32f80 | schema.ts, types.ts |
| 2 (RED)   | Failing tests for transform extraction | e477cdf | transform.spec.ts   |
| 2 (GREEN) | Extract package names and dep lists    | be76250 | transform.ts        |

## What Was Built

### Task 1: Config Schema and Graph Types

**schema.ts** — Added `implicitDependencies` as an optional field on `polyrepoConfigSchema`:

```typescript
implicitDependencies: z.record(
  z.string().min(1),
  z.array(z.string().min(1)),
).optional();
```

v1.0 configs (repos-only) continue to parse successfully. The field is purely additive.

**types.ts** — Two changes:

1. Replaced `metadata: z.record(z.string(), z.unknown()).optional()` in `externalProjectNodeDataSchema` with a structured `metadataSchema` that captures `js.packageName` while preserving all other fields via `.passthrough()`.
2. Extended `TransformedNode` interface with four optional fields: `packageName`, `dependencies`, `devDependencies`, `peerDependencies`.

### Task 2: Transform Pipeline Enrichment

**transform.ts** — Three changes:

1. Renamed `_workspaceRoot` to `workspaceRoot` (now actively used).
2. Added `import { readFileSync } from 'node:fs'` and `import { join } from 'node:path'`.
3. Inside the node iteration loop: extracts `packageName` from typed `node.data.metadata?.js?.packageName` and reads `package.json` from `.repos/<alias>/<original-root>/package.json`, populating `dependencies`, `devDependencies`, `peerDependencies` as `string[]` (Object.keys). Both ENOENT and JSON parse errors are silently caught, leaving fields `undefined`.

## Test Coverage

- 39 schema tests (all pass, 8 new implicitDependencies tests added)
- 36 transform tests (all pass, 13 new extraction tests added)
- 290 total tests in plugin (all pass)
- Build compiles cleanly (tsc)

## Deviations from Plan

None - plan executed exactly as written.

## Self-Check

Files modified exist:

- packages/op-nx-polyrepo/src/lib/config/schema.ts [FOUND]
- packages/op-nx-polyrepo/src/lib/graph/types.ts [FOUND]
- packages/op-nx-polyrepo/src/lib/graph/transform.ts [FOUND]
- packages/op-nx-polyrepo/src/lib/config/schema.spec.ts [FOUND]
- packages/op-nx-polyrepo/src/lib/graph/transform.spec.ts [FOUND]

## Self-Check: PASSED
