---
phase: 11
slug: full-nx-daemon-support
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-20
---

# Phase 11 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (workspace version) |
| **Config file** | `packages/op-nx-polyrepo/vitest.config.mts` (unit), `packages/op-nx-polyrepo-e2e/vitest.config.mts` (e2e) |
| **Quick run command** | `npm exec nx -- test @op-nx/polyrepo --output-style=static` |
| **Full suite command** | `npm exec nx -- run-many -t test,lint,e2e --output-style=static` |
| **Estimated runtime** | ~120 seconds (unit ~5s, e2e ~110s) |

---

## Sampling Rate

- **After every task commit:** Run `npm exec nx -- test @op-nx/polyrepo --output-style=static`
- **After every plan wave:** Run `npm exec nx -- run-many -t test,lint --output-style=static`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 120 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| TBD | 01 | 1 | DAEMON-01 | unit | `npm exec nx -- test @op-nx/polyrepo --output-style=static -- --run -t "global gate"` | Partial | pending |
| TBD | 01 | 1 | DAEMON-02 | unit | `npm exec nx -- test @op-nx/polyrepo --output-style=static -- --run -t "disk cache"` | Partial | pending |
| TBD | 01 | 1 | DAEMON-03 | unit | `npm exec nx -- test @op-nx/polyrepo --output-style=static -- --run -t "selective"` | No | pending |
| TBD | 01 | 1 | DAEMON-04 | unit | `npm exec nx -- test @op-nx/polyrepo --output-style=static -- --run -t "pre-cache"` | No | pending |
| TBD | 01 | 1 | DAEMON-05 | unit | `npm exec nx -- test @op-nx/polyrepo --output-style=static -- --run -t "pre-cache.*warn"` | No | pending |
| TBD | 01 | 1 | DAEMON-06 | unit | `npm exec nx -- test @op-nx/polyrepo --output-style=static -- --run -t "backoff"` | No | pending |
| TBD | 01 | 1 | DAEMON-07 | unit | `npm exec nx -- test @op-nx/polyrepo --output-style=static -- --run -t "hash.*reset"` | No | pending |
| TBD | 01 | 1 | DAEMON-08 | unit | `npm exec nx -- test @op-nx/polyrepo --output-style=static -- --run -t "warning"` | No | pending |
| TBD | 02 | 2 | DAEMON-09 | e2e | `NX_DAEMON=true npm exec nx -- e2e op-nx-polyrepo-e2e --output-style=static` | No | pending |
| TBD | 02 | 2 | DAEMON-10 | e2e | `NX_DAEMON=false npm exec nx -- e2e op-nx-polyrepo-e2e --output-style=static` | Partial | pending |
| TBD | 02 | 2 | DAEMON-11 | e2e | `npm exec nx -- e2e op-nx-polyrepo-e2e --output-style=static` | No | pending |

*Status: pending / green / red / flaky*

---

## Wave 0 Requirements

- [ ] Refactor `cache.spec.ts` tests for per-repo cache architecture (update existing tests, add new per-repo scenarios)
- [ ] New tests in `cache.spec.ts` for backoff/retry mechanism
- [ ] New tests in `executor.spec.ts` for pre-cache during sync
- [ ] Update `container.ts` for env forwarding -- enables daemon-on e2e tests
- [ ] Dockerfile modification (remove `ENV NX_DAEMON=false` from workspace stage)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Docker build baseline timing | DAEMON-09 | Build timing varies by machine; regression is a relative comparison | Record build times before/after Dockerfile change, verify no >10% regression |

---

## Validation Sign-Off

- [ ] All tasks have automated verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 120s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
