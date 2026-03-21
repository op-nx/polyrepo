---
phase: 08-schema-extension-and-data-extraction
verified: 2026-03-17T00:00:00Z
status: passed
score: 5/5 must-haves verified
re_verification: false
---

# Phase 8: Schema Extension and Data Extraction Verification Report

**Phase Goal:** Extend plugin config schema and graph extraction pipeline to produce enriched data (package names, dependency lists) for Phase 9 cross-repo dependency detection.
**Verified:** 2026-03-17
**Status:** passed
**Re-verification:** No - initial verification

## Goal Achievement

### Observable Truths

| #   | Truth | Status | Evidence |
| --- | ----- | ------ | -------- |
| 1   | A v1.0 config (repos-only, no overrides) parses successfully through the v1.1 schema with no validation errors | VERIFIED | `schema.spec.ts` line 281-287: test "v1.0 config (repos only, no implicitDependencies) parses successfully" passes with `safeParse({ repos: { 'repo-a': '...' } })` returning `success: true`. `schema.ts` line 85-87: `implicitDependencies` is `.optional()` making it additive-only. |
| 2   | User can add an optional `implicitDependencies` record to plugin config, validated by Zod at load time | VERIFIED | `schema.ts` lines 85-87: field added to `polyrepoConfigSchema` as `z.record(z.string().min(1), z.array(z.string().min(1))).optional()`. `schema.spec.ts` lines 289-363: 7 tests cover valid/invalid cases including empty record, empty array value, empty string key/value rejections. |
| 3   | After graph extraction, every external project has its npm package name resolved from `metadata.js.packageName` and stored on the `TransformedNode` | VERIFIED | `types.ts` lines 10-20: `metadataSchema` captures `js.packageName` via structured Zod schema with `.loose()`. `transform.ts` line 104: `const packageName = node.data.metadata?.js?.packageName;`. Line 161: assigned as `packageName: typeof packageName === 'string' ? packageName : undefined`. `transform.spec.ts` lines 443-512: 4 tests for extraction including undefined cases. |
| 4   | After graph extraction, every external project's `package.json` dependency fields are read from disk and stored on the `TransformedNode` | VERIFIED | `transform.ts` lines 1-2: imports `readFileSync` and `join`. Lines 108-130: reads `package.json` from `.repos/<alias>/<original-root>/package.json` and populates `nodeDependencies`, `nodeDevDependencies`, `nodePeerDependencies` as `Object.keys()`. Lines 162-164: assigned to node. `transform.spec.ts` lines 514-671: 6 tests covering all three dep fields. |
| 5   | Missing `package.json` results in undefined dep fields (silent skip, no error) | VERIFIED | `transform.ts` lines 128-130: bare `catch {}` block silently swallows ENOENT and JSON parse errors. `transform.spec.ts` lines 592-644: two tests — ENOENT error and invalid JSON — both assert all three dep fields are `undefined`. |

**Score:** 5/5 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `packages/op-nx-polyrepo/src/lib/config/schema.ts` | `implicitDependencies` field in `polyrepoConfigSchema` | VERIFIED | Line 85: field present, `z.record(z.string().min(1), z.array(z.string().min(1))).optional()` |
| `packages/op-nx-polyrepo/src/lib/graph/types.ts` | Refined metadata schema with `js.packageName`, extended `TransformedNode` | VERIFIED | Lines 10-20: `metadataSchema` with `js.packageName`. Lines 54-57: `TransformedNode` has `packageName?`, `dependencies?`, `devDependencies?`, `peerDependencies?` |
| `packages/op-nx-polyrepo/src/lib/graph/transform.ts` | Package name extraction from metadata + `package.json` dep reading | VERIFIED | Lines 1-2: imports present. Line 104: metadata extraction. Lines 108-130: `package.json` reading. Lines 161-164: all fields assigned |
| `packages/op-nx-polyrepo/src/lib/config/schema.spec.ts` | Tests for `implicitDependencies` schema validation | VERIFIED | Lines 280-363: 8-test `describe('implicitDependencies')` block covering all plan-specified behaviors |
| `packages/op-nx-polyrepo/src/lib/graph/transform.spec.ts` | Tests for package name extraction and dep list extraction | VERIFIED | Lines 7-9: `vi.mock('node:fs')`. Lines 443-671: `describe('package name extraction')` (4 tests) and `describe('dependency list extraction')` (6 tests) |

