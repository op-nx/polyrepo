# Requirements: nx-openpolyrepo

**Defined:** 2026-03-17
**Core Value:** `nx graph` displays projects from all synced repos with cross-repo dependency edges, and all relevant Nx CLI commands output projects from multiple repos

## v1.1 Requirements

Requirements for cross-repo dependency detection. Each maps to roadmap phases.

### Auto-detection

- [x] **DETECT-01**: Plugin auto-detects cross-repo dependency edges from package.json `dependencies` fields
- [x] **DETECT-02**: Plugin auto-detects cross-repo dependency edges from package.json `devDependencies` fields
- [x] **DETECT-03**: Plugin auto-detects cross-repo dependency edges from package.json `peerDependencies` fields
- [x] **DETECT-04**: Plugin auto-detects cross-repo dependency edges from tsconfig path mappings (`tsconfig.base.json`/`tsconfig.json` `paths`)
- [x] **DETECT-05**: Plugin builds a name-to-namespaced-project lookup from package.json names and tsconfig paths, covering both host and external projects
- [x] **DETECT-06**: Cross-repo edges appear in `nx graph` visualization
- [x] **DETECT-07**: `nx affected` correctly traces changes across repo boundaries via cross-repo edges

### Overrides

- [x] **OVRD-01**: User can declare explicit cross-repo dependency edges in plugin config
- [x] **OVRD-02**: User can negate auto-detected edges via override config (suppress false positives)
- [x] **OVRD-03**: Plugin fails at load time when override references a project not present in the graph

### Nx Daemon Support

- [x] **DAEMON-01**: Global in-memory hash gate returns instantly when no repo has changed
- [x] **DAEMON-02**: Per-repo disk cache restores individual repo data on cold start without full re-extraction
- [x] **DAEMON-03**: Changed repo re-extracts while unchanged repos remain cached (selective invalidation)
- [x] **DAEMON-04**: After polyrepo-sync, per-repo disk cache is warm (first daemon invocation reads from disk)
- [x] **DAEMON-05**: Sync executor logs progress during extraction for user feedback
- [x] **DAEMON-06**: Exponential backoff skips re-extraction during cooldown period after failure
- [x] **DAEMON-07**: Hash change in a failing repo resets backoff immediately
- [x] **DAEMON-08**: Actionable troubleshooting warning logged on extraction failure
- [x] **DAEMON-09**: Old monolithic cache file deleted on first invocation
- [x] **DAEMON-10**: E2e tests pass under NX_DAEMON=true
- [x] **DAEMON-11**: E2e tests pass under NX_DAEMON=false

## Future Requirements

### Generators

- **GEN-01**: `init` generator for first-time setup
- **GEN-02**: `add-repo` generator for interactive repo addition

### Assembly

- **ASSM-01**: Selective assembly via profiles/groups

### Overrides (advanced)

- **OVRD-04**: Wildcard/glob patterns in dependency overrides
- **OVRD-05**: Dependency edge type control (implicit/static/dynamic)

## Out of Scope

| Feature | Reason |
|---------|--------|
| TypeScript import analysis across repos | Enormous complexity; package.json + tsconfig paths sufficient for dependency contracts |
| Lock file analysis | Lockfile formats vary; package name is sufficient for graph edges |
| Automatic version conflict detection | Belongs to conformance/consistency milestone (v2+) |
| Cross-repo `dependsOn` task chaining | v1.0 intentionally strips dependsOn from proxy targets; separate high-complexity feature |
| Runtime dependency inference | Too heuristic-heavy; manual overrides cover non-declarative relationships |
| Unresolved dependency warnings | Most package.json deps are public npm packages, not synced repos; would flood console |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| DETECT-01 | Phase 9 | Complete |
| DETECT-02 | Phase 9 | Complete |
| DETECT-03 | Phase 9 | Complete |
| DETECT-04 | Phase 9 | Complete |
| DETECT-05 | Phase 8 | Complete |
| DETECT-06 | Phase 10 | Complete |
| DETECT-07 | Phase 10 | Complete |
| OVRD-01 | Phase 9 | Complete |
| OVRD-02 | Phase 9 | Complete |
| OVRD-03 | Phase 9 | Complete |
| DAEMON-01 | Phase 11 | Complete |
| DAEMON-02 | Phase 11 | Complete |
| DAEMON-03 | Phase 11 | Complete |
| DAEMON-04 | Phase 11 | Complete |
| DAEMON-05 | Phase 11 | Complete |
| DAEMON-06 | Phase 11 | Complete |
| DAEMON-07 | Phase 11 | Complete |
| DAEMON-08 | Phase 11 | Complete |
| DAEMON-09 | Phase 11 | Complete |
| DAEMON-10 | Phase 11 | Complete |
| DAEMON-11 | Phase 11 | Complete |

**Coverage:**
- v1.1 requirements: 21 total
- Mapped to phases: 21
- Unmapped: 0
- Complete: 21/21

---
*Requirements defined: 2026-03-17*
*Last updated: 2026-03-21 after Phase 11 Plan 3 completion (v1.1 milestone complete)*
