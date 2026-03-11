---
created: 2026-03-11T12:40:29.590Z
title: Optimize sync skip package install when lockfile unchanged
area: sync
files:
  - packages/op-nx-polyrepo/src/lib/executors/sync/executor.ts:126-137
  - packages/op-nx-polyrepo/src/lib/executors/sync/executor.ts:160
  - packages/op-nx-polyrepo/src/lib/executors/sync/executor.ts:169
  - packages/op-nx-polyrepo/src/lib/executors/sync/executor.ts:178
  - packages/op-nx-polyrepo/src/lib/executors/sync/executor.ts:196
---

## Problem

`tryInstallDeps` runs unconditionally after every sync action (clone, pull, fetch tag, local pull) even when no dependencies changed. This adds ~13s overhead per sync. For fetch-only strategy (`git fetch`), the working tree is untouched so install is always unnecessary.

## Solution

1. **After pull/rebase/ff-only:** Use `git diff HEAD@{1} --name-only -- pnpm-lock.yaml yarn.lock package-lock.json` to check if the lockfile changed. Only run install when it did.
2. **After clone:** Always install (no prior state).
3. **After fetch-only:** Skip install entirely (working tree untouched, only remote refs updated).
4. **After fetch tag:** Evaluate — if checkout happens, check lockfile diff; if only tag ref fetched, skip.
