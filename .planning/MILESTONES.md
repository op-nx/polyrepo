# Milestones

## v1.1 Cross-repo Dependencies (Shipped: 2026-03-21)

**Phases completed:** 6 phases, 13 plans
**Timeline:** 5 days (2026-03-17 to 2026-03-21)
**Commits:** 151 | **LOC:** 13,760 TypeScript (plugin) + 623 TypeScript (e2e)

**Key accomplishments:**

- Cross-repo dependency auto-detection from package.json (dependencies, devDependencies, peerDependencies) and tsconfig path aliases
- Override system with explicit dependency declaration, negation suppression, and load-time validation of unknown project references
- Three-layer per-repo caching with global hash gate, per-repo disk cache, selective invalidation, and exponential backoff with hash-change reset
- Sync pre-caching eliminates cold-start graph extraction on first Nx command after polyrepo-sync
- targetDefaults isolation prevents host build config from leaking into external project proxy targets via dependsOn preservation and ensureTargetDefaultsShield
- Full daemon mode support with e2e verification under NX_DAEMON=true, false, and unset

---

## v1.0 MVP (Shipped: 2026-03-16)

**Phases completed:** 7 phases, 28 plans
**Timeline:** 7 days (2026-03-10 to 2026-03-16)
**Commits:** 291 | **LOC:** 9,237 TypeScript

**Key accomplishments:**

- Plugin foundation with Zod-validated config, git clone/pull assembly, polyrepo-sync and polyrepo-status executors
- Unified project graph -- external repo projects in nx graph/nx show projects with namespaced prefixes and cached extraction
- Multi-repo git DX -- combined status with aligned output, bulk sync with dry-run, per-repo warnings, conditional dep install
- Maximum type safety -- zero `as`/`any`, strict-type-checked ESLint, Zod at boundaries, SIFERS test pattern, 282 passing tests
- Container-based e2e tests via testcontainers (23s warm, down from ~3min host-based)
- Full tech debt resolution -- dead exports removed, documentation traceability complete, Nyquist compliant

---
