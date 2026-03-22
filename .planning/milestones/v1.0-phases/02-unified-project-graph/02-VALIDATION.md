---
phase: 2
slug: unified-project-graph
status: approved
nyquist_compliant: true
wave_0_complete: true
created: 2026-03-11
validated: 2026-03-11
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property               | Value                                         |
| ---------------------- | --------------------------------------------- |
| **Framework**          | Vitest 4.x                                    |
| **Config file**        | `packages/op-nx-polyrepo/vitest.config.mts`   |
| **Quick run command**  | `npm exec nx test @op-nx/polyrepo`            |
| **Full suite command** | `npm exec nx run-many -t test,lint,typecheck` |
| **Estimated runtime**  | ~1 second (275 tests)                         |

---

## Sampling Rate

- **After every task commit:** Run `npm exec nx test @op-nx/polyrepo`
- **After every plan wave:** Run `npm exec nx run-many -t test,lint,typecheck`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 1 second

---

## Per-Task Verification Map

| Task ID  | Plan | Wave | Requirement                        | Test Type | Automated Command                  | Test Files                                | Status |
| -------- | ---- | ---- | ---------------------------------- | --------- | ---------------------------------- | ----------------------------------------- | ------ |
| 02-01-01 | 01   | 1    | GRPH-03, GRPH-04                   | unit      | `npm exec nx test @op-nx/polyrepo` | `normalize-url.spec.ts`, `detect.spec.ts` | green  |
| 02-01-02 | 01   | 1    | GRPH-03, GRPH-04                   | unit      | `npm exec nx test @op-nx/polyrepo` | `schema.spec.ts`, `sync/executor.spec.ts` | green  |
| 02-02-01 | 02   | 2    | GRPH-04                            | unit      | `npm exec nx test @op-nx/polyrepo` | `extract.spec.ts`, `cache.spec.ts`        | green  |
| 02-02-02 | 02   | 2    | GRPH-03                            | unit      | `npm exec nx test @op-nx/polyrepo` | `transform.spec.ts`                       | green  |
| 02-03-01 | 03   | 3    | GRPH-01, GRPH-02                   | unit      | `npm exec nx test @op-nx/polyrepo` | `run/executor.spec.ts`                    | green  |
| 02-03-02 | 03   | 3    | GRPH-01, GRPH-02, GRPH-03, GRPH-04 | unit      | `npm exec nx test @op-nx/polyrepo` | `index.spec.ts`, `validate.spec.ts`       | green  |

_Status: pending / green / red / flaky_

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements.

All originally-listed Wave 0 items were delivered during execution:

- [x] `src/lib/graph/extract.spec.ts` -- 8 tests for graph JSON extraction and parsing (GRPH-04)
- [x] `src/lib/graph/transform.spec.ts` -- 29 tests for namespace prefixing, tag injection, target rewriting (GRPH-03)
- [x] `src/lib/graph/cache.spec.ts` -- 12 tests for two-layer cache invalidation logic (GRPH-04)
- [x] `src/lib/graph/types.ts` -- TypeScript interfaces for graph report structures
- [x] `src/lib/executors/run/executor.spec.ts` -- tests for proxy executor (GRPH-01, GRPH-02)
- [x] `src/lib/executors/run/schema.json` -- executor schema
- [x] `src/lib/git/normalize-url.spec.ts` -- 9 tests for URL normalization (GRPH-03)
- [x] Registration of `run` executor in `executors.json`

---

## Manual-Only Verifications

| Behavior                                   | Requirement | Why Manual                              | Test Instructions                                                   | Verified           |
| ------------------------------------------ | ----------- | --------------------------------------- | ------------------------------------------------------------------- | ------------------ |
| `nx graph` visualizes external projects    | GRPH-01     | Visual graph rendering requires browser | Run `nx graph` and verify external projects appear in visualization | Yes (02-03 Task 3) |
| `nx show projects` lists external projects | GRPH-02     | Requires synced repos in .repos/        | Run sync, then `nx show projects` -- 152 projects listed            | Yes (02-03 Task 3) |

---

## Validation Sign-Off

- [x] All tasks have automated verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 15s (actual: ~1s for 275 tests)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-03-11

---

## Validation Audit 2026-03-11

| Metric               | Count                                  |
| -------------------- | -------------------------------------- |
| Requirements audited | 4 (GRPH-01, GRPH-02, GRPH-03, GRPH-04) |
| Gaps found           | 0                                      |
| Resolved             | 0                                      |
| Escalated            | 0                                      |
| Total test files     | 13                                     |
| Total tests          | 275                                    |

All four GRPH requirements have automated unit test coverage across 13 test files.
No additional test generation was needed.
