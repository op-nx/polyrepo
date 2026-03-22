---
phase: 9
slug: cross-repo-dependency-detection
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-17
---

# Phase 9 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property               | Value                                                |
| ---------------------- | ---------------------------------------------------- |
| **Framework**          | Vitest                                               |
| **Config file**        | `packages/op-nx-polyrepo/vitest.config.mts`          |
| **Quick run command**  | `pnpm nx test @op-nx/polyrepo --output-style=static` |
| **Full suite command** | `pnpm nx test @op-nx/polyrepo --output-style=static` |
| **Estimated runtime**  | ~10 seconds                                          |

---

## Sampling Rate

- **After every task commit:** Run `pnpm nx test @op-nx/polyrepo --output-style=static`
- **After every plan wave:** Run `pnpm nx test @op-nx/polyrepo --output-style=static`
- **Before `/gsd:verify-work`:** Full suite must be green + `pnpm nx build @op-nx/polyrepo --output-style=static`
- **Max feedback latency:** ~10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement                                                           | Test Type   | Automated Command                                    | File Exists | Status     |
| ------- | ---- | ---- | --------------------------------------------------------------------- | ----------- | ---------------------------------------------------- | ----------- | ---------- |
| 9-01-01 | 01   | 0    | DETECT-01, DETECT-02, DETECT-03, DETECT-04, OVRD-01, OVRD-02, OVRD-03 | unit (stub) | `pnpm nx test @op-nx/polyrepo --output-style=static` | ❌ W0       | ⬜ pending |
| 9-02-01 | 02   | 1    | DETECT-01, DETECT-02, DETECT-03                                       | unit        | `pnpm nx test @op-nx/polyrepo --output-style=static` | ❌ W0       | ⬜ pending |
| 9-02-02 | 02   | 1    | DETECT-04                                                             | unit        | `pnpm nx test @op-nx/polyrepo --output-style=static` | ❌ W0       | ⬜ pending |
| 9-02-03 | 02   | 1    | OVRD-01, OVRD-02                                                      | unit        | `pnpm nx test @op-nx/polyrepo --output-style=static` | ❌ W0       | ⬜ pending |
| 9-02-04 | 02   | 1    | OVRD-03                                                               | unit        | `pnpm nx test @op-nx/polyrepo --output-style=static` | ❌ W0       | ⬜ pending |

_Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky_

---

## Wave 0 Requirements

- [ ] `packages/op-nx-polyrepo/src/lib/graph/detect.spec.ts` — stubs for DETECT-01, DETECT-02, DETECT-03, DETECT-04, OVRD-01, OVRD-02, OVRD-03
- [ ] `packages/op-nx-polyrepo/src/lib/graph/detect.ts` — the module under test (skeleton/stub)

_Existing infrastructure (vitest config, `assertDefined`, SIFERS pattern, Zod mocking patterns) covers everything else. No new config or shared fixture files needed._

---

## Manual-Only Verifications

_All phase behaviors have automated verification._

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
