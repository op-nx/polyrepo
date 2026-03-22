---
phase: 6
slug: add-e2e-container
status: approved
nyquist_compliant: true
wave_0_complete: true
created: 2026-03-16
audited: 2026-03-16
---

# Phase 6 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property               | Value                                                      |
| ---------------------- | ---------------------------------------------------------- |
| **Framework**          | Vitest 4.0.18                                              |
| **Config file**        | `packages/op-nx-polyrepo-e2e/vitest.config.mts`            |
| **Quick run command**  | `npm exec nx e2e op-nx-polyrepo-e2e --output-style=static` |
| **Full suite command** | `npm exec nx e2e op-nx-polyrepo-e2e --output-style=static` |
| **Estimated runtime**  | ~23s warm cache, ~110s warm Docker, ~650s cold start       |

---

## Sampling Rate

- **After every task commit:** Run `npm exec nx e2e op-nx-polyrepo-e2e --output-style=static`
- **After every plan wave:** Run `npm exec nx e2e op-nx-polyrepo-e2e --output-style=static`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 30 seconds (warm cache)

---

## Per-Task Verification Map

| Task ID  | Plan | Wave | Requirement                              | Test Type | Automated Command                                                                | File Exists            | Status         |
| -------- | ---- | ---- | ---------------------------------------- | --------- | -------------------------------------------------------------------------------- | ---------------------- | -------------- |
| 06-01-01 | 01   | 1    | MH-01 (Docker image builds)              | smoke     | `docker build -t op-nx-e2e-workspace:latest packages/op-nx-polyrepo-e2e/docker/` | Dockerfile             | green          |
| 06-01-02 | 01   | 1    | MH-02 (testcontainers lifecycle)         | e2e       | `npm exec nx e2e op-nx-polyrepo-e2e`                                             | global-setup.ts        | green          |
| 06-02-01 | 02   | 2    | MH-07 (container.exec replaces execSync) | e2e       | `npm exec nx e2e op-nx-polyrepo-e2e`                                             | op-nx-polyrepo.spec.ts | green          |
| 06-02-02 | 02   | 2    | SC-01 (under 30s warm)                   | e2e       | `npm exec nx e2e op-nx-polyrepo-e2e` (wall time)                                 | op-nx-polyrepo.spec.ts | green          |
| 06-02-03 | 02   | 2    | SC-02 (identical assertions)             | e2e       | `npm exec nx e2e op-nx-polyrepo-e2e`                                             | op-nx-polyrepo.spec.ts | green          |
| 06-03-01 | 03   | 3    | MH-08 (sync test under 120s)             | e2e       | `npm exec nx e2e op-nx-polyrepo-e2e`                                             | op-nx-polyrepo.spec.ts | green          |
| 06-03-02 | 03   | 3    | SC-03 (no network dep)                   | manual    | N/A                                                                              | N/A                    | green (manual) |
| 06-03-03 | 03   | 3    | SC-04 (layer cache)                      | manual    | N/A                                                                              | N/A                    | green (manual) |

_Status: pending / green / red / flaky / green (manual)_

---

## Wave 0 Requirements

Existing infrastructure covers all phase requirements.

- [x] `packages/op-nx-polyrepo-e2e/docker/Dockerfile` -- prebaked workspace image
- [x] `packages/op-nx-polyrepo-e2e/src/setup/global-setup.ts` -- testcontainers lifecycle
- [x] `packages/op-nx-polyrepo-e2e/src/setup/provided-context.ts` -- ProvidedContext type declaration
- [x] `testcontainers` npm dependency installed

---

## Manual-Only Verifications

| Behavior                                    | Requirement | Why Manual                                                            | Test Instructions                                                                                  |
| ------------------------------------------- | ----------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| No network dependency during test execution | SC-03       | Network isolation is an architecture constraint, not a code assertion | 1. Disconnect internet 2. Run `npm exec nx e2e op-nx-polyrepo-e2e` 3. Verify tests pass            |
| Docker image layer cache efficiency         | SC-04       | Layer caching is a Docker engine behavior                             | 1. Run `docker build` 2. Change only source code 3. Rebuild, verify all layers cached except final |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 30s (warm cache)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-03-16

---

## Validation Audit 2026-03-16

| Metric     | Count |
| ---------- | ----- |
| Gaps found | 0     |
| Resolved   | 0     |
| Escalated  | 0     |

**Audit notes:** Phase 6 declares `requirements: []` -- this is a DX infrastructure phase with no formal requirement IDs. Success criteria derived from ROADMAP.md and plan must_haves. All 4 e2e tests pass (UAT 4/4). VALIDATION.md updated from draft (Plan 01 only) to reflect all 3 plans. Per-Task Map expanded from 4 entries to 8, covering Plans 01-03.
