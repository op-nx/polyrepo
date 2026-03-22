# Project Retrospective

_A living document updated after each milestone. Lessons feed forward into future planning._

## Milestone: v1.0 -- MVP

**Shipped:** 2026-03-16
**Phases:** 7 | **Plans:** 28 | **Commits:** 291

### What Was Built

- Nx plugin for synthetic monorepos: git clone/pull assembly, unified project graph, multi-repo git DX
- Two-layer graph cache (memory + disk) with namespaced project registration via createNodesV2/createDependencies
- Combined git status with aligned output, bulk sync with dry-run, conditional dep install
- Maximum type safety: zero `as`/`any`, strict-type-checked ESLint, Zod at all boundaries, SIFERS test pattern
- Container-based e2e via testcontainers with prebaked Docker image (23s warm)

### What Worked

- **Coarse 3-phase initial structure** mapped cleanly to requirement categories (ASSM, GRPH, GITX), making traceability trivial
- **Gap closure phases** (4, 7) kept tech debt from accumulating -- audit-driven rather than ad hoc
- **SIFERS test pattern** eliminated test coupling and made mock types explicit -- 282 tests with zero beforeEach
- **Zod schemas as single source of truth** -- derive TypeScript types from runtime validators, no drift
- **testcontainers approach** isolated e2e completely from host environment, reproducible across machines
- **Wave-based plan execution** kept phases fast (avg ~3.9 min/plan for Phase 3)

### What Was Inefficient

- **Phase 6 (e2e container)** took disproportionately long (104 min, 35 min/plan) due to Docker path issues on Windows and OverlayFS performance discovery
- **Phase 3 had 9 plans** -- many were small gap closures that could have been batched into fewer plans
- **exec() vs execFile() discovery** was reactive (broke on Windows) rather than proactive -- should have been caught in Phase 1 research
- **Multiple audit rounds** needed before Phase 7 could close all gaps -- earlier Nyquist validation would have caught gaps sooner

### Patterns Established

- `exec()` not `execFile()` for all child processes on Windows (.cmd shim compatibility)
- Corepack detection via `packageManager` field in package.json
- Stdout sanitization by slicing from first `{` for robust JSON extraction
- `resolvePluginConfig` shared utility for config reading across executors
- `createMockChildProcess` factory for EventEmitter-to-ChildProcess bridging in tests
- `assertDefined` utility for `noUncheckedIndexedAccess` index access

### Key Lessons

1. **Docker on Windows ARM64 needs special handling** -- testcontainers path separators must be forward-slashed, tmpfs eliminates OverlayFS copy-up overhead
2. **Gap closure phases are valuable** -- tech debt audit after core feature work catches integration gaps that individual phase verification misses
3. **Shell out to Nx itself for graph extraction** -- don't manually parse project.json; each repo is a full Nx workspace with its own plugin inference
4. **Zod `.loose()` for partial validation** -- validate the fields you care about, let unknown fields pass through
5. **ESLint flat config rule ordering matters** -- test overrides must come AFTER general TS rules

### Cost Observations

- Model mix: predominantly Opus for execution, Sonnet for agents
- Total execution: ~4.5 hours across 7 phases
- Notable: Phase 3 (9 plans) completed in ~35 min total -- small focused plans execute fastest

---

## Milestone: v1.1 -- Cross-repo Dependencies

**Shipped:** 2026-03-21
**Phases:** 6 | **Plans:** 13 | **Commits:** 151

### What Was Built

- Cross-repo dependency auto-detection from package.json (deps, devDeps, peerDeps) and tsconfig path aliases
- Override system with explicit dependency declaration, negation suppression (! prefix), and load-time validation
- Three-layer per-repo caching: global in-memory hash gate, per-repo disk cache, per-repo extraction with exponential backoff
- Sync pre-caching: graph data written to disk during polyrepo-sync, eliminating cold-start extraction
- targetDefaults isolation: dependsOn preservation in proxy targets + ensureTargetDefaultsShield auto-injection
- Full daemon mode support with e2e verification under NX_DAEMON=true, false, and unset

