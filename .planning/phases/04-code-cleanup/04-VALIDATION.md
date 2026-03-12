---
phase: 4
slug: code-cleanup
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-12
---

# Phase 4 -- Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.x (existing) |
| **Config file** | packages/op-nx-polyrepo/vitest.config.ts |
| **Quick run command** | `npm exec nx test @op-nx/polyrepo` |
| **Full suite command** | `npm exec nx test @op-nx/polyrepo` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm exec nx test @op-nx/polyrepo`
- **After every plan wave:** Run `npm exec nx test @op-nx/polyrepo`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 04-01-01 | 01 | 1 | (tech debt) | unit | `npm exec nx test @op-nx/polyrepo` | existing | pending |
| 04-01-02 | 01 | 1 | (tech debt) | unit | `npm exec nx test @op-nx/polyrepo` | existing | pending |

*Status: pending*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements. No new test files needed -- this is a refactoring phase where existing tests must continue to pass.

---

## Manual-Only Verifications

All phase behaviors have automated verification. The refactoring preserves existing behavior -- if existing tests pass, the refactoring is correct.

---

## Validation Sign-Off

- [ ] All tasks have automated verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
