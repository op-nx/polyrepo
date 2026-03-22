# Requirements: @op-nx/polyrepo v1.2

**Defined:** 2026-03-22
**Core Value:** `nx graph` displays projects from all synced repos with cross-repo dependency edges, and all relevant Nx CLI commands output projects from multiple repos

## v1.2 Requirements

Requirements for v1.2: Static edges and proxy caching.

### Executor

- [ ] **EXEC-01**: Child repo temp directories use `tmp/` instead of `.tmp/` to align with Nx default `.gitignore` convention
- [ ] **EXEC-02**: Graph extraction temp directory uses `tmp/` instead of `.tmp/`

### Detection

- [ ] **DETECT-01**: Host-sourced auto-detected edges use `DependencyType.static` with `sourceFile` pointing to the host project file that declares the dependency (package.json or tsconfig)
- [ ] **DETECT-02**: External-sourced auto-detected edges remain `DependencyType.implicit` (Nx fileMap validation constraint: `.repos/` files are gitignored and absent from fileMap)
- [ ] **DETECT-03**: Override edges remain `DependencyType.implicit` (manually configured, no sourceFile)
- [ ] **DETECT-04**: `sourceFile` is the relative path to the specific file that declares the dependency (e.g., `packages/my-app/package.json` or `packages/my-app/tsconfig.json`)
- [ ] **DETECT-05**: Existing unit tests updated to verify edge types and sourceFile values per source location

### Proxy

- [ ] **PROXY-01**: Proxy targets set `cache: true` to enable host-level Nx caching
- [ ] **PROXY-02**: Proxy targets include compound runtime input: `git rev-parse HEAD` + `git diff HEAD` per repo alias, capturing both sync changes and uncommitted edits
- [ ] **PROXY-03**: Runtime input commands include a fallback guard so failed git commands (repo not synced, corrupt git) do not produce a constant hash that permanently returns stale cached results
- [ ] **PROXY-04**: `polyrepo-sync` executor runs `nx reset` after sync completes to flush the daemon's stale runtime input cache (workaround for nrwl/nx#30170)
- [ ] **PROXY-05**: Proxy caching works correctly with `NX_DAEMON=true`, `NX_DAEMON=false`, and `NX_DAEMON` unset

## Future Requirements

Deferred to future releases. Tracked but not in current roadmap.

### Detection

- **DETECT-F1**: All auto-detected edges use `DependencyType.static` (requires Nx upstream change to support fileMap for gitignored paths)

### Proxy

- **PROXY-F1**: Per-target runtime inputs for finer cache granularity
- **PROXY-F2**: Output caching for proxy targets (restore child repo build artifacts from host cache)

## Out of Scope

| Feature | Reason |
|---------|--------|
| Make ALL edges static (including external-sourced) | Nx validates sourceFile against fileMap; `.repos/` is gitignored = not in fileMap. Would require Nx core changes. |
| File-hash inputs instead of git-based runtime inputs | `.repos/` files excluded from Nx input hashing (gitignored). Git commands are the correct abstraction. |
| Outputs declaration for proxy targets | Child Nx manages its own build artifact cache. Host cache stores terminal output + success flag only. |
| Per-target runtime inputs | Child Nx already handles target-level caching. Compound git input at repo level is sufficient. |
| Clear host cache on sync | Compound runtime input (HEAD + diff) handles invalidation organically. `nx reset` handles daemon bug. |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| EXEC-01 | TBD | Pending |
| EXEC-02 | TBD | Pending |
| DETECT-01 | TBD | Pending |
| DETECT-02 | TBD | Pending |
| DETECT-03 | TBD | Pending |
| DETECT-04 | TBD | Pending |
| DETECT-05 | TBD | Pending |
| PROXY-01 | TBD | Pending |
| PROXY-02 | TBD | Pending |
| PROXY-03 | TBD | Pending |
| PROXY-04 | TBD | Pending |
| PROXY-05 | TBD | Pending |

**Coverage:**
- v1.2 requirements: 12 total
- Mapped to phases: 0
- Unmapped: 12 (pending roadmap creation)

---
*Requirements defined: 2026-03-22*
*Last updated: 2026-03-22 after initial definition*
