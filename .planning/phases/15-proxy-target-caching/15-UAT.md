---
status: complete
phase: 15-proxy-target-caching
source: [15-01-SUMMARY.md, 15-02-SUMMARY.md, 15-03-SUMMARY.md, 15-04-SUMMARY.md]
started: 2026-03-22T18:09:00Z
updated: 2026-03-22T18:11:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Proxy targets show cache: true with env input in project graph

expected: After `nx reset`, run `nx show project nx/nx --json`. Every proxy target should have `"cache": true` and `"inputs": [{ "env": "POLYREPO_HASH_NX" }]`.
result: pass

### 2. Default export bundles all plugin hooks

expected: `index.ts` default export includes `createNodesV2`, `createDependencies`, and `preTasksExecution`. Unit tests for default export pass.
result: pass

### 3. preTasksExecution sets env vars for synced repos

expected: Unit tests confirm `preTasksExecution` sets `POLYREPO_HASH_<ALIAS>` env vars based on git HEAD + dirty state. Isolated per-repo; failures produce random UUID + warning.
result: pass

### 4. Plugin version included in graph disk cache key

expected: `computeRepoHash` includes `PLUGIN_VERSION` as first element in hash. Different plugin versions produce different hashes. Unit tests pass (4 tests).
result: pass

### 5. Plugin loads after nx reset

expected: Run `nx reset` then `nx show projects`. External projects listed without plugin load errors.
result: pass

### 6. Full test suite passes

expected: `nx test @op-nx/polyrepo` runs all 389 tests across 16 test files with zero failures.
result: pass

## Summary

total: 6
passed: 6
issues: 0
pending: 0
skipped: 0

## Gaps

[none]
