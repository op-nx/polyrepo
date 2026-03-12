---
status: complete
phase: 02-unified-project-graph
source: [02-01-SUMMARY.md, 02-02-SUMMARY.md, 02-03-SUMMARY.md]
started: 2026-03-12T00:00:00Z
updated: 2026-03-12T00:10:00Z
---

## Current Test
<!-- OVERWRITE each test - shows where we are -->

[testing complete]

## Tests

### 1. External Projects in nx show projects
expected: Run `npm exec nx -- show projects`. Output lists external repo projects alongside host workspace projects (e.g., `nx/devkit`, `nx/nx`). Total ~152 projects if the `nx` repo is synced.
result: issue
reported: "Still only host workspace projects after sync. .repos/nx/ exists with node_modules and graph cache, but nx show projects only returns 3 host projects. However, polyrepo-status shows 'nx  master  +0 -0  clean  149 projects' — so the graph cache is populated and readable, but createNodesV2 is not registering external projects in the Nx project graph."
severity: major

### 2. Namespaced Project Names
expected: In the `nx show projects` output, all external projects are prefixed with the repo alias (e.g., `nx/devkit`, `nx/create-nx-workspace`). No bare project names from the external repo appear without the prefix.
result: skipped
reason: Blocked by Test 1 — external projects not visible in nx show projects

### 3. Proxy Target Execution
expected: Run `npm exec nx -- run nx/devkit:build`. The build delegates to the child repo's Nx, builds devkit and its dependencies, and completes successfully with output streamed to terminal.
result: skipped
reason: Blocked by Test 1 — Nx cannot find project 'nx/devkit' because external projects not registered

### 4. Graph Visualization
expected: Run `npm exec nx graph`. Browser opens showing the project graph. External repo projects appear as nodes in the graph alongside host workspace projects. Dependency edges between external projects are visible.
result: skipped
reason: Blocked by Test 1 — external projects not in Nx project graph

### 5. Cache Survives nx reset
expected: Run `npm exec nx reset`, then `npm exec nx -- show projects`. External projects still appear in output without re-running `nx polyrepo-sync`. The cached graph in `.repos/.polyrepo-graph-cache.json` persists across reset.
result: skipped
reason: Blocked by Test 1 — external projects not in Nx project graph. Cache file itself exists and is readable by polyrepo-status.

## Summary

total: 5
passed: 0
issues: 1
pending: 0
skipped: 4

## Gaps

- truth: "External repo projects appear in nx show projects output alongside host workspace projects"
  status: failed
  reason: "User reported: Still only host workspace projects after sync. .repos/nx/ exists with node_modules and graph cache, but nx show projects only returns 3 host projects. polyrepo-status sees 149 projects — graph cache is populated but createNodesV2 is not registering external projects."
  severity: major
  test: 1
  artifacts: []
  missing: []
