# Project Retrospective

*A living document updated after each milestone. Lessons feed forward into future planning.*

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

## Cross-Milestone Trends

### Process Evolution

| Milestone | Commits | Phases | Key Change |
|-----------|---------|--------|------------|
| v1.0 | 291 | 7 | Initial milestone -- established GSD workflow, audit-driven gap closure |

### Cumulative Quality

| Milestone | Tests | LOC | Type Safety |
|-----------|-------|-----|-------------|
| v1.0 | 282 | 9,237 | Zero `as`/`any`, strict ESLint, Zod boundaries |

### Top Lessons (Verified Across Milestones)

1. Audit-driven gap closure catches what phase-level verification misses
2. Small, focused plans (< 5 min) are more reliable than large multi-task plans
