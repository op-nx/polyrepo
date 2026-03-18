---
phase: 10
slug: integration-and-end-to-end-validation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-18
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

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 10-01-01 | 01 | 1 | DETECT-06 | unit | `npm exec nx test @op-nx/polyrepo --output-style=static -- --run -t "createDependencies"` | Partial -- index.spec.ts exists, needs new detect wiring tests | pending |
| 10-01-02 | 01 | 1 | DETECT-06 | unit | `npm exec nx test @op-nx/polyrepo --output-style=static -- --run -t "createDependencies"` | Partial -- needs OVRD-03 error propagation test | pending |
| 10-02-01 | 02 | 2 | DETECT-06 | e2e | `npm exec nx e2e op-nx-polyrepo-e2e --output-style=static` | No -- new auto-detection e2e test | pending |
| 10-02-02 | 02 | 2 | DETECT-06 | e2e | `npm exec nx e2e op-nx-polyrepo-e2e --output-style=static` | No -- new override e2e test | pending |
| 10-02-03 | 02 | 2 | DETECT-06 | e2e | `npm exec nx e2e op-nx-polyrepo-e2e --output-style=static` | No -- new negation e2e test | pending |

*Status: pending / green / red / flaky*

---

## Wave 0 Requirements

- [ ] Integration tests in `index.spec.ts` for `detectCrossRepoDependencies` wiring -- 3+ new tests: happy path, OVRD-03 error propagation, empty report
- [ ] E2e tests in `op-nx-polyrepo.spec.ts` for cross-repo graph validation -- 3 scenarios: auto-detection, override, negation

*Existing infrastructure covers all framework and tooling needs.*

---

## Manual-Only Verifications

*All phase behaviors have automated verification.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 180s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
