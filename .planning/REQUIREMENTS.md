# Requirements: nx-openpolyrepo

**Defined:** 2026-03-17
**Core Value:** `nx graph` displays projects from all synced repos with cross-repo dependency edges, and all relevant Nx CLI commands output projects from multiple repos

## v1.1 Requirements

Requirements for cross-repo dependency detection. Each maps to roadmap phases.

### Auto-detection

- [ ] **DETECT-01**: Plugin auto-detects cross-repo dependency edges from package.json `dependencies` fields
- [ ] **DETECT-02**: Plugin auto-detects cross-repo dependency edges from package.json `devDependencies` fields
- [ ] **DETECT-03**: Plugin auto-detects cross-repo dependency edges from package.json `peerDependencies` fields
- [ ] **DETECT-04**: Plugin auto-detects cross-repo dependency edges from tsconfig path mappings (`tsconfig.base.json`/`tsconfig.json` `paths`)
- [ ] **DETECT-05**: Plugin builds a name-to-namespaced-project lookup from package.json names and tsconfig paths, covering both host and external projects
- [ ] **DETECT-06**: Cross-repo edges appear in `nx graph` visualization
- [ ] **DETECT-07**: `nx affected` correctly traces changes across repo boundaries via cross-repo edges

### Overrides

- [ ] **OVRD-01**: User can declare explicit cross-repo dependency edges in plugin config
- [ ] **OVRD-02**: User can negate auto-detected edges via override config (suppress false positives)
- [ ] **OVRD-03**: Plugin fails at load time when override references a project not present in the graph

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
| DETECT-01 | — | Pending |
| DETECT-02 | — | Pending |
| DETECT-03 | — | Pending |
| DETECT-04 | — | Pending |
| DETECT-05 | — | Pending |
| DETECT-06 | — | Pending |
| DETECT-07 | — | Pending |
| OVRD-01 | — | Pending |
| OVRD-02 | — | Pending |
| OVRD-03 | — | Pending |

**Coverage:**
- v1.1 requirements: 10 total
- Mapped to phases: 0
- Unmapped: 10

---
*Requirements defined: 2026-03-17*
*Last updated: 2026-03-17 after initial definition*
