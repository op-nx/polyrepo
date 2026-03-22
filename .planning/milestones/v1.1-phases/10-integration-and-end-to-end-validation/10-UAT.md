---
status: diagnosed
phase: 10-integration-and-end-to-end-validation
source: [10-01-SUMMARY.md, 10-02-SUMMARY.md]
started: 2026-03-18T19:00:00Z
updated: 2026-03-18T19:20:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Unit tests pass with cross-repo wiring

expected: Run `npm exec nx -- test @op-nx/polyrepo --output-style=static`. All tests pass (329+ total), including the 4 new cross-repo integration tests: happy path (edges merged), error propagation (OVRD-03), extraction failure (graceful degradation), and empty detection (no crash).
result: pass

### 2. OVRD-03 validation errors propagate to Nx

expected: In the unit tests, the "propagates OVRD-03 validation errors" test verifies that detectCrossRepoDependencies validation errors are NOT caught by the extraction try/catch — they bubble up to Nx so the user sees a clear error message instead of silent failure.
result: pass

### 3. E2e: auto-detected cross-repo edges appear in nx graph

expected: Run `npm exec nx -- e2e op-nx-polyrepo-e2e --output-style=static` (requires Docker). The "auto-detects cross-repo static edges" test passes — at least one static-type dependency edge from @workspace/source to an nx/\* project appears in the nx graph --print JSON output.
result: issue
reported: "E2e auto-detection test was removed (commit 885e0c7) claiming nrwl/nx projects lack packageName fields matching host dependencies. This should not be true — the host workspace depends on nx, @nx/js, @nx/devkit etc., and the synced repo IS the nrwl/nx monorepo which publishes those packages. The test should be restorable."
severity: major

### 4. E2e: explicit override edges appear in nx graph

expected: The "adds explicit override as implicit edge" e2e test passes — writing implicitDependencies config to nx.json produces an implicit-type edge to a project that has no auto-detected edge, verifying override behavior is isolated from auto-detection.
result: pass

### 5. E2e: negation suppresses auto-detected edges

expected: The "negation suppresses auto-detected edge" e2e test passes — adding a !-prefixed entry to implicitDependencies removes a previously auto-detected edge from the graph output.
result: issue
reported: "E2e negation test was removed (commit a538199) claiming it was untestable. Negation depends on auto-detected edges existing to suppress — if auto-detection is fixed (test 3), negation becomes testable. Both tests should exist in the e2e suite."
severity: major

## Summary

total: 5
passed: 3
issues: 2
pending: 0
skipped: 0

## Gaps

- truth: "Auto-detected cross-repo static edges appear in nx graph --print e2e output"
  status: failed
  reason: "User reported: E2e auto-detection test was removed (commit 885e0c7) claiming nrwl/nx projects lack packageName fields matching host dependencies. This should not be true — the host workspace depends on nx, @nx/js, @nx/devkit etc., and the synced repo IS the nrwl/nx monorepo which publishes those packages. The test should be restorable."
  severity: major
  test: 3
  root_cause: "Primary: fileMap filter in index.ts:156-166 requires both source AND target to have projectFileMap entries. External projects in .repos/ are gitignored so they have zero file map entries — ALL cross-repo edges are silently dropped even when detectCrossRepoDependencies correctly produces them. Secondary (needs verification): whether nrwl/nx published packages actually have metadata.js.packageName set in the extracted graph — published packages (nx, @nx/devkit, @nx/js) should have it, but this needs empirical confirmation in the container."
  artifacts:
  - path: "packages/op-nx-polyrepo/src/index.ts"
    issue: "Lines 156-166: fileMap guard requires fileMap[dep.target] which is always undefined for external projects"
  - path: "packages/op-nx-polyrepo/src/lib/graph/detect.ts"
    issue: "Correct — produces edges properly, not the bug"
  - path: "packages/op-nx-polyrepo/src/lib/graph/transform.ts"
    issue: "Correct — preserves packageName from metadata.js.packageName"
    missing:
  - "Relax fileMap guard: only check fileMap on host-side of cross-repo edges, or remove for implicit-type edges"
  - "Restore auto-detect e2e test from commit d5fbbb7 / 0190a6e"
  - "Empirically verify packageName fields exist in nrwl/nx graph output inside container"
    debug_session: ".planning/debug/cross-repo-autodetect-e2e.md"

- truth: "Negation suppresses auto-detected edges in nx graph --print e2e output"
  status: failed
  reason: "User reported: E2e negation test was removed (commit a538199) claiming it was untestable. Negation depends on auto-detected edges existing to suppress — if auto-detection is fixed (test 3), negation becomes testable. Both tests should exist in the e2e suite."
  severity: major
  test: 5
  root_cause: "Purely dependent on Gap 1 (auto-detection). Negation logic in detect.ts is correct (Step 4b filters edges array). With zero auto-detected edges, there is nothing to negate. Once the fileMap guard is relaxed and auto-detection produces edges, the original negation test design works: (1) observe auto-detected edges, (2) add !target negation, (3) verify edge removed."
  artifacts:
  - path: "packages/op-nx-polyrepo/src/lib/graph/detect.ts"
    issue: "Lines 448-475: negation logic is correct, no bugs"
  - path: "packages/op-nx-polyrepo-e2e/src/op-nx-polyrepo.spec.ts"
    issue: "Lines 258-263: removal site with explanatory comment"
    missing:
  - "Fix Gap 1 first (fileMap guard)"
  - "Restore negation e2e test from commit d5fbbb7"
    debug_session: ".planning/debug/negation-e2e-test-removed.md"
