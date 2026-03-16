---
phase: 7
slug: v1-tech-debt-cleanup
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-16
---

# Phase 7 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (existing) |
| **Config file** | `packages/op-nx-polyrepo/vitest.config.mts` (unit), `packages/op-nx-polyrepo-e2e/vitest.config.mts` (e2e) |
| **Quick run command** | `npm exec nx test @op-nx/polyrepo --output-style=static` |
| **Full suite command** | `npm exec nx run-many -t test,e2e --output-style=static` |
| **Estimated runtime** | ~120 seconds (unit ~15s, e2e ~90s with sync test) |

---

## Sampling Rate

- **After every task commit:** Run `npm exec nx test @op-nx/polyrepo --output-style=static`
- **After every plan wave:** Run `npm exec nx run-many -t test,lint,typecheck --output-style=static`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 120 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 07-01-01 | 01 | 1 | SC-1 (dead exports) | unit+build | `npm exec nx test @op-nx/polyrepo --output-style=static` | Yes | pending |
| 07-01-02 | 01 | 1 | SC-2 (networkName) | typecheck | `npm exec nx test @op-nx/polyrepo --output-style=static` | Yes | pending |
| 07-01-03 | 01 | 1 | SC-3 (sync->status e2e) | e2e | `npm exec nx e2e op-nx-polyrepo-e2e --output-style=static` | Extends existing | pending |
| 07-02-01 | 02 | 2 | SC-4 (REQUIREMENTS.md) | manual | Visual inspection | N/A (docs) | pending |
| 07-02-02 | 02 | 2 | SC-5 (SUMMARY frontmatter) | manual | Visual inspection | N/A (docs) | pending |

*Status: pending / green / red / flaky*

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements. No new test files needed -- sync->status test extends existing e2e spec.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| REQUIREMENTS.md traceability | SC-4 | Documentation content | Verify all 9 SAFE-* IDs in traceability table |
| SUMMARY frontmatter | SC-5 | Documentation content | Verify SAFE-CASTS and SAFE-SIFER in 05-04 and 05-05 SUMMARY.md |

---

## Validation Sign-Off

- [ ] All tasks have automated verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
