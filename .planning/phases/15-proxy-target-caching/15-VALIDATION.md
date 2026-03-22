---
phase: 15
slug: proxy-target-caching
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-22
---

# Phase 15 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property               | Value                                       |
| ---------------------- | ------------------------------------------- |
| **Framework**          | vitest (workspace version)                  |
| **Config file**        | `packages/op-nx-polyrepo/vitest.config.mts` |
| **Quick run command**  | `npm exec nx -- test @op-nx/polyrepo`       |
| **Full suite command** | `npm exec nx -- test @op-nx/polyrepo`       |
| **Estimated runtime**  | ~15 seconds                                 |

---

## Sampling Rate

- **After every task commit:** Run `npm exec nx -- test @op-nx/polyrepo`
- **After every plan wave:** Run `npm exec nx -- test @op-nx/polyrepo`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID  | Plan | Wave | Requirement | Test Type | Automated Command                                                           | File Exists                                                 | Status  |
| -------- | ---- | ---- | ----------- | --------- | --------------------------------------------------------------------------- | ----------------------------------------------------------- | ------- |
| 15-01-01 | 01   | 1    | PROXY-01    | unit      | `npm exec nx -- test @op-nx/polyrepo -t "cache"`                            | Exists (needs update): `transform.spec.ts`                  | pending |
| 15-01-02 | 01   | 1    | PROXY-02    | unit      | `npm exec nx -- test @op-nx/polyrepo -t "input\|preTasksExecution"`         | Exists (needs update): `transform.spec.ts`, `index.spec.ts` | pending |
| 15-01-03 | 01   | 1    | PROXY-03    | unit      | `npm exec nx -- test @op-nx/polyrepo -t "git fail\|random"`                 | New in `index.spec.ts`                                      | pending |
| 15-02-01 | 02   | 2    | PROXY-04    | unit      | `npm exec nx -- test @op-nx/polyrepo -t "nx reset"`                         | New in `executor.spec.ts`                                   | pending |
| 15-XX-XX | --   | --   | PROXY-05    | design    | N/A — satisfied by architecture (env inputs = no daemon-specific code path) | N/A                                                         | pending |

_Status: pending / green / red / flaky_

---

## Wave 0 Requirements

- [ ] `lib/graph/proxy-hash.ts` — new file with `toProxyHashEnvKey` utility
- [ ] `lib/graph/proxy-hash.spec.ts` — unit tests for env key normalization
- [ ] `lib/git/detect.ts` — new `getStatusPorcelain` helper (or verify existing sufficiency)
- [ ] Update `transform.spec.ts` assertions for `cache: true` and `inputs: [{ env: ... }]`
- [ ] New `preTasksExecution` tests in `index.spec.ts`

---

## Manual-Only Verifications

| Behavior                           | Requirement | Why Manual                                                              | Test Instructions                                                     |
| ---------------------------------- | ----------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------- |
| PROXY-05: daemon mode independence | PROXY-05    | Env inputs are architecture-level; no daemon-specific code to unit test | Verified by design — env inputs use stateless `hash_env.rs` code path |

_All other phase behaviors have automated verification._

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
