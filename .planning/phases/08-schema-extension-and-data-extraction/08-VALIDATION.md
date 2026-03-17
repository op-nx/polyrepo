---
phase: 8
slug: schema-extension-and-data-extraction
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-17
---

# Phase 8 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.0.0 |
| **Config file** | `packages/op-nx-polyrepo/vitest.config.mts` |
| **Quick run command** | `npm exec nx test @op-nx/polyrepo --output-style=static` |
| **Full suite command** | `npm exec nx test @op-nx/polyrepo --output-style=static` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm exec nx test @op-nx/polyrepo --output-style=static`
- **After every plan wave:** Run `npm exec nx test @op-nx/polyrepo --output-style=static`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 08-01-01 | 01 | 1 | DETECT-05 | unit | `npm exec nx test @op-nx/polyrepo --output-style=static -- --testPathPattern schema.spec` | Yes | pending |
| 08-01-02 | 01 | 1 | DETECT-05 | unit | `npm exec nx test @op-nx/polyrepo --output-style=static -- --testPathPattern schema.spec` | Yes | pending |
| 08-02-01 | 02 | 1 | DETECT-05 | unit | `npm exec nx test @op-nx/polyrepo --output-style=static -- --testPathPattern transform.spec` | Yes | pending |
| 08-02-02 | 02 | 1 | DETECT-05 | unit | `npm exec nx test @op-nx/polyrepo --output-style=static -- --testPathPattern transform.spec` | Yes | pending |
| 08-02-03 | 02 | 1 | DETECT-05 | unit | `npm exec nx test @op-nx/polyrepo --output-style=static -- --testPathPattern transform.spec` | Yes | pending |

*Status: pending / green / red / flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements. Both `schema.spec.ts` and `transform.spec.ts` exist with established patterns for adding new test cases.

---

## Manual-Only Verifications

All phase behaviors have automated verification.

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
