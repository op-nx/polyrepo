# Requirements: nx-openpolyrepo

**Defined:** 2026-03-10
**Core Value:** `nx graph` displays projects from all assembled repos with cross-repo dependency edges, and all relevant Nx CLI commands output projects from multiple repos

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Repo Assembly

- [ ] **ASSM-01**: User can configure repos (URL + optional local path alias) in nx.json plugin options
- [ ] **ASSM-02**: Plugin clones configured repos into `.repos/` directory on first run
- [ ] **ASSM-03**: Plugin pulls latest changes for already-cloned repos when assembly is triggered
- [ ] **ASSM-04**: Config is validated at plugin load time with clear error messages for invalid entries

### Project Graph

- [ ] **GRPH-01**: Projects from assembled repos appear in `nx graph` visualization
- [ ] **GRPH-02**: Projects from assembled repos appear in `nx show projects` output
- [ ] **GRPH-03**: External repo projects are namespaced with repo prefix (e.g., `repo-b/my-lib`) to prevent collisions
- [ ] **GRPH-04**: Graph extraction uses cached JSON files (pre-computed during assembly, not on every nx command)

### Multi-Repo Git DX

- [ ] **GITX-01**: User can see combined git status of all assembled repos in one command
- [ ] **GITX-02**: User can pull/fetch all assembled repos with one command
- [ ] **GITX-03**: Git operations show clear per-repo output (which repo succeeded/failed)

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
| ASSM-01 | — | Pending |
| ASSM-02 | — | Pending |
| ASSM-03 | — | Pending |
| ASSM-04 | — | Pending |
| GRPH-01 | — | Pending |
| GRPH-02 | — | Pending |
| GRPH-03 | — | Pending |
| GRPH-04 | — | Pending |
| GITX-01 | — | Pending |
| GITX-02 | — | Pending |
| GITX-03 | — | Pending |

**Coverage:**
- v1 requirements: 11 total
- Mapped to phases: 0
- Unmapped: 11

---
*Requirements defined: 2026-03-10*
*Last updated: 2026-03-10 after initial definition*
