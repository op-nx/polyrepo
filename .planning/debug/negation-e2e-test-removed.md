---
status: diagnosed
trigger: 'diagnose why negation e2e test was removed'
created: 2026-03-18T22:00:00Z
updated: 2026-03-18T22:00:00Z
---

## Current Focus

hypothesis: negation e2e test removal was caused entirely by auto-detection failure (no packageName match in nrwl/nx fixture), not a bug in negation logic itself
test: review code history, negation logic, and unit test coverage
expecting: negation logic is correct; the e2e environment is the problem
next_action: report diagnosis

## Symptoms

expected: negation e2e test should verify that !target suppresses auto-detected edges end-to-end
actual: test was removed across two commits (885e0c7 replaced with override+negation combo, a538199 removed entirely)
errors: auto-detect test found zero cross-repo edges because nrwl/nx projects lack packageName fields matching host deps
reproduction: run auto-detect in e2e Docker container — no edges produced
started: d5fbbb7 introduced the tests; every subsequent commit tried to work around the failure

## Eliminated

- hypothesis: negation logic in detect.ts is broken
  evidence: unit tests thoroughly cover negation (OVRD-02 suite with 4 tests); code at lines 448-475 correctly builds negation set and filters edges array
  timestamp: 2026-03-18T22:00:00Z

- hypothesis: the replacement test (override+negation combo at 885e0c7) was a valid alternative
  evidence: that test configured [target, !target] for the same project — but negation only filters auto-detected edges (Step 4b), while positive override emits new edges (Step 4c). These are independent operations. The positive override edge would still appear because Step 4c skips the negationSet entirely. The test would have PASSED for the wrong reason or FAILED depending on processing order.
  timestamp: 2026-03-18T22:00:00Z

## Evidence

- timestamp: 2026-03-18T22:00:00Z
  checked: commit history d5fbbb7 through a538199 (7 commits)
  found: progressive degradation — original test relied on shared mutable state from auto-detect test, then was made self-contained, then auto-detect was discovered to produce zero edges, then negation was replaced with override+negation combo, then removed entirely
  implication: the root problem was always auto-detection producing zero edges

- timestamp: 2026-03-18T22:00:00Z
  checked: detect.ts lines 196-210 (Step 1a — pkgNameToProject map building)
  found: auto-detection requires TransformedNode.packageName to be set. packageName comes from node.data.metadata.js.packageName in transform.ts line 104. nrwl/nx projects (example apps like nx-dev, graph-client) do NOT have metadata.js.packageName set — they are internal workspace projects without published npm package names.
  implication: the lookup map never contains entries like "@nx/devkit" -> "nx/some-project", so host deps like @nx/devkit never match any external project

- timestamp: 2026-03-18T22:00:00Z
  checked: detect.ts lines 237-260 (Step 1c — tsconfig path alias expansion)
  found: fallback detection via tsconfig paths could theoretically match if nrwl/nx repo had tsconfig.base.json with @nx/\* path aliases pointing to project roots. The nrwl/nx repo DOES have such aliases. However, the e2e fixture uses depth:1 clone which may not include all necessary files.
  implication: tsconfig path alias fallback might work but was never tested in the e2e environment

- timestamp: 2026-03-18T22:00:00Z
  checked: detect.ts lines 440-515 (Step 4 — negation logic)
  found: negation logic is correct and clean. Step 4a builds negation pairs, Step 4b filters the auto-detected edges array, Step 4c emits positive override edges independently. Negation ONLY filters the `edges` array (auto-detected). It does NOT filter override edges emitted in Step 4c.
  implication: negation logic has no bugs; it just needs auto-detected edges to exist for there to be anything to negate

- timestamp: 2026-03-18T22:00:00Z
  checked: detect.spec.ts lines 1420-1636 (OVRD-02 unit test suite)
  found: 4 comprehensive unit tests covering: basic negation, selective negation (only specific pair), negation of tsconfig-detected edges, and positive-override-wins-over-negation. All use controlled mocks with explicit packageName values.
  implication: negation logic is thoroughly unit-tested; the gap is e2e coverage only

- timestamp: 2026-03-18T22:00:00Z
  checked: the 885e0c7 replacement test design
  found: configured [overrideTarget, !overrideTarget] and expected the edge to be absent. This is semantically wrong. The code processes negation (Step 4b) ONLY on auto-detected edges, then emits positive overrides (Step 4c) as NEW edges. So [target, !target] would: (1) suppress any auto-detected edge to target (there are none anyway), (2) emit a NEW implicit override edge to target. The edge would STILL appear. The commit message for a538199 correctly identifies this: "Override + negation are independent operations: [target, !target] adds an override edge AND suppresses auto-detection (not a cancellation)."
  implication: the replacement test was fundamentally flawed and would have failed, leading to its removal

## Resolution

root_cause: The negation e2e test was removed because it depends on auto-detected cross-repo edges existing, and auto-detection produces zero edges in the nrwl/nx e2e fixture. The nrwl/nx projects do not have `metadata.js.packageName` fields matching npm package names like `@nx/devkit`, so the `pkgNameToProject` lookup map never connects host dependencies to external projects. Without auto-detected edges, there is nothing for negation to suppress.

fix: restore the negation e2e test once auto-detection is fixed to produce edges in the e2e environment. The negation logic itself is correct.

verification: N/A — diagnosis only

files_changed: []
