---
phase: 09-cross-repo-dependency-detection
verified: 2026-03-17T23:20:00Z
status: passed
score: 14/14 must-haves verified
gaps: []
human_verification: []
---

# Phase 9: Cross-Repo Dependency Detection Verification Report

**Phase Goal:** Implement cross-repo dependency detection so Nx graph edges are emitted for packages that depend on packages from synced repos.
**Verified:** 2026-03-17T23:20:00Z
**Status:** passed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

Plan 01 must-haves (DETECT-01, DETECT-02, DETECT-03):

| # | Truth | Status | Evidence |
|---|-------|--------|---------|
| 1 | Consumer with `dependencies` entry matching lookup map emits a static cross-repo edge | VERIFIED | detect.spec.ts "DETECT-01 — dependencies field" describe block, direct `toStrictEqual` assertion on edge shape |
| 2 | Consumer with `devDependencies` entry matching lookup map emits a static cross-repo edge | VERIFIED | detect.spec.ts "DETECT-02 — devDependencies field" describe block |
| 3 | Consumer with `peerDependencies` entry matching lookup map emits a static cross-repo edge | VERIFIED | detect.spec.ts "DETECT-03 — peerDependencies field" describe block |
| 4 | Lookup map built from `packageName` fields on `TransformedNode` for external projects | VERIFIED | detect.ts Step 1a (lines 200-209); test "external node with packageName creates lookup map entry" |
| 5 | Lookup map includes host project packageNames from `context.projects` metadata (zero I/O) | VERIFIED | detect.ts Step 1b (lines 211-234); test "host project with metadata.js.packageName creates lookup map entry" |
| 6 | Intra-repo edges are NOT emitted (source and target in same repo) | VERIFIED | detect.ts cross-repo guard (lines 367-369); test "intra-repo edges are NOT emitted"; test "host-to-host edges are NOT emitted" |
| 7 | Projects without package.json dep lists are silently skipped | VERIFIED | detect.ts silent try/catch on host package.json read (lines 415-425); test "host project missing package.json is silently skipped" |
| 8 | Duplicate edges from multiple dep fields emitted only once | VERIFIED | detect.ts deduplication via `Set<string>` keyed by `"source::target"` (lines 345, 371-377); test "duplicate edges from dependencies and devDependencies emitted only once" |

Plan 02 must-haves (DETECT-04, OVRD-01, OVRD-02, OVRD-03):

| # | Truth | Status | Evidence |
|---|-------|--------|---------|
| 9 | Provider-side tsconfig.base.json path alias expands lookup map enabling cross-repo edge detection without packageName | VERIFIED | detect.ts Step 1c (lines 236-258), `expandTsconfigPathsIntoMap` helper; test "tsconfig.base.json path alias with matching node root expands lookup map and emits edge" |
| 10 | Missing or unparseable tsconfig files are silently skipped | VERIFIED | `readTsconfigPaths` silent try/catch (lines 61-76); test "repo with neither tsconfig.base.json nor tsconfig.json is silently skipped — no error" |
| 11 | Explicit `implicitDependencies` entries emit `DependencyType.implicit` edges for all matched project pairs (via minimatch) | VERIFIED | detect.ts Step 4c (lines 476-511); tests "OVRD-01 — explicit override edge emission" with glob key and glob target coverage |
| 12 | A negation override (`!target`) suppresses auto-detected edges from the final output | VERIFIED | detect.ts Step 4a-4b (lines 446-473) — negation set + post-filter; test "!target negation suppresses an auto-detected edge from the output" |
| 13 | Plugin throws at load time when any implicitDependencies override references a project pattern matching zero projects | VERIFIED | detect.ts Step 2c (lines 316-339); tests for unknown key, unknown target, both unknown, and negation target with unknown name |
| 14 | Error message includes all unknown project references in one throw | VERIFIED | `unknowns.join(', ')` at line 337; test "both unknown key AND unknown target are reported in a single throw" with regex assertion |

