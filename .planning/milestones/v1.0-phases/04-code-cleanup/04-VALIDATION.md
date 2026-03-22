---
phase: 4
slug: code-cleanup
status: approved
nyquist_compliant: true
wave_0_complete: true
created: 2026-03-12
audited: 2026-03-16
---

# Phase 4 -- Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property               | Value                                    |
| ---------------------- | ---------------------------------------- |
| **Framework**          | Vitest 4.x (existing)                    |
| **Config file**        | packages/op-nx-polyrepo/vitest.config.ts |
| **Quick run command**  | `npm exec nx test @op-nx/polyrepo`       |
| **Full suite command** | `npm exec nx test @op-nx/polyrepo`       |
| **Estimated runtime**  | ~5 seconds                               |

---

## Sampling Rate

- **After every task commit:** Run `npm exec nx test @op-nx/polyrepo`
- **After every plan wave:** Run `npm exec nx test @op-nx/polyrepo`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 5 seconds

---

## Per-Task Verification Map

| Task ID  | Plan | Wave | Requirement                                 | Test Type | Automated Command                  | File Exists                                    | Status  |
| -------- | ---- | ---- | ------------------------------------------- | --------- | ---------------------------------- | ---------------------------------------------- | ------- |
| 04-01-01 | 01   | 1    | Export CACHE_FILENAME + resolvePluginConfig | unit      | `npm exec nx test @op-nx/polyrepo` | resolve.spec.ts, cache.spec.ts                 | COVERED |
| 04-01-02 | 01   | 1    | Refactor executors to shared utilities      | unit      | `npm exec nx test @op-nx/polyrepo` | status/executor.spec.ts, sync/executor.spec.ts | COVERED |

_Status: COVERED -- all requirements verified_

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements. No new test files needed -- this is a refactoring phase where existing tests must continue to pass.

---

## Manual-Only Verifications

All phase behaviors have automated verification. The refactoring preserves existing behavior -- if existing tests pass, the refactoring is correct.

---

## Validation Sign-Off

- [x] All tasks have automated verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 5s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-03-16

---

## Validation Audit 2026-03-16

| Metric     | Count |
| ---------- | ----- |
| Gaps found | 0     |
| Resolved   | 0     |
| Escalated  | 0     |

**Notes:** Refactoring phase -- existing test suite (271 tests) validates behavior preservation. New `resolve.spec.ts` (3 tests) directly covers the new `resolvePluginConfig` shared utility. Executor specs exercise the refactored code paths through transitive module mocks. No hardcoded cache filename strings remain outside `cache.ts`.