### What Worked

- **Data-flow-first phase decomposition** (schema -> detection -> integration) made each phase's inputs and outputs explicit
- **Pure function design** for `detectCrossRepoDependencies` -- fully unit-testable with zero Nx runtime dependency
- **Per-repo cache architecture** elegantly solved the daemon cold-start problem and selective invalidation simultaneously
- **Phase 13 gap closure** worked exactly as designed: audit found missing VERIFICATIONs + code debt, gap closure phase fixed everything
- **Human verification items in Phase 12** caught real behavioral differences between code inspection and live execution
- **Pre-caching in sync executor** eliminated the "first Nx command after sync is slow" user experience problem

### What Was Inefficient

- **Phase 10 needed 3 plans** (original, e2e, then gap closure for fileMap guard) -- the fileMap guard issue could have been caught earlier with integration testing in Plan 01
- **DependencyType.static initially chosen in Phase 9** then changed to implicit in Phase 10 Plan 03 -- research should have identified the sourceFile/fileMap requirement earlier
- **Missing VERIFICATION.md for Phases 10 and 11** during first audit -- verifier agent was rate-limited, required a dedicated Phase 13 to close
- **Nyquist validation incomplete** (only 1/6 phases compliant) -- retroactive validation is expensive; should be done during execution

### Patterns Established

- `rewriteDependsOn` for namespacing project references in proxy target config
- `ensureTargetDefaultsShield` auto-injected by createNodesV2 for executor-scoped targetDefaults isolation
- Per-repo cache with `shouldSkipExtraction` backoff guard: `min(2000 * 2^(n-1), 30000)ms` with hash-change reset
- `preCacheGraph` called at all syncRepo exit points -- not just successful install, but any repo state change
- E2e daemon forwarding via `container.withEnvironment({ NX_DAEMON })` + daemon stop after writeNxJson

### Key Lessons

1. **Integration testing should happen in Phase N, not Phase N+1** -- wiring a function into the plugin hook reveals issues (fileMap guard, DependencyType) that pure unit tests miss
2. **Per-repo caching is superior to monolithic** -- selective invalidation, failure isolation, and pre-caching all become natural with per-repo architecture
3. **targetDefaults merge is a trap** -- Nx resolves targetDefaults by executor key THEN by target name; empty `{}` shields are needed to block unwanted inheritance
4. **Human verification items are worth the cost** -- Phase 12's 3 live tests caught the Windows SQLite isolation requirement that static analysis couldn't verify
5. **Gap closure phases should include verification generation** -- don't rely on execution-time verifier availability; plan for it explicitly

### Cost Observations

- Model mix: Opus for execution, Sonnet for agents (integration checker, verifier)
- Total execution: ~62 min for plans (Phases 11-13 tracked), plus research/planning time
- Notable: Phase 12 Plan 02 took 18 min (longest) due to complex end-to-end verification with live synced repo

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Commits | Phases | Key Change                                                                                  |
| --------- | ------- | ------ | ------------------------------------------------------------------------------------------- |
| v1.0      | 291     | 7      | Initial milestone -- established GSD workflow, audit-driven gap closure                     |
| v1.1      | 151     | 6      | Cross-repo deps -- data-flow decomposition, per-repo caching, gap closure pattern confirmed |

### Cumulative Quality

| Milestone | Tests | LOC    | Type Safety                                                    |
| --------- | ----- | ------ | -------------------------------------------------------------- |
| v1.0      | 282   | 9,237  | Zero `as`/`any`, strict ESLint, Zod boundaries                 |
| v1.1      | 361   | 14,383 | Maintained zero `as`/`any`, added minimatch for glob overrides |

### Top Lessons (Verified Across Milestones)

1. Audit-driven gap closure catches what phase-level verification misses (confirmed v1.0, v1.1)
2. Small, focused plans (< 5 min) are more reliable than large multi-task plans (confirmed v1.0, v1.1)
3. Integration testing in the same phase as implementation catches wiring issues early (learned v1.1)
4. Human verification items are worth the cost for runtime-dependent behavior (learned v1.1)
