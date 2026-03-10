---
phase: 1
slug: plugin-foundation-repo-assembly
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-10
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.x (already in devDependencies) |
| **Config file** | None yet — Wave 0 scaffolds via `@nx/plugin:plugin` generator |
| **Quick run command** | `npx nx test nx-openpolyrepo` |
| **Full suite command** | `npx nx run-many -t test` |
| **Estimated runtime** | ~5 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx nx test nx-openpolyrepo`
- **After every plan wave:** Run `npx nx run-many -t test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 10 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| 01-01-01 | 01 | 0 | ASSM-01 | unit | `npx nx test nx-openpolyrepo -- --testPathPattern=config` | Wave 0 | pending |
| 01-01-02 | 01 | 0 | ASSM-04 | unit | `npx nx test nx-openpolyrepo -- --testPathPattern=validate` | Wave 0 | pending |
| 01-02-01 | 02 | 1 | ASSM-02 | unit + integration | `npx nx test nx-openpolyrepo -- --testPathPattern=sync` | Wave 0 | pending |
| 01-02-02 | 02 | 1 | ASSM-03 | unit + integration | `npx nx test nx-openpolyrepo -- --testPathPattern=sync` | Wave 0 | pending |
| 01-02-03 | 02 | 1 | ASSM-04 | unit | `npx nx test nx-openpolyrepo -- --testPathPattern=plugin` | Wave 0 | pending |

*Status: pending / green / red / flaky*

---

## Wave 0 Requirements

- [ ] Plugin project scaffolded via `@nx/plugin:plugin` — creates vitest config, tsconfig, package.json
- [ ] `zod` package installed: `npm install zod`
- [ ] `packages/nx-openpolyrepo/src/lib/config/__tests__/schema.spec.ts` — stubs for ASSM-01, ASSM-04 (config validation)
- [ ] `packages/nx-openpolyrepo/src/lib/executors/sync/__tests__/executor.spec.ts` — stubs for ASSM-02, ASSM-03
- [ ] `packages/nx-openpolyrepo/src/lib/executors/status/__tests__/executor.spec.ts` — stubs for status executor

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `.gitignore` warning at plugin load | ASSM-04 | Relies on workspace-level `.gitignore` state | 1. Remove `.repos/` from `.gitignore` 2. Run any `nx` command 3. Verify warning appears in console output |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
