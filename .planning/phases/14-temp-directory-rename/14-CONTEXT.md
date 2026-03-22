# Phase 14: Temp Directory Rename - Context

**Gathered:** 2026-03-22
**Status:** Ready for planning

<domain>
## Phase Boundary

Replace `.tmp` with `tmp` in child repo temp directories so synced Nx workspaces using the default `create-nx-workspace` `.gitignore` (which includes `tmp`) need no additional gitignore entries for plugin-created temp files. Covers both proxy executor temp isolation and graph extraction temp isolation.

</domain>

<decisions>
## Implementation Decisions

### Directory name

- Rename `.tmp` to `tmp` in both usage sites (executor and graph extraction)
- No other naming alternatives considered — `tmp` is the Nx convention

### Claude's Discretion

- Whether to extract the directory name into a shared constant or keep it inline
- Whether to clean up orphaned `.tmp/` directories from prior runs or leave them
- Test assertion updates — mechanical, match new path

</decisions>

<code_context>

## Existing Code Insights

### Reusable Assets

- None needed — this is a rename in existing code

### Established Patterns

- `normalizePath(join(repoPath, '.tmp'))` pattern used identically in both files
- `mkdirSync(join(repoPath, '.tmp'), { recursive: true })` pattern used identically in both files
- TEMP/TMP/TMPDIR env vars set in executor for cross-platform temp isolation

### Integration Points

- `packages/op-nx-polyrepo/src/lib/executors/run/executor.ts:41-42` — proxy executor temp dir creation + env vars
- `packages/op-nx-polyrepo/src/lib/graph/extract.ts:91-92` — graph extraction temp dir creation + env vars
- `packages/op-nx-polyrepo/src/lib/executors/run/executor.spec.ts:300-302` — test assertions for env var paths

</code_context>

<specifics>
## Specific Ideas

No specific requirements — this is a mechanical rename to align with Nx convention.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

_Phase: 14-temp-directory-rename_
_Context gathered: 2026-03-22_
