---
phase: 12
slug: resolve-the-cross-repo-build-cascade-issue-when-syncing-external-nrwl-nx-repo-on-windows
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-21
---

# Phase 12 — Validation Strategy

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

| Task ID  | Plan | Wave | Requirement                                | Test Type | Automated Command                            | File Exists  | Status  |
| -------- | ---- | ---- | ------------------------------------------ | --------- | -------------------------------------------- | ------------ | ------- |
| 12-01-01 | 01   | 1    | dependsOn preserved with caret syntax      | unit      | `npm exec nx -- test @op-nx/polyrepo`        | Needs update | pending |
| 12-01-02 | 01   | 1    | dependsOn set to [] when absent            | unit      | `npm exec nx -- test @op-nx/polyrepo`        | Needs update | pending |
| 12-01-03 | 01   | 1    | Object dependsOn namespaces projects array | unit      | `npm exec nx -- test @op-nx/polyrepo`        | Wave 0       | pending |
| 12-01-04 | 01   | 1    | projects: "self" passes through            | unit      | `npm exec nx -- test @op-nx/polyrepo`        | Wave 0       | pending |
| 12-01-05 | 01   | 1    | Tag selectors pass through                 | unit      | `npm exec nx -- test @op-nx/polyrepo`        | Wave 0       | pending |
| 12-02-01 | 02   | 1    | Proxy executor passes env vars             | unit      | `npm exec nx -- test @op-nx/polyrepo`        | Wave 0       | pending |
| 12-02-02 | 02   | 1    | Windows build: nx/devkit:build succeeds    | manual    | Manual: `npm exec nx -- run nx/devkit:build` | N/A          | pending |

_Status: pending / green / red / flaky_

---

## Wave 0 Requirements

- [ ] Update `transform.spec.ts` "dependsOn omission" describe block to "dependsOn preservation"
- [ ] Add test cases for object-style dependsOn with projects array namespacing
- [ ] Add test cases for `projects: "self"` pass-through
- [ ] Add test cases for tag selector pass-through
- [ ] Add `executor.spec.ts` tests for env var passing

_Existing infrastructure covers framework and config — only new test cases needed._

---

## Manual-Only Verifications

| Behavior                                          | Requirement              | Why Manual                                       | Test Instructions                                                                                            |
| ------------------------------------------------- | ------------------------ | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| nx/devkit:build succeeds via proxy on Windows     | Windows build resolution | Requires synced nrwl/nx repo and Windows runtime | 1. `npm exec nx -- run nx/devkit:build` 2. Verify exit code 0 3. Check no SQLite locking errors              |
| No amplified cascade on `nx test @op-nx/polyrepo` | targetDefaults isolation | Requires full project graph with synced repo     | 1. `npm exec nx -- test @op-nx/polyrepo` 2. Verify only expected deps build (not all 150 nx/\* test targets) |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
