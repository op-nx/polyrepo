---
gsd_state_version: 1.0
milestone: v1.1
milestone_name: Cross-repo Dependencies
status: completed
stopped_at: Completed 10-integration-and-end-to-end-validation-03-PLAN.md
last_updated: "2026-03-19T17:30:00Z"
last_activity: 2026-03-19 --- Resolved fileMap guard with namedInputs override; all 7 e2e tests pass
progress:
  total_phases: 3
  completed_phases: 3
  total_plans: 6
  completed_plans: 6
  percent: 100
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-17)

**Core value:** `nx graph` displays projects from all synced repos with cross-repo dependency edges, and all relevant Nx CLI commands output projects from multiple repos
**Current focus:** Milestone v1.1 complete -- all phases executed, gap closure done

## Current Position

Phase: 10 of 10 (Integration and End-to-End Validation)
Plan: 3 of 3 in Phase 10 (complete)
Status: Milestone v1.1 complete -- all 6 plans across 3 phases executed (including gap closure)
Last activity: 2026-03-18 --- Completed Phase 10 Plan 3 (gap closure -- fileMap guard fix and e2e restoration)

Progress: [██████████] 100%

## Performance Metrics

**Velocity:**
- Total plans completed: 6 (v1.1)
- Average duration: ~6.7 minutes
- Total execution time: ~40 minutes

## Accumulated Context

### Decisions

Decisions are logged in PROJECT.md Key Decisions table.
Recent decisions affecting current work:

- [v1.1 roadmap]: Coarse granularity -- 3 phases following data flow (schema+extraction -> detection -> integration+e2e)
- [v1.1 roadmap]: DETECT-05 (lookup map) assigned to Phase 8 as foundational data prerequisite for detection
- [Phase 08]: implicitDependencies validated as Record<string,string[]> at schema level; glob semantics deferred to Phase 9 where full project graph is available
- [Phase 08]: package.json path constructed from original node.data.root to avoid double-path pitfall (.repos/<alias> + original root)
- [Phase 09-cross-repo-dependency-detection]: External TransformedNode.packageName wins over host project packageName on collision in lookup map
- [Phase 09-cross-repo-dependency-detection]: DependencyType.static used for all dep-list edges regardless of dev/prod field distinction
- [Phase 09-cross-repo-dependency-detection]: __host__ sentinel string used as repo alias for host projects in cross-repo guard
- [Phase 09-cross-repo-dependency-detection]: Provider-side tsconfig path aliases expand lookup map for repos without packageName on nodes
- [Phase 09-cross-repo-dependency-detection]: Negation suppression applied as post-filter after full auto-detection accumulation (not inline skip)
- [Phase 09-cross-repo-dependency-detection]: Override validation uses allProjectNames (external + host) to support patterns targeting host projects
- [Phase 10-integration]: Extraction try/catch restructured so config and report survive to detection call while OVRD-03 errors propagate
- [Phase 10-integration]: DETECT-07 deferral documented inline in index.ts near the detection call with root cause and future solution
- [Phase 10-integration]: E2e cross-repo tests share container with polyrepo-status to reuse synced state; project names discovered dynamically from graph output
- [Phase 10-gap-closure]: Removed fileMap guard entirely for cross-repo edges -- context.projects check sufficient since all cross-repo edges are implicit type
- [Phase 10-gap-closure]: @nx/devkit injection in auto-detect e2e test guarantees packageName match with nrwl/nx repo
- [Phase 10-fileMap-fix]: namedInputs override on external projects (all workspace-level named inputs set to []) prevents native task hasher crash
- [Phase 10-fileMap-fix]: Cache key uses only repos config hash, not full options hash -- detection-only options (overrides, negations) don't invalidate extraction cache
- [Phase 10-fileMap-fix]: Cross-repo edges target project nodes directly (not externalNodes) because nx graph --print prunes externalNodes from output

### Pending Todos

2 pending:
- [sync] Parse pnpm ndjson reporter for concise install progress
- [detection] Migrate auto-detected edges from implicit to static

### Roadmap Evolution

- Phase 10.1 inserted after Phase 10: Make the plugin work both with and without the Nx Daemon (URGENT)

### Blockers/Concerns

- **Cold start with daemon**: First extraction after sync needs `NX_DAEMON=false`
- **Pop-over cmd windows on Windows**: Nx `runCommandsImpl` spawns without `windowsHide`
- **Scaling**: ~4s for 150 projects from cached graph; may need optimization for 500+ project workspaces
- **Task cascading via ^build**: Cross-repo edges cause ^build to cascade into external repo builds. Workaround: run vitest/eslint directly, or use --exclude-task-dependencies. Pre-version command already uses this flag.

## Session Continuity

Last session: 2026-03-19T17:30:00Z
Stopped at: fileMap guard resolved, all e2e pass
Resume: Milestone v1.1 complete -- /gsd:audit-milestone