### Key Link Verification

| From | To | Via | Status | Details |
| ---- | -- | --- | ------ | ------- |
| `transform.ts` | `types.ts` | `TransformedNode` fields `packageName`, `dependencies`, `devDependencies`, `peerDependencies` | WIRED | Lines 161-164 in `transform.ts` assign all four fields. `TransformedNode` interface defines them as optional at `types.ts` lines 54-57. |
| `transform.ts` | `node.data.metadata?.js?.packageName` | Typed metadata access via refined Zod schema | WIRED | `transform.ts` line 104: `const packageName = node.data.metadata?.js?.packageName;` uses optional chaining enabled by the `metadataSchema` refinement in `types.ts`. Type-safe access confirmed. |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| ----------- | ----------- | ----------- | ------ | -------- |
| DETECT-05 | `08-01-PLAN.md` | Plugin builds a name-to-namespaced-project lookup from package.json names and tsconfig paths, covering both host and external projects | SATISFIED | Phase 8 provides the data foundation: `packageName` from `metadata.js.packageName` on every `TransformedNode`, and dep lists from `package.json` on disk. The lookup itself is Phase 9's job. REQUIREMENTS.md traceability table marks DETECT-05 as Phase 8 / Complete. |

**Note on DETECT-05 scope:** DETECT-05 fully requires the name-to-project lookup to exist. Phase 8 provides the _data_ for that lookup (package names on nodes, dep lists read from disk). Phase 9 will build the actual lookup data structure using this data. This phased delivery is explicitly documented in the plan's `<objective>` and is the correct interpretation of the requirement boundary.

**Note on `implicitDependencies`:** The field is defined in `schema.ts` and exported as part of `PolyrepoConfig` type, but is not yet consumed by any executor or plugin code — intentionally. It is the override mechanism for Phase 9 (OVRD-01). It is not orphaned; it is a forward-compatible addition consumed in the next phase.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| None | - | - | - | - |

No TODO, FIXME, placeholder comments, or stub implementations found in any of the five modified files.

### Human Verification Required

None. All truths are verifiable programmatically via source code inspection and test coverage analysis.

### Commit Verification

All four commits documented in SUMMARY.md are confirmed present in git history:

| Commit | Message | Phase |
| ------ | ------- | ----- |
| `163a901` | `test(08-01): add failing tests for implicitDependencies schema validation` | RED - Task 1 |
| `eb32f80` | `feat(08-01): extend config schema and graph types for cross-repo deps` | GREEN - Task 1 |
| `e477cdf` | `test(08-01): add failing tests for package name and dep list extraction in transform` | RED - Task 2 |
| `be76250` | `feat(08-01): extract package names and dep lists in transform pipeline` | GREEN - Task 2 |

### Implementation Notes

**Zod version compatibility:** `types.ts` uses `.loose()` (lines 16 and 19) instead of `.passthrough()`. This is the Zod v4 API — `.loose()` is the v4 rename of `.passthrough()` and is functionally identical. This is correct usage for the installed Zod version.

**Path construction correctness:** `transform.ts` line 109 uses `join(repoBasePath, node.data.root, 'package.json')` where `repoBasePath = join(workspaceRoot, '.repos', repoAlias)`. This correctly avoids the double-path pitfall documented in RESEARCH.md Pitfall 3 — `node.data.root` is the original root (e.g., `libs/my-lib`), not the rewritten `hostRoot` (`.repos/repo-b/libs/my-lib`).

**`_workspaceRoot` rename:** `transform.ts` line 83 correctly uses `workspaceRoot` (not `_workspaceRoot`), confirming the parameter is actively used as intended.

---

_Verified: 2026-03-17_
_Verifier: Claude (gsd-verifier)_
