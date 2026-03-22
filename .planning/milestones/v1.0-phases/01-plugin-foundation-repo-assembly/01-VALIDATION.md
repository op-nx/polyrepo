---
phase: 1
slug: plugin-foundation-repo-assembly
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-03-10
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property               | Value                                                         |
| ---------------------- | ------------------------------------------------------------- |
| **Framework**          | Vitest 4.x (already in devDependencies)                       |
| **Config file**        | None yet — Wave 0 scaffolds via `@nx/plugin:plugin` generator |
| **Quick run command**  | `npx nx test nx-openpolyrepo`                                 |
| **Full suite command** | `npx nx run-many -t test`                                     |
| **Estimated runtime**  | ~5 seconds                                                    |

---

## Sampling Rate

- **After every task commit:** Run `npx nx test nx-openpolyrepo`
- **After every plan wave:** Run `npx nx run-many -t test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID  | Plan | Wave | Requirement | Test Type          | Automated Command                  | File Exists                                                           | Status |
| -------- | ---- | ---- | ----------- | ------------------ | ---------------------------------- | --------------------------------------------------------------------- | ------ |
| 01-01-01 | 01   | 0    | ASSM-01     | unit               | `npm exec nx test @op-nx/polyrepo` | schema.spec.ts (31), index.spec.ts (3)                                | green  |
| 01-01-02 | 01   | 0    | ASSM-04     | unit               | `npm exec nx test @op-nx/polyrepo` | validate.spec.ts (8), schema.spec.ts (7 invalid), index.spec.ts (1)   | green  |
| 01-02-01 | 02   | 1    | ASSM-02     | unit + integration | `npm exec nx test @op-nx/polyrepo` | sync/executor.spec.ts (clone tests), commands.spec.ts, detect.spec.ts | green  |
| 01-02-02 | 02   | 1    | ASSM-03     | unit + integration | `npm exec nx test @op-nx/polyrepo` | sync/executor.spec.ts (pull/strategy tests), commands.spec.ts         | green  |
| 01-02-03 | 02   | 1    | ASSM-04     | unit               | `npm exec nx test @op-nx/polyrepo` | validate.spec.ts (2), index.spec.ts (1)                               | green  |

_Status: pending / green / red / flaky_

---

## Wave 0 Requirements

- [x] Plugin project scaffolded via `@nx/plugin:plugin` — creates vitest config, tsconfig, package.json
- [x] `zod` package installed: `npm install zod`
- [x] `packages/op-nx-polyrepo/src/lib/config/schema.spec.ts` — 31 tests for ASSM-01, ASSM-04 (config validation)
- [x] `packages/op-nx-polyrepo/src/lib/executors/sync/executor.spec.ts` — 62 tests for ASSM-02, ASSM-03
- [x] `packages/op-nx-polyrepo/src/lib/executors/status/executor.spec.ts` — 24 tests for status executor

---

## Manual-Only Verifications

| Behavior                            | Requirement | Why Manual                                   | Test Instructions                                                                                         |
| ----------------------------------- | ----------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `.gitignore` warning at plugin load | ASSM-04     | Relies on workspace-level `.gitignore` state | 1. Remove `.repos/` from `.gitignore` 2. Run any `nx` command 3. Verify warning appears in console output |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 10s (275 tests in 667ms)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** passed

## Validation Audit 2026-03-11

| Metric     | Count |
| ---------- | ----- |
| Gaps found | 0     |
| Resolved   | 0     |
| Escalated  | 0     |

All 4 Phase 1 requirements (ASSM-01 through ASSM-04) have comprehensive automated test coverage via TDD. 275 tests across 13 spec files, all green. No gaps to fill.
