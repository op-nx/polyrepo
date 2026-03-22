---
phase: 5
slug: avoid-type-casting-and-prefer-satisfies
status: validated
nyquist_compliant: true
wave_0_complete: true
created: 2026-03-12
validated: 2026-03-16
---

# Phase 5 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property               | Value                                                |
| ---------------------- | ---------------------------------------------------- |
| **Framework**          | Vitest 4.0.18                                        |
| **Config file**        | `packages/op-nx-polyrepo/vitest.config.mts`          |
| **Quick run command**  | `npm exec nx test @op-nx/polyrepo`                   |
| **Full suite command** | `npm exec nx run-many --targets=test,lint,typecheck` |
| **Estimated runtime**  | ~15 seconds                                          |

---

## Sampling Rate

- **After every task commit:** Run `npm exec nx test @op-nx/polyrepo && npm exec nx lint @op-nx/polyrepo && npm exec nx typecheck @op-nx/polyrepo`
- **After every plan wave:** Run `npm exec nx run-many --targets=test,lint,typecheck`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID  | Plan | Wave | Requirement                   | Test Type | Automated Command                       | File Exists           | Status |
| -------- | ---- | ---- | ----------------------------- | --------- | --------------------------------------- | --------------------- | ------ |
| 05-01-01 | 01   | 1    | ESLint strict presets         | lint      | `npm exec nx lint @op-nx/polyrepo`      | N/A (config)          | green  |
| 05-01-02 | 01   | 1    | TSConfig hardening            | typecheck | `npm exec nx typecheck @op-nx/polyrepo` | N/A (config)          | green  |
| 05-01-03 | 01   | 1    | Install @vitest/eslint-plugin | lint      | `npm exec nx lint @op-nx/polyrepo`      | N/A (dep)             | green  |
| 05-02-01 | 02   | 2    | Mock cast elimination         | unit      | `npm exec nx test @op-nx/polyrepo`      | Yes (14 files)        | green  |
| 05-02-02 | 02   | 2    | Zod JSON.parse validation     | unit      | `npm exec nx test @op-nx/polyrepo`      | Yes (extract.spec.ts) | green  |
| 05-02-03 | 02   | 2    | Zero eslint-disable comments  | lint      | `npm exec nx lint @op-nx/polyrepo`      | N/A                   | green  |
| 05-03-01 | 03   | 3    | SIFERS test refactoring       | unit      | `npm exec nx test @op-nx/polyrepo`      | Yes (14 files)        | green  |
| 05-04-01 | 04   | 4    | Enforcement skills created    | manual    | Skill files exist in `.claude/skills/`  | Yes (5 files)         | green  |

_Status: pending / green / red / flaky_

---

## Wave 0 Requirements

- [x] `@vitest/eslint-plugin` — install before ESLint config update
- [x] `parserOptions.projectService: true` — configure before type-checked rules activate

_All Wave 0 prerequisites satisfied._

---

## Manual-Only Verifications

| Behavior                         | Requirement        | Why Manual                         | Test Instructions                                   |
| -------------------------------- | ------------------ | ---------------------------------- | --------------------------------------------------- |
| Skills teach resolution patterns | Enforcement skills | Skills are documentation artifacts | Review `.claude/skills/` files for completeness     |
| Zero eslint-disable comments     | Full elimination   | Grep check, not a test             | `git grep 'eslint-disable' -- '*.ts'` returns empty |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 30s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-03-16

---

## Validation Audit 2026-03-16

| Metric     | Count |
| ---------- | ----- |
| Gaps found | 1     |
| Resolved   | 1     |
| Escalated  | 0     |

**Gap resolved:** Added Zod schema rejection test to `extract.spec.ts` — validates that structurally-invalid JSON (valid parse, failed safeParse) rejects with descriptive error. 272 tests now pass.
