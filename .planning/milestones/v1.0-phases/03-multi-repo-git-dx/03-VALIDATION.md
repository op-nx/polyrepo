---
phase: 3
slug: multi-repo-git-dx
status: approved
nyquist_compliant: true
wave_0_complete: true
created: 2026-03-11
audited: 2026-03-11
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property               | Value                                       |
| ---------------------- | ------------------------------------------- |
| **Framework**          | Vitest 4.x                                  |
| **Config file**        | `packages/op-nx-polyrepo/vitest.config.mts` |
| **Quick run command**  | `npm exec nx test @op-nx/polyrepo`          |
| **Full suite command** | `npm exec nx test @op-nx/polyrepo`          |
| **Estimated runtime**  | ~1 second                                   |
| **Total tests**        | 275                                         |
| **Test files**         | 13                                          |

---

## Sampling Rate

- **After every task commit:** Run `npm exec nx test @op-nx/polyrepo`
- **After every plan wave:** Run `npm exec nx test @op-nx/polyrepo`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID  | Plan | Wave | Requirement      | Test Type | Automated Command                                                                 | File Exists | Status |
| -------- | ---- | ---- | ---------------- | --------- | --------------------------------------------------------------------------------- | ----------- | ------ |
| 03-01-01 | 01   | 1    | GITX-01          | unit      | `npm exec nx test @op-nx/polyrepo -- --reporter=verbose -t "getWorkingTreeState"` | Yes         | green  |
| 03-01-02 | 01   | 1    | GITX-01          | unit      | `npm exec nx test @op-nx/polyrepo -- --reporter=verbose -t "getAheadBehind"`      | Yes         | green  |
| 03-01-03 | 01   | 1    | GITX-03          | unit      | `npm exec nx test @op-nx/polyrepo -- --reporter=verbose -t "formatAlignedTable"`  | Yes         | green  |
| 03-02-01 | 02   | 2    | GITX-01          | unit      | `npm exec nx test @op-nx/polyrepo -- --reporter=verbose -t "statusExecutor"`      | Yes         | green  |
| 03-02-02 | 02   | 2    | GITX-01          | unit      | `npm exec nx test @op-nx/polyrepo -- --reporter=verbose -t "auto-fetch"`          | Yes         | green  |
| 03-02-03 | 02   | 2    | GITX-01          | unit      | `npm exec nx test @op-nx/polyrepo -- --reporter=verbose -t "project count"`       | Yes         | green  |
| 03-02-04 | 02   | 2    | GITX-01          | unit      | `npm exec nx test @op-nx/polyrepo -- --reporter=verbose -t "WARN"`                | Yes         | green  |
| 03-03-01 | 03   | 2    | GITX-02          | unit      | `npm exec nx test @op-nx/polyrepo -- --reporter=verbose -t "dry-run"`             | Yes         | green  |
| 03-03-02 | 03   | 2    | GITX-03          | unit      | `npm exec nx test @op-nx/polyrepo -- --reporter=verbose -t "summary table"`       | Yes         | green  |
| 03-04-01 | 04   | 3    | GITX-01          | unit      | `npm exec nx test @op-nx/polyrepo -- --reporter=verbose -t "behind"`              | Yes         | green  |
| 03-04-02 | 04   | 3    | GITX-01          | unit      | `npm exec nx test @op-nx/polyrepo -- --reporter=verbose -t "tag-pinned"`          | Yes         | green  |
| 03-05-01 | 05   | 3    | GITX-02          | unit      | `npm exec nx test @op-nx/polyrepo -- --reporter=verbose -t "detached HEAD"`       | Yes         | green  |
| 03-05-02 | 05   | 3    | GITX-03          | unit      | `npm exec nx test @op-nx/polyrepo -- --reporter=verbose -t "multi-warning"`       | Yes         | green  |
| 03-06-01 | 06   | 4    | GITX-01          | unit      | `npm exec nx test @op-nx/polyrepo -- --reporter=verbose -t "behind"`              | Yes         | green  |
| 03-07-01 | 07   | 4    | GITX-02          | unit      | `npm exec nx test @op-nx/polyrepo -- --reporter=verbose -t "disableHooks"`        | Yes         | green  |
| 03-08-01 | 08   | 5    | GITX-01, GITX-02 | unit      | `npm exec nx test @op-nx/polyrepo -- --reporter=verbose -t "isGitTag"`            | Yes         | green  |
| 03-08-02 | 08   | 5    | GITX-02          | unit      | `npm exec nx test @op-nx/polyrepo -- --reporter=verbose -t "branch transition"`   | Yes         | green  |
| 03-09-01 | 09   | 5    | GITX-02          | unit      | `npm exec nx test @op-nx/polyrepo -- --reporter=verbose -t "conditional"`         | Yes         | green  |

_Status: pending / green / red / flaky_

---

## Wave 0 Requirements

- [x] `detect.spec.ts` -- tests for `getWorkingTreeState`, `getAheadBehind` (GITX-01)
- [x] `format/table.spec.ts` -- tests for `formatAlignedTable` (GITX-03)
- [x] `status/executor.spec.ts` -- tests for output format, auto-fetch, project counts, warnings (GITX-01)
- [x] `sync/executor.spec.ts` -- tests for `--dry-run` and summary table (GITX-02, GITX-03)

_All Wave 0 requirements fulfilled via TDD during execution (RED-GREEN commits)._

---

## Manual-Only Verifications

| Behavior                           | Requirement      | Why Manual                 | Test Instructions                                                                              |
| ---------------------------------- | ---------------- | -------------------------- | ---------------------------------------------------------------------------------------------- |
| Aligned columns visually scannable | GITX-01, GITX-03 | Visual formatting judgment | Run `npm exec nx polyrepo-status` with 3+ repos of varying alias lengths; verify columns align |

---

## Validation Sign-Off

- [x] All tasks have automated verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 10s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-03-11

---

## Validation Audit 2026-03-11

| Metric               | Count |
| -------------------- | ----- |
| Gaps found           | 0     |
| Resolved             | 0     |
| Escalated            | 0     |
| Total tasks audited  | 18    |
| Total tests in suite | 275   |
| Test files           | 13    |
| UAT tests passed     | 14/14 |
