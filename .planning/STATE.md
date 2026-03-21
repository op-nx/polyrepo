---
gsd_state_version: 1.0
milestone: v1.1
milestone_name: Cross-repo Dependencies
status: in-progress
stopped_at: "12-02-PLAN.md Task 2 checkpoint (human-verify)"
last_updated: "2026-03-21T11:39:01Z"
last_activity: 2026-03-21 --- Completed Phase 12 Plan 2 Task 1 (verification + preVersionCommand cleanup)
progress:
  total_phases: 5
  completed_phases: 4
  total_plans: 11
  completed_plans: 10
  percent: 95
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-03-17)

**Core value:** `nx graph` displays projects from all synced repos with cross-repo dependency edges, and all relevant Nx CLI commands output projects from multiple repos
**Current focus:** Phase 12 -- targetDefaults isolation and cross-repo build cascade fix

## Current Position

Phase: 12 of 12 (Resolve cross-repo build cascade) -- IN PROGRESS
Plan: 2 of 2 in Phase 12 (checkpoint: human-verify)
Status: Plan 12-02 Task 1 complete -- preVersionCommand cleaned up, awaiting user verification
Last activity: 2026-03-21 --- Completed Phase 12 Plan 2 Task 1 (verification + preVersionCommand cleanup)

Progress: [█████████░] 95%

## Performance Metrics

**Velocity:**
- Total plans completed: 9 (v1.1)
- Average duration: ~7 minutes
- Total execution time: ~62 minutes

| Phase | Plan | Duration | Tasks | Files |
|-------|------|----------|-------|-------|
| 11 | 01 | 4min | 2 | 3 |
| 11 | 02 | 6min | 1 | 2 |
| 11 | 03 | 12min | 3 | 6 |
| 12 | 01 | 6min | 2 | 4 |
| 12 | 02 | 18min | 1 | 1 |

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

- [Phase 11-daemon-cache]: Per-repo hash uses hashArray([reposConfigHash, alias, headSha, dirtyFiles]) -- lockfile hash unnecessary
- [Phase 11-daemon-cache]: Backoff formula min(2000 * 2^(attempt-1), 30000)ms with immediate reset on hash change
- [Phase 11-daemon-cache]: Global gate checks both hash match and all-repos-cached to retry failed repos
- [Phase 11-daemon-cache]: RepoGraphData uses interface instead of type alias for consistency

- [Phase 11-sync-precache]: Pre-cache at every syncRepo exit point where repo was updated, not just when install runs
- [Phase 11-sync-precache]: hashObject(config.repos) computes reposConfigHash identically to index.ts for hash consistency
- [Phase 11-sync-precache]: Pre-cache failure is non-blocking -- warns and continues, plugin extracts on next Nx command

- [Phase 11-e2e-daemon]: NX_DAEMON removed from Dockerfile workspace ENV -- controlled by test environment via container.ts withEnvironment
- [Phase 11-e2e-daemon]: Daemon stopped after every writeNxJson to prevent stale graph cache when daemon is running
- [Phase 11-e2e-daemon]: E2e tests require --exclude-task-dependencies due to ^build cascade into synced repos (future phase)

- [Phase 12-01]: rewriteDependsOn namespaces only project names in object entries with projects arrays; string entries and keywords pass through
- [Phase 12-01]: Tag selectors (tag:*) in projects arrays pass through unchanged since tags preserved on namespaced projects
- [Phase 12-01]: Non-array dependsOn values treated as absent, return [] for targetDefaults blocking

- [Phase 12-02]: --exclude-task-dependencies removed from preVersionCommand: proxy executor with env isolation handles cross-repo cascade correctly
- [Phase 12-02]: Stale disk cache cleared after plugin transform logic changes: cache hash based on repo state, not plugin code version
- [Phase 12-02]: Host targetDefaults.test.dependsOn override on external targets accepted: cosmetically incorrect but functionally harmless

### Pending Todos

2 pending:
- [sync] Parse pnpm ndjson reporter for concise install progress
- [detection] Migrate auto-detected edges from implicit to static

### Roadmap Evolution

- Phase 11 added: Full Nx Daemon Support — make the plugin work with NX_DAEMON=true (default), NX_DAEMON=false, and unset
- Phase 12 added: Resolve the cross-repo build cascade issue when syncing external nrwl/nx repo on Windows

### Blockers/Concerns

- **Cold start with daemon**: First extraction after sync needs `NX_DAEMON=false`
- **Pop-over cmd windows on Windows**: Nx `runCommandsImpl` spawns without `windowsHide`
- **Scaling**: ~4s for 150 projects from cached graph; may need optimization for 500+ project workspaces
- **Task cascading via ^build**: RESOLVED in Phase 12 -- proxy executor with dependsOn preservation and env isolation handles cascade correctly. --exclude-task-dependencies workaround removed.

## Session Continuity

Last session: 2026-03-21T11:39:01Z
Stopped at: 12-02-PLAN.md Task 2 checkpoint (human-verify)
Resume: User verifies end-to-end fix, then continuation agent completes Task 2 and finalizes
