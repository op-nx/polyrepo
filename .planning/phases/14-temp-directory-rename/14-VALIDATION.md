---
phase: 14
slug: temp-directory-rename
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-22
---

# Phase 14 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (workspace version) |
| **Config file** | `packages/op-nx-polyrepo/vitest.config.mts` |
| **Quick run command** | `npm exec nx -- test @op-nx/polyrepo` |
| **Full suite command** | `npm exec nx -- test @op-nx/polyrepo --skip-nx-cache` |
| **Estimated runtime** | ~10 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm exec nx -- test @op-nx/polyrepo`
- **After every plan wave:** Run `npm exec nx -- test @op-nx/polyrepo --skip-nx-cache`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 14-01-01 | 01 | 1 | EXEC-01 | unit | `npm exec nx -- test @op-nx/polyrepo` | Yes -- update assertions | pending |
| 14-01-02 | 01 | 1 | EXEC-02 | unit | `npm exec nx -- test @op-nx/polyrepo` | Partial -- add TEMP assertions | pending |

*Status: pending / green / red / flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements. No new test files or fixtures needed.

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
