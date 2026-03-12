# Requirements: nx-openpolyrepo

**Defined:** 2026-03-10
**Core Value:** `nx graph` displays projects from all synced repos with cross-repo dependency edges, and all relevant Nx CLI commands output projects from multiple repos

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Repo Assembly

- [x] **ASSM-01**: User can configure repos (URL + optional local path alias) in nx.json plugin options
- [x] **ASSM-02**: Plugin clones configured repos into `.repos/` directory on first run
- [x] **ASSM-03**: Plugin pulls latest changes for already-cloned repos when assembly is triggered
- [x] **ASSM-04**: Config is validated at plugin load time with clear error messages for invalid entries

### Project Graph

- [x] **GRPH-01**: Projects from synced repos appear in `nx graph` visualization
- [x] **GRPH-02**: Projects from synced repos appear in `nx show projects` output
- [x] **GRPH-03**: External repo projects are namespaced with repo prefix (e.g., `repo-b/my-lib`) to prevent collisions
- [x] **GRPH-04**: Graph extraction uses cached JSON files (pre-computed during assembly, not on every nx command)

### Multi-Repo Git DX

- [x] **GITX-01**: User can see combined git status of all synced repos in one command
- [x] **GITX-02**: User can pull/fetch all synced repos with one command
- [x] **GITX-03**: Git operations show clear per-repo output (which repo succeeded/failed)

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Repo Assembly

- **ASSM-05**: Pin each repo to a specific branch, tag, or commit SHA
- **ASSM-06**: Selective assembly via profiles/groups
- **ASSM-07**: Stale repo detection (warn when behind remote)

### Cross-Repo Dependencies

- **DEPS-01**: Auto-detect dependencies from package.json
- **DEPS-02**: Explicit dependency overrides for non-npm relationships
- **DEPS-03**: Affected analysis works across repo boundaries

### Generators & Sync

- **GENR-01**: `init` generator for first-time setup
- **GENR-02**: `add-repo` generator for interactive repo addition
- **GENR-03**: Sync generator for tsconfig paths
- **GENR-04**: Sync generator for .gitignore management

### Multi-Repo Git DX

- **GITX-04**: Selective git operations (pick which repos)

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Non-Nx repo support | Requires fundamentally different project inference approach |
| Cross-repo conformance rules | Enterprise-grade feature, defer to v2+ |
| Watch mode across repos | High complexity, unclear value without cross-repo deps |
| Custom workspace visualization | `nx graph` is sufficient for v1 |
| npm node version scoping | Edge case, manageable with consistent dependency versions across repos |
| GUI/web dashboard | CLI-first approach; `nx graph` provides visualization |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| ASSM-01 | Phase 1 | Complete |
| ASSM-02 | Phase 1 | Complete |
| ASSM-03 | Phase 1 | Complete |
| ASSM-04 | Phase 1 | Complete |
| GRPH-01 | Phase 2 | Complete |
| GRPH-02 | Phase 2 | Complete |
| GRPH-03 | Phase 2 | Complete |
| GRPH-04 | Phase 2 | Complete |
| GITX-01 | Phase 3 | Complete |
| GITX-02 | Phase 3 | Complete |
| GITX-03 | Phase 3 | Complete |

**Coverage:**
- v1 requirements: 11 total
- Mapped to phases: 11
- Unmapped: 0

---
*Requirements defined: 2026-03-10*
*Last updated: 2026-03-10 after roadmap creation*
