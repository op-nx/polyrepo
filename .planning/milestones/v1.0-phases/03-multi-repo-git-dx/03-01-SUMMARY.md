---
phase: 03-multi-repo-git-dx
plan: 01
subsystem: git
tags: [git-status, porcelain, ahead-behind, table-formatting, cli-output]

# Dependency graph
requires:
  - phase: 01-plugin-foundation-repo-assembly
    provides: 'detect.ts with execGitOutput helper and git utility functions'
provides:
  - 'getWorkingTreeState for parsing git status --porcelain=v1 into counts'
  - 'getAheadBehind for parsing rev-list --left-right --count output'
  - 'formatAlignedTable for column-aligned CLI output'
affects: [03-02-PLAN, 03-03-PLAN]

# Tech tracking
tech-stack:
  added: []
  patterns:
    [
      execGitRawOutput-for-whitespace-significant-output,
      column-def-alignment-model,
    ]

key-files:
  created:
    - packages/op-nx-polyrepo/src/lib/format/table.ts
    - packages/op-nx-polyrepo/src/lib/format/table.spec.ts
  modified:
    - packages/op-nx-polyrepo/src/lib/git/detect.ts
    - packages/op-nx-polyrepo/src/lib/git/detect.spec.ts

key-decisions:
  - 'Added execGitRawOutput helper to avoid trimming porcelain output leading whitespace'

patterns-established:
  - 'ColumnDef model: {value, align?} for declarative table alignment'
  - 'execGitRawOutput: use when git output has significant leading whitespace (porcelain)'

requirements-completed: [GITX-01, GITX-03]

# Metrics
duration: 4min
completed: 2026-03-11
---

# Phase 3 Plan 1: Git State Detection and Table Formatting Summary

**getWorkingTreeState/getAheadBehind for porcelain status parsing, formatAlignedTable for column-aligned CLI output**

## Performance

- **Duration:** 4 min
- **Started:** 2026-03-11T11:34:55Z
- **Completed:** 2026-03-11T11:38:56Z
- **Tasks:** 2
- **Files modified:** 4

## Accomplishments

- getWorkingTreeState parses git status --porcelain=v1 into modified/staged/deleted/untracked/conflicts counts
- getAheadBehind parses rev-list ahead/behind counts with graceful null on failure
- formatAlignedTable produces column-aligned string output with configurable left/right alignment

## Task Commits

Each task was committed atomically (TDD: test then feat):

1. **Task 1: Add getWorkingTreeState and getAheadBehind** - `721c3d2` (test), `d02352b` (feat)
2. **Task 2: Create format/table.ts column alignment utility** - `b0d256f` (test), `d8c004b` (feat)

_Note: TDD tasks have two commits each (RED test then GREEN implementation)_

## Files Created/Modified

- `packages/op-nx-polyrepo/src/lib/git/detect.ts` - Added WorkingTreeState/AheadBehind interfaces, getWorkingTreeState, getAheadBehind, execGitRawOutput
- `packages/op-nx-polyrepo/src/lib/git/detect.spec.ts` - 16 new tests for getWorkingTreeState (11) and getAheadBehind (5)
- `packages/op-nx-polyrepo/src/lib/format/table.ts` - ColumnDef interface, formatAlignedTable function
- `packages/op-nx-polyrepo/src/lib/format/table.spec.ts` - 7 tests for formatAlignedTable

## Decisions Made

- Added execGitRawOutput helper (no trim) because git status --porcelain=v1 output has significant leading whitespace (space character as X position indicator) that gets stripped by execGitOutput's stdout.trim()

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Added execGitRawOutput to preserve porcelain leading whitespace**

- **Found during:** Task 1 (getWorkingTreeState implementation)
- **Issue:** execGitOutput trims stdout, stripping the leading space in ' M file.ts' porcelain lines, causing X position misparse
- **Fix:** Created execGitRawOutput that returns stdout without trimming, used by getWorkingTreeState
- **Files modified:** packages/op-nx-polyrepo/src/lib/git/detect.ts
- **Verification:** All 11 getWorkingTreeState tests pass including ' M' (space-M) working tree modification lines
- **Committed in:** d02352b (Task 1 feat commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Essential for correctness -- porcelain parsing requires exact character positions.

## Issues Encountered

None

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- getWorkingTreeState and getAheadBehind ready for Plan 02 (status rewrite) and Plan 03 (sync enhancements)
- formatAlignedTable ready for Plan 02 (status output formatting)
- All 201 tests pass (194 existing + 7 new = 201 total)

## Self-Check: PASSED

All 4 files verified present. All 4 commit hashes verified in git log.

---

_Phase: 03-multi-repo-git-dx_
_Completed: 2026-03-11_