**Score:** 14/14 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/op-nx-polyrepo/src/lib/graph/detect.ts` | `detectCrossRepoDependencies` pure function | VERIFIED | 514 lines; exports `detectCrossRepoDependencies`; no top-level side effects |
| `packages/op-nx-polyrepo/src/lib/graph/detect.spec.ts` | Unit tests covering all 7 requirements | VERIFIED | 1729 lines; 35 tests (15 from Plan 01 + 20 from Plan 02); all 325 suite tests pass |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `detect.ts` | `packages/op-nx-polyrepo/src/lib/graph/types.ts` | `import type { PolyrepoGraphReport }` | WIRED | Line 8: `import type { PolyrepoGraphReport } from './types';` — `PolyrepoGraphReport` used as function parameter type at line 188 |
| `detect.ts` | `@nx/devkit` | `import { DependencyType, type RawProjectGraphDependency, type CreateDependenciesContext }` | WIRED | Lines 5-6; `DependencyType.static` used at line 382, `DependencyType.implicit` at line 503, `RawProjectGraphDependency[]` as return type |
| `detect.ts` | `minimatch` | `import { minimatch } from 'minimatch'` | WIRED | Line 4; `minimatch(name, pattern)` called at lines 320, 328, 450, 458, 485, 492; `minimatch` in `package.json` dependencies at line 65 |
| `detect.ts` | `packages/op-nx-polyrepo/src/lib/graph/types.ts` | `tsConfigPathsSchema` Zod schema with `z.object().loose()` | VERIFIED | `tsConfigPathsSchema` defined at lines 45-54 using `.loose()` on both outer object and `compilerOptions` inner object; `compilerOptions.paths` accessed at line 72 |

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|---------|
| DETECT-01 | 09-01-PLAN.md | Auto-detect cross-repo edges from `dependencies` | SATISFIED | detect.ts Step 3a scans `node.dependencies`; test in "DETECT-01 — dependencies field" describe |
| DETECT-02 | 09-01-PLAN.md | Auto-detect cross-repo edges from `devDependencies` | SATISFIED | detect.ts Step 3a scans `node.devDependencies`; test in "DETECT-02 — devDependencies field" describe |
| DETECT-03 | 09-01-PLAN.md | Auto-detect cross-repo edges from `peerDependencies` | SATISFIED | detect.ts Step 3a scans `node.peerDependencies`; test in "DETECT-03 — peerDependencies field" describe |
| DETECT-04 | 09-02-PLAN.md | Auto-detect cross-repo edges from tsconfig path mappings | SATISFIED | detect.ts Steps 1c-1d; `readTsconfigPathsWithFallback`, `expandTsconfigPathsIntoMap`; 8 tests in "DETECT-04 — tsconfig path alias expansion" describe |
| OVRD-01 | 09-02-PLAN.md | User can declare explicit cross-repo dependency edges in plugin config | SATISFIED | detect.ts Step 4c; `DependencyType.implicit` edges emitted; glob keys and targets via minimatch; 3 tests in "OVRD-01 — explicit override edge emission" |
| OVRD-02 | 09-02-PLAN.md | User can negate auto-detected edges via override config | SATISFIED | detect.ts Steps 4a-4b; negation set built then applied as post-filter; 4 tests in "OVRD-02 — negation suppression" |
| OVRD-03 | 09-02-PLAN.md | Plugin fails at load time when override references unknown project | SATISFIED | detect.ts Step 2c; throws once with all unknowns; 5 tests in "OVRD-03 — unknown project validation" |

**REQUIREMENTS.md cross-reference:**
- DETECT-05 is assigned to Phase 8, not Phase 9 — confirmed not claimed by either Phase 9 plan's `requirements` frontmatter field. Not orphaned.
- DETECT-06, DETECT-07 are assigned to Phase 10 — not claimed by Phase 9.
- No orphaned requirements for Phase 9.

---

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `detect.ts` | 416 | `readFileSync(pkgJsonPath, 'utf-8') as string` — `as` cast | WARNING | Violates plan rule "No `as` casts (except `as const`)". However: the `readTsconfigPaths` helper (line 65) correctly uses `String(raw)` instead; this cast is inconsistent but functionally harmless — the value is immediately passed to `JSON.parse` inside a `try/catch` block; TypeScript build compiles clean with no errors |

No blocker anti-patterns. No `TODO`/`FIXME`/placeholder comments in either file. No `any` types. No non-null assertions (`!`). No `beforeEach`/`afterEach` hooks in the spec file (SIFERS pattern correctly followed).

---

### Build and Test Results

- **Tests:** 325/325 pass (`pnpm exec vitest run packages/op-nx-polyrepo/src`)
  - 15 tests from Plan 01 (detect.spec.ts: lookup map, DETECT-01, DETECT-02, DETECT-03, guard, host-as-source, dedup, no-mutation)
  - 20 tests from Plan 02 (detect.spec.ts: DETECT-04 tsconfig expansion x8, OVRD-01 x3, OVRD-02 x4, OVRD-03 x5)
  - 290 pre-existing tests all continue to pass
- **Build:** Clean — `pnpm nx build @op-nx/polyrepo --output-style=static` compiles with no TypeScript errors

---

### Commits Verified

All 6 commits documented in SUMMARY files confirmed present in git history:

| Hash | Type | Description |
|------|------|-------------|
| `499dccc` | test | RED: Failing tests for lookup map + dep-list scan |
| `5587325` | feat | GREEN: detectCrossRepoDependencies implementation |
| `ca7871d` | test | RED: Failing tests for tsconfig path alias expansion |
| `d607423` | feat | GREEN: Expand lookup map with provider-side tsconfig path aliases |
| `97324b4` | test | RED: Failing tests for override emission, negation, unknown-project validation |
| `af6105d` | feat | GREEN: Implement override processing and negation suppression |

TDD discipline confirmed: RED commit precedes GREEN commit for both plans.

---

### Human Verification Required

None. All behaviors are unit-testable with mocked I/O. The function is pure — no Nx runtime required. Phase 10 integration testing (cross-repo edges appearing in `nx graph`) is deferred to Phase 10 verification (DETECT-06/DETECT-07 are Phase 10 requirements).

---

### Summary

Phase 9 goal is fully achieved. `detectCrossRepoDependencies` is a complete, pure function implementing all seven requirements (DETECT-01 through DETECT-04, OVRD-01 through OVRD-03). The function is wired to its dependencies (`types.ts`, `@nx/devkit`, `minimatch`, `zod`), has 35 unit tests passing, compiles clean, and follows the SIFERS test pattern. One minor style inconsistency exists (`as string` cast at line 416 vs. the `String()` pattern used elsewhere in the same file) but it does not affect correctness or build.

The function is ready to be wired into the `createDependencies` plugin hook in Phase 10.

---

_Verified: 2026-03-17T23:20:00Z_
_Verifier: Claude (gsd-verifier)_
