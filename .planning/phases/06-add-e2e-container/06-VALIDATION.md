---
phase: 6
slug: add-e2e-container
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-16
---

# Phase 6 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.0.18 |
| **Config file** | `packages/op-nx-polyrepo-e2e/vitest.config.mts` |
| **Quick run command** | `npm exec nx e2e op-nx-polyrepo-e2e` |
| **Full suite command** | `npm exec nx e2e op-nx-polyrepo-e2e` |
| **Estimated runtime** | ~30 seconds (target: under 30s, down from ~3 min) |

---

## Sampling Rate

- **After every task commit:** Run `npm exec nx e2e op-nx-polyrepo-e2e`
- **After every plan wave:** Run `npm exec nx e2e op-nx-polyrepo-e2e`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 06-01-01 | 01 | 1 | SC-01 (under 30s) | smoke | `npm exec nx e2e op-nx-polyrepo-e2e` (check wall time) | Existing spec, refactored | pending |
| 06-01-02 | 01 | 1 | SC-02 (identical assertions) | e2e | `npm exec nx e2e op-nx-polyrepo-e2e` | Existing spec, refactored | pending |
| 06-01-03 | 01 | 1 | SC-03 (no network dep) | manual | Verify Verdaccio localhost + local repo | N/A | pending |
| 06-01-04 | 01 | 1 | SC-04 (layer cache) | manual | Change source, rebuild, verify cache hit | N/A | pending |

*Status: pending / green / red / flaky*

---

## Wave 0 Requirements

- [ ] `packages/op-nx-polyrepo-e2e/docker/Dockerfile` — prebaked workspace image
- [ ] `packages/op-nx-polyrepo-e2e/src/setup/global-setup.ts` — testcontainers lifecycle
- [ ] `packages/op-nx-polyrepo-e2e/src/setup/provided-context.ts` — ProvidedContext type declaration
- [ ] `testcontainers` npm dependency — `npm install -D testcontainers`

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| No network dependency during test execution | SC-03 | Network isolation is an architecture constraint, not a code assertion | 1. Disconnect internet 2. Run `npm exec nx e2e op-nx-polyrepo-e2e` 3. Verify tests pass |
| Docker image layer cache efficiency | SC-04 | Layer caching is a Docker engine behavior | 1. Run `docker build` 2. Change only source code 3. Rebuild, verify all layers cached except final |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
