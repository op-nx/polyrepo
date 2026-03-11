---
phase: 3
slug: multi-repo-git-dx
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-11
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.x |
| **Config file** | `packages/op-nx-polyrepo/vitest.config.mts` |
| **Quick run command** | `npm exec nx test @op-nx/polyrepo` |
| **Full suite command** | `npm exec nx test @op-nx/polyrepo` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm exec nx test @op-nx/polyrepo`
- **After every plan wave:** Run `npm exec nx test @op-nx/polyrepo`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 03-01-01 | 01 | 1 | GITX-01 | unit | `npm exec nx test @op-nx/polyrepo -- --reporter=verbose -t "getWorkingTreeState"` | No - W0 | pending |
| 03-01-02 | 01 | 1 | GITX-01 | unit | `npm exec nx test @op-nx/polyrepo -- --reporter=verbose -t "getAheadBehind"` | No - W0 | pending |
| 03-01-03 | 01 | 1 | GITX-03 | unit | `npm exec nx test @op-nx/polyrepo -- --reporter=verbose -t "formatAlignedTable"` | No - W0 | pending |
| 03-02-01 | 02 | 2 | GITX-01 | unit | `npm exec nx test @op-nx/polyrepo -- --reporter=verbose -t "statusExecutor"` | Yes - rewrite | pending |
| 03-02-02 | 02 | 2 | GITX-01 | unit | `npm exec nx test @op-nx/polyrepo -- --reporter=verbose -t "auto-fetch"` | No - W0 | pending |
| 03-02-03 | 02 | 2 | GITX-01 | unit | `npm exec nx test @op-nx/polyrepo -- --reporter=verbose -t "project count"` | No - W0 | pending |
| 03-02-04 | 02 | 2 | GITX-01 | unit | `npm exec nx test @op-nx/polyrepo -- --reporter=verbose -t "WARN"` | No - W0 | pending |
| 03-03-01 | 03 | 2 | GITX-02 | unit | `npm exec nx test @op-nx/polyrepo -- --reporter=verbose -t "dry-run"` | No - W0 | pending |
| 03-03-02 | 03 | 2 | GITX-03 | unit | `npm exec nx test @op-nx/polyrepo -- --reporter=verbose -t "summary table"` | No - W0 | pending |

*Status: pending / green / red / flaky*

---

## Wave 0 Requirements

- [ ] `detect.spec.ts` — stubs for `getWorkingTreeState`, `getAheadBehind` (GITX-01)
- [ ] `format/table.spec.ts` — stubs for `formatAlignedTable` (GITX-03)
- [ ] `status/executor.spec.ts` — rewritten stubs for new output format, auto-fetch, project counts, warnings (GITX-01)
- [ ] `sync/executor.spec.ts` — stubs for `--dry-run` and summary table (GITX-02, GITX-03)

*Existing framework detected. No new test framework installation needed.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Aligned columns visually scannable | GITX-01, GITX-03 | Visual formatting judgment | Run `npm exec nx polyrepo-status` with 3+ repos of varying alias lengths; verify columns align |

---

## Validation Sign-Off

- [ ] All tasks have automated verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
