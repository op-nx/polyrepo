---
phase: 10
slug: integration-and-end-to-end-validation
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-03-18
audited: 2026-03-20
---

# Phase 10 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (workspace version) |
| **Config file** | `packages/op-nx-polyrepo/vitest.config.mts` (unit), `packages/op-nx-polyrepo-e2e/vitest.config.mts` (e2e) |
| **Quick run command** | `npm exec nx test @op-nx/polyrepo --output-style=static` |
| **Full suite command** | `npm exec nx run-many -t test,lint,e2e --output-style=static` |
| **Estimated runtime** | ~180 seconds (e2e dominates due to container startup) |

---

## Sampling Rate

- **After every task commit:** Run `npm exec nx test @op-nx/polyrepo --output-style=static`
- **After every plan wave:** Run `npm exec nx run-many -t test,lint --output-style=static`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds (unit), 180 seconds (e2e)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | Test File | Status |
|---------|------|------|-------------|-----------|-------------------|-----------|--------|
| 10-01-01 | 01 | 1 | DETECT-06 | unit | `npm exec nx test @op-nx/polyrepo --output-style=static -- --run -t "createDependencies"` | `index.spec.ts` — "includes cross-repo edges from detectCrossRepoDependencies" + 3 related tests | green |
| 10-01-02 | 01 | 1 | DETECT-06 | unit | `npm exec nx test @op-nx/polyrepo --output-style=static -- --run -t "createDependencies"` | `index.spec.ts` — "propagates detectCrossRepoDependencies errors (OVRD-03)" | green |
| 10-02-01 | 02 | 2 | DETECT-06 | e2e | `npm exec nx e2e op-nx-polyrepo-e2e --output-style=static` | `cross-repo-deps.spec.ts` — "should auto-detect cross-repo edges from package.json dependencies" | green |
| 10-02-02 | 02 | 2 | DETECT-06 | e2e | `npm exec nx e2e op-nx-polyrepo-e2e --output-style=static` | `cross-repo-deps.spec.ts` — "should include explicit override edges in the graph" | green |
| 10-02-03 | 02 | 2 | DETECT-06 | e2e | `npm exec nx e2e op-nx-polyrepo-e2e --output-style=static` | `cross-repo-deps.spec.ts` — "should suppress negated auto-detected edges" | green |
| 10-03-01 | 03 | 1 | DETECT-06 | unit | `npm exec nx test @op-nx/polyrepo --output-style=static -- --run -t "createDependencies"` | `index.spec.ts` — "keeps cross-repo edges when target has no fileMap entry" | green |
| 10-03-02 | 03 | 1 | DETECT-06 | e2e | `npm exec nx e2e op-nx-polyrepo-e2e --output-style=static` | `cross-repo-deps.spec.ts` — restored auto-detect + negation tests | green |

*Status: pending / green / red / flaky*

---

## Wave 0 Requirements

- [x] Integration tests in `index.spec.ts` for `detectCrossRepoDependencies` wiring -- 6 tests: happy path, OVRD-03 error propagation, extraction failure isolation, empty detection, fileMap-absent cross-repo edges, intra-repo filtering
- [x] E2e tests in `cross-repo-deps.spec.ts` for cross-repo graph validation -- 3 scenarios: auto-detection, override, negation

*Existing infrastructure covers all framework and tooling needs.*

---

## Manual-Only Verifications

*All phase behaviors have automated verification.*

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 180s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** complete

---

## Validation Audit 2026-03-20

| Metric | Count |
|--------|-------|
| Gaps found | 0 |
| Resolved | 0 |
| Escalated | 0 |

All requirements from Phase 10 (DETECT-06, DETECT-07) have automated verification:
- 10 unit tests in `index.spec.ts` covering createDependencies cross-repo wiring, error propagation, and fileMap guard relaxation
- 3 e2e tests in `cross-repo-deps.spec.ts` covering auto-detection, overrides, and negation suppression
- DETECT-07 is documentation-only (deferral rationale), no automated test needed
