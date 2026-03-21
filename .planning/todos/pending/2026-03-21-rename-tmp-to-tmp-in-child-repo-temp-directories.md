---
created: 2026-03-21T20:32:38.662Z
title: Rename .tmp to tmp in child repo temp directories
area: executor
files:
  - packages/op-nx-polyrepo/src/lib/executors/run/executor.ts:41-42
  - packages/op-nx-polyrepo/src/lib/graph/extract.ts:91-92
  - packages/op-nx-polyrepo/src/lib/executors/run/executor.spec.ts
  - packages/op-nx-polyrepo/src/lib/graph/extract.spec.ts
---

## Problem

The proxy executor and graph extraction create per-repo temp directories at `.repos/<alias>/.tmp/` for TEMP/TMP/TMPDIR isolation. This dotfile path requires explicit `.gitignore` entries in each synced repo.

Nx workspaces already gitignore `tmp/` by default (it's in the `create-nx-workspace` scaffold `.gitignore`). Using `tmp/` instead of `.tmp/` would get gitignore coverage for free in every synced Nx workspace.

## Solution

Rename `.tmp` to `tmp` in two locations:
1. `run/executor.ts:41-42` — proxy executor temp dir creation and env var
2. `extract.ts:91-92` — graph extraction temp dir creation and env var

Update corresponding test assertions in `executor.spec.ts` and `extract.spec.ts` (if any assert the `.tmp` path).

Two-line change per file. No behavioral change — just a path rename.
