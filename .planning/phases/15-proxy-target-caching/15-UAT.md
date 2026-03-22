---
status: complete
phase: 15-proxy-target-caching
source: [15-01-SUMMARY.md, 15-02-SUMMARY.md]
started: 2026-03-22T13:30:00Z
updated: 2026-03-22T14:10:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Proxy targets show cache: true with env input in project graph

expected: Run `npm exec nx -- show project nx/nx --json`. Targets should have `"cache": true` and `"inputs": [{ "env": "POLYREPO_HASH_NX" }]`.
result: issue
reported: "Stale graph disk cache at .repos/nx/.polyrepo-graph-cache.json served old cache: false values. After deleting disk cache and nx reset, targets correctly show cache: true and inputs: [{ env: POLYREPO_HASH_NX }]. Graph disk cache key does not include plugin version."
severity: major

### 2. Cache hit on second identical proxy target run

expected: Run a proxy target twice without changing the synced repo. Second run should print "read the output from the cache".
result: issue
reported: "Cache hit occurs but for the wrong reason. preTasksExecution hook never runs because PreTasksExecution API does not exist in Nx 22.5.4. The env var POLYREPO_HASH_NX is never set, so Nx hashes undefined on both runs — producing a constant cache key. Cache hit is accidental, not based on actual git state."
severity: blocker

### 3. Cache miss after synced repo changes

expected: After modifying a file in .repos/nx/, running the same proxy target should NOT hit cache.
result: issue
reported: "Cache hit still occurs after dirtying the repo. preTasksExecution never runs (API absent in Nx 22.5.4), so the env var stays undefined regardless of repo state. Git state changes are invisible to Nx task hashing."
severity: blocker

### 4. Warning logged when repo is not synced

expected: Add an un-cloned repo alias to nx.json, run any nx command. Should see warning about git state check failed.
result: issue
reported: "No warning logged. warnGitFailure is inside preTasksExecution which never executes because the API does not exist in Nx 22.5.4."
severity: major

### 5. Plugin loads correctly after nx reset

expected: Run `npm exec nx -- reset` then `npm exec nx -- show projects`. Should succeed without plugin load errors.
result: pass

## Summary

total: 5
passed: 1
issues: 4
pending: 0
skipped: 0

## Gaps

- truth: "Proxy targets show cache: true with env input immediately after plugin upgrade"
  status: failed
  reason: "User reported: Stale graph disk cache served old cache: false values. Graph disk cache key does not include plugin version."
  severity: major
  test: 1
  root_cause: "polyrepo graph disk cache key (computeRepoHash) does not include plugin version or createProxyTarget output shape — only HEAD SHA + dirty files + repos config"
  artifacts:
  - path: "packages/op-nx-polyrepo/src/lib/graph/cache.ts"
    issue: "computeRepoHash does not factor in plugin version"
    missing:
  - "Include plugin version or code hash in per-repo cache key to invalidate on upgrade"
    debug_session: ""

- truth: "preTasksExecution sets POLYREPO*HASH*<ALIAS> env vars for every configured repo before task hashing"
  status: failed
  reason: "User reported: PreTasksExecution API does not exist in Nx 22.5.4. The hook is exported but never called by Nx."
  severity: blocker
  test: 2
  root_cause: "PreTasksExecution type was referenced from plan research but is not implemented in Nx 22.5.4 runtime. The type does not exist in nx/src/project-graph/plugins/public-api.d.ts. The preTasksExecution export is dead code."
  artifacts:
  - path: "packages/op-nx-polyrepo/src/index.ts"
    issue: "preTasksExecution export is dead code — Nx never invokes it"
  - path: "node_modules/nx/src/project-graph/plugins/public-api.d.ts"
    issue: "Does not contain PreTasksExecution type"
    missing:
  - "Alternative mechanism to set env vars before task hashing that works with Nx 22.5.4"
    debug_session: ""

- truth: "After polyrepo-sync pulls new changes, the proxy target produces a cache miss"
  status: failed
  reason: "User reported: Cache hit still occurs after dirtying the repo. preTasksExecution never runs."
  severity: blocker
  test: 3
  root_cause: "Same as test 2 — preTasksExecution is never invoked by Nx 22.5.4"
  artifacts: []
  missing: []
  debug_session: ""

- truth: "Warning logged when git fails for un-cloned repo"
  status: failed
  reason: "User reported: No warning logged. warnGitFailure lives inside preTasksExecution which is dead code."
  severity: major
  test: 4
  root_cause: "Same as test 2 — preTasksExecution is never invoked by Nx 22.5.4"
  artifacts: []
  missing: []
  debug_session: ""
