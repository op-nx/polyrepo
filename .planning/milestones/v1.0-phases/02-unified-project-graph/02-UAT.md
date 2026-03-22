---
status: passed
phase: 02-unified-project-graph
source: [02-01-SUMMARY.md, 02-02-SUMMARY.md, 02-03-SUMMARY.md]
started: 2026-03-12T00:00:00Z
updated: 2026-03-12T08:25:00Z
---

## Current Test

<!-- OVERWRITE each test - shows where we are -->

[testing complete]

## Tests

### 1. External Projects in nx show projects

expected: Run `npm exec nx -- show projects`. Output lists external repo projects alongside host workspace projects (e.g., `nx/devkit`, `nx/nx`). Total ~152 projects if the `nx` repo is synced.
result: pass

### 2. Namespaced Project Names

expected: In the `nx show projects` output, all external projects are prefixed with the repo alias (e.g., `nx/devkit`, `nx/create-nx-workspace`). No bare project names from the external repo appear without the prefix.
result: pass

### 3. Proxy Target Execution

expected: Run `npm exec nx -- run nx/devkit:build`. The build delegates to the child repo's Nx, builds devkit and its dependencies, and completes successfully with output streamed to terminal.
result: pass

### 4. Graph Visualization

expected: Run `npm exec nx graph`. Browser opens showing the project graph. External repo projects appear as nodes in the graph alongside host workspace projects. Dependency edges between external projects are visible.
result: pass

### 5. Cache Survives nx reset

expected: Run `npm exec nx reset`, then `npm exec nx -- show projects`. External projects still appear in output without re-running `nx polyrepo-sync`. The cached graph in `.repos/.polyrepo-graph-cache.json` persists across reset.
result: pass
note: "Re-computed graph in ~4-5s from disk cache after nx reset"

## Summary

total: 5
passed: 5
issues: 0
pending: 0
skipped: 0

## Gaps

- truth: "External repo projects appear in nx show projects output alongside host workspace projects"
  status: resolved
  reason: "User reported: Still only host workspace projects after sync. .repos/nx/ exists with node_modules and graph cache, but nx show projects only returns 3 host projects. polyrepo-status sees 149 projects — graph cache is populated but createNodesV2 is not registering external projects."
  severity: major
  test: 1
  root_cause: "Stdout contamination in extractGraphFromRepo. Child nx graph --print inherits NX_VERBOSE_LOGGING from parent daemon env, causing [isolated-plugin] log lines on stdout before JSON payload. JSON.parse fails, error silently caught in index.ts:39-46, createNodesV2 returns only root workspace entry."
  artifacts:
  - path: "packages/op-nx-polyrepo/src/lib/graph/extract.ts"
    issue: "env spread inherits NX_VERBOSE_LOGGING from parent process, contaminating stdout"
  - path: "packages/op-nx-polyrepo/src/index.ts"
    issue: "Silent try/catch at lines 39-46 swallows JSON parse error"
    missing:
  - "Suppress NX_VERBOSE_LOGGING and NX_PERF_LOGGING in child process env in extract.ts"
  - "Consider logging the extraction error more visibly in index.ts"
    debug_session: ".planning/debug/external-projects-not-appearing.md"
