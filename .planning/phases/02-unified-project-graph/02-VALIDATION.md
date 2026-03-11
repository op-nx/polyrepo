---
phase: 2
slug: unified-project-graph
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-03-11
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.x |
| **Config file** | `packages/op-nx-polyrepo/vitest.config.mts` |
| **Quick run command** | `npx nx test op-nx-polyrepo` |
| **Full suite command** | `npx nx run-many -t test,lint,typecheck` |
| **Estimated runtime** | ~15 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npx nx test op-nx-polyrepo`
- **After every plan wave:** Run `npx nx run-many -t test,lint,typecheck`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** 15 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| TBD | TBD | TBD | GRPH-01 | unit + e2e | `npx nx test op-nx-polyrepo` | Partially | pending |
| TBD | TBD | TBD | GRPH-02 | e2e | `npx nx e2e op-nx-polyrepo-e2e` | Partially | pending |
| TBD | TBD | TBD | GRPH-03 | unit | `npx nx test op-nx-polyrepo` | No -- Wave 0 | pending |
| TBD | TBD | TBD | GRPH-04 | unit | `npx nx test op-nx-polyrepo` | No -- Wave 0 | pending |

*Status: pending / green / red / flaky*

---

## Wave 0 Requirements

- [ ] `src/lib/graph/extract.spec.ts` — covers graph JSON extraction and parsing (GRPH-01)
- [ ] `src/lib/graph/transform.spec.ts` — covers namespace prefixing, tag injection, target rewriting (GRPH-03)
- [ ] `src/lib/graph/cache.spec.ts` — covers two-layer cache invalidation logic (GRPH-04)
- [ ] `src/lib/graph/types.ts` — TypeScript interfaces for graph report structures
- [ ] `src/lib/executors/run/executor.spec.ts` — covers proxy executor
- [ ] `src/lib/executors/run/schema.json` — executor schema
- [ ] `src/lib/git/normalize-url.spec.ts` — covers URL normalization for duplicate detection
- [ ] Registration of `run` executor in `executors.json`

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `nx graph` visualizes external projects | GRPH-01 | Visual graph rendering requires browser | Run `nx graph` and verify external projects appear in visualization |
| `nx show projects` lists external projects | GRPH-02 | Requires assembled repos in .repos/ | Clone a test repo, run sync, then `nx show projects` |

---

## Validation Sign-Off

- [ ] All tasks have automated verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 15s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
