# Phase 7: v1.0 Tech Debt Cleanup - Research

**Researched:** 2026-03-16
**Domain:** Code cleanup, dead export removal, e2e test gap, documentation tracking
**Confidence:** HIGH

## Summary

Phase 7 closes all tech debt items identified in the v1.0-MILESTONE-AUDIT.md. The work falls into three distinct categories: (1) dead code removal from production source, (2) adding a sync-to-status e2e test that exercises the full pipeline, and (3) planning documentation housekeeping.

All changes are well-scoped with clear before/after states. The codebase is already in a clean state with comprehensive test coverage, so each change can be verified mechanically. The Docker container infrastructure from Phase 6 makes the e2e test addition straightforward -- the prebaked `/repos/nx` directory is already available inside the container.

**Primary recommendation:** Split into two plans -- one for code changes (dead exports + e2e test) and one for documentation fixes (REQUIREMENTS.md traceability + SUMMARY frontmatter). Code changes require build/test verification; documentation changes are text-only.

## Standard Stack

### Core

No new libraries needed. All changes use existing infrastructure.

| Library | Version | Purpose | Already Installed |
|---------|---------|---------|-------------------|
| vitest | (existing) | E2e test framework | Yes |
| testcontainers | (existing) | Docker container management for e2e | Yes |

### Supporting

No new supporting libraries required.

## Architecture Patterns

### Dead Export Removal Pattern

**What:** Remove exported functions that have no production consumers.
**Rule:** A function is "dead" if it is exported from a module but never imported by any non-test file in the production package.

**isGitUrl (git/detect.ts):**
- Defined at line 7 of `packages/op-nx-polyrepo/src/lib/git/detect.ts`
- Only consumers: `detect.spec.ts` (test file)
- Action: Remove `export` keyword (make function private) OR remove entirely if no test value
- Note: Test file `detect.spec.ts` has 8 test cases for `isGitUrl` (lines 111-141). If the function is removed entirely, those tests must also be removed. If keeping as internal utility, remove `export` and update spec to test it indirectly.
- **Recommendation:** Remove the function entirely. It is a simple regex test (`gitUrlPattern.test(value)`) that wraps `gitUrlPattern` from `./patterns`. No production code calls it. The test coverage for git URL patterns is already provided by the schema validation tests (Zod validates repo URLs).

**getCurrentGraphReport (graph/cache.ts):**
- Defined at line 163 of `packages/op-nx-polyrepo/src/lib/graph/cache.ts`
- Production index.ts does NOT import it (confirmed via grep)
- `createDependencies` in index.ts calls `populateGraphReport` directly (defensive re-populate pattern), NOT `getCurrentGraphReport`
- Consumers: `cache.spec.ts` (test file), `index.spec.ts` (mock)
- Action: Remove the export and function. Update cache.spec.ts to remove the `getCurrentGraphReport` describe block (lines 303-327). Update index.spec.ts to remove the mock (line 46, 55).
- **Recommendation:** Remove entirely. The function was originally designed for a pattern where createNodesV2 populates and createDependencies reads, but the production code evolved to call populateGraphReport in both hooks.

### networkName Removal Pattern

**What:** Remove unused ProvidedContext key from e2e setup.
**Files affected:**
1. `packages/op-nx-polyrepo-e2e/src/setup/provided-context.ts` (line 18) -- remove `networkName: string` from interface
2. `packages/op-nx-polyrepo-e2e/src/setup/global-setup.ts` (line 128) -- remove `project.provide('networkName', network.getName())`

The `network` variable remains needed in global-setup.ts because:
- Verdaccio container uses it (line 47: `.withNetwork(network)`)
- Workspace container uses it (line 102: `.withNetwork(network)`)
- Teardown stops it (line 145: `await network.stop()`)

Only the `provide('networkName', ...)` call and the type declaration are dead.

### E2e Sync-to-Status Test Pattern

**What:** Add an e2e test that exercises: sync repos -> graph cache created -> status shows project counts.
**Gap:** Current e2e only tests unsynced state (`polyrepo-status` with `[not synced]` output).

**Test flow:**
1. Container already has plugin installed and nx.json configured (from existing `beforeAll`)
2. Run `npx nx polyrepo-sync` inside container -- this clones `/repos/nx` (prebaked local path) and extracts graph
3. Run `npx nx polyrepo-status` inside container -- this should now show project counts from the cached graph
4. Assert stdout contains project count (e.g., matches pattern like `N projects`)

**Container context:**
- Docker image has `/repos/nx` prebaked (shallow clone of nrwl/nx at master)
- nx.json config uses `file:///repos/nx` URL scheme (already set up in existing test's `beforeAll`)
- `NX_DAEMON=false` is set in Dockerfile ENV (line 8)
- Test timeout: 60s per test, 120s per hook (from vitest.config.mts)

**Key consideration:** The sync operation will clone from `file:///repos/nx` to `/workspace/.repos/nx/` inside the container, then extract the graph. This involves running `nx graph --print` inside the child repo, which could be slow for the nrwl/nx repo (many projects). The existing 60s test timeout should be sufficient since the repo is already local (no network).

**Test structure recommendation:**
```typescript
describe('sync -> status flow', () => {
  it('should show project counts after sync', async () => {
    // Run sync
    const syncResult = await container.exec(
      ['npx', 'nx', 'polyrepo-sync'],
      { workingDir: '/workspace' },
    );
    expect(syncResult.exitCode).toBe(0);

    // Run status -- should now show project counts
    const statusResult = await container.exec(
      ['npx', 'nx', 'polyrepo-status'],
      { workingDir: '/workspace' },
    );
    expect(statusResult.stdout).toContain('projects');
    // Should no longer show [not synced]
    expect(statusResult.stdout).not.toContain('[not synced]');
  });
});
```

**Warning:** The nrwl/nx repo graph extraction could take 30+ seconds. The test timeout may need to be increased for the sync test, or the specific test should have a longer timeout via `it('...', async () => {...}, 120_000)`.

### Documentation Fix Pattern

**REQUIREMENTS.md traceability:**
Current state (confirmed by reading the file): All 9 SAFE-* requirement IDs ARE already present in the traceability table (lines 99-107). The "Last updated: 2026-03-16 after gap closure planning" line confirms this was fixed during gap closure planning. However, the coverage count says "20 total" which should be verified (11 original + 9 SAFE-* = 20, correct).

**SUMMARY frontmatter for SAFE-CASTS and SAFE-SIFER:**
Current state (confirmed by grep): These ARE present in 05-04-SUMMARY.md and 05-05-SUMMARY.md frontmatter. The audit marked them as "(missing)" in its cross-reference, but the grep shows `requirements-completed: [SAFE-CASTS, SAFE-SIFER]` in both files. This may have been a false positive in the audit, or the files were updated after the audit was generated. Either way, this success criterion may already be satisfied. The planner should verify and document the current state.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Container exec | Custom Docker CLI wrapper | testcontainers `container.exec()` | Already established in Phase 6 |
| JSON extraction from Nx stdout | Custom parser | RegExp#exec() pattern from Phase 6 | Handles Nx warning prefixes |

## Common Pitfalls

### Pitfall 1: Removing getCurrentGraphReport Breaks Test Mocks
**What goes wrong:** index.spec.ts mocks `getCurrentGraphReport` even though production code doesn't use it. Removing from cache.ts without updating the mock causes type errors.
**How to avoid:** Update index.spec.ts mock object to remove the `getCurrentGraphReport` entry. Also check for any `import type` references.

### Pitfall 2: Sync Test Timeout in Container
**What goes wrong:** `nx polyrepo-sync` inside container runs `nx graph --print` on the nrwl/nx repo, which has 100+ projects. Graph extraction can take 30-60 seconds.
**How to avoid:** Set explicit timeout on the sync test (120s). Monitor for daemon timeout issues (NX_DAEMON=false is already set).

### Pitfall 3: networkName Removal Breaking Type Inference
**What goes wrong:** Removing `networkName` from ProvidedContext interface could cause type errors if any test file calls `inject('networkName')`.
**How to avoid:** Grep for all `inject('networkName')` usage before removing. Current grep shows zero consumers in test files.

### Pitfall 4: isGitUrl Removal Orphaning gitUrlPattern
**What goes wrong:** `isGitUrl` imports `gitUrlPattern` from `./patterns`. If no other consumer uses `gitUrlPattern`, it becomes dead code too.
**How to avoid:** Check if `gitUrlPattern` is used elsewhere before deciding whether to also clean it up.

### Pitfall 5: Documentation Already Fixed
**What goes wrong:** Spending time fixing REQUIREMENTS.md and SUMMARY frontmatter that was already corrected during gap closure planning.
**How to avoid:** Verify current state first. The planner should include verification steps before modification steps.

## Code Examples

### Removing an export (detect.ts)
```typescript
// BEFORE: exported but unused in production
export function isGitUrl(value: string): boolean {
  return gitUrlPattern.test(value);
}

// AFTER: function removed entirely (or export keyword removed if keeping for tests)
// Remove the function and its tests in detect.spec.ts
```

### Container exec for sync test
```typescript
// Source: existing pattern from op-nx-polyrepo.spec.ts
const { exitCode, stdout } = await container.exec(
  ['npx', 'nx', 'polyrepo-sync'],
  { workingDir: '/workspace' },
);
```

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (existing) |
| Config file | `packages/op-nx-polyrepo/vitest.config.mts` (unit), `packages/op-nx-polyrepo-e2e/vitest.config.mts` (e2e) |
| Quick run command | `npm exec nx test @op-nx/polyrepo --output-style=static` |
| Full suite command | `npm exec nx run-many -t test,e2e --output-style=static` |

### Phase Requirements -> Test Map

No formal requirements (tech debt phase). Verification is by success criteria:

| Criterion | Behavior | Test Type | Automated Command | File Exists? |
|-----------|----------|-----------|-------------------|-------------|
| SC-1 | No dead exports (isGitUrl, getCurrentGraphReport) | lint/build | `npm exec nx build @op-nx/polyrepo --output-style=static` | N/A (removal) |
| SC-2 | networkName removed | typecheck | `npm exec nx typecheck @op-nx/polyrepo --output-style=static` | N/A (removal) |
| SC-3 | Sync->status e2e test | e2e | `npm exec nx e2e op-nx-polyrepo-e2e --output-style=static` | Extends existing spec |
| SC-4 | REQUIREMENTS.md traceability | manual | Visual inspection | N/A (docs) |
| SC-5 | SUMMARY frontmatter | manual | Visual inspection | N/A (docs) |

### Sampling Rate
- **Per task commit:** `npm exec nx test @op-nx/polyrepo --output-style=static`
- **Per wave merge:** `npm exec nx run-many -t test,lint,typecheck --output-style=static`
- **Phase gate:** Full suite including e2e

### Wave 0 Gaps
None -- existing test infrastructure covers all phase work. No new test files needed (sync->status test extends existing e2e spec).

## State of the Art

No technology changes relevant to this phase. All work uses existing patterns.

## Open Questions

1. **isGitUrl removal scope**
   - What we know: `isGitUrl` is dead in production. `gitUrlPattern` may have other consumers.
   - What's unclear: Whether to remove just the function or also `gitUrlPattern` if orphaned.
   - Recommendation: Check `gitUrlPattern` usage; remove both if orphaned.

2. **Sync test timing**
   - What we know: nrwl/nx graph extraction can be slow (30-60s for 100+ projects).
   - What's unclear: Exact timing inside container with NX_DAEMON=false.
   - Recommendation: Use 120s timeout on sync test, measure actual time.

3. **Documentation criteria already met?**
   - What we know: REQUIREMENTS.md already has all 9 SAFE-* entries. SUMMARY files already have SAFE-CASTS/SAFE-SIFER.
   - What's unclear: Whether the success criteria were written before these fixes, making them already satisfied.
   - Recommendation: Verify current state and document as "already satisfied" if true, or identify remaining gaps.

## Sources

### Primary (HIGH confidence)
- Direct file reads of all affected source files (detect.ts, cache.ts, global-setup.ts, provided-context.ts, index.ts, op-nx-polyrepo.spec.ts)
- `git grep` searches confirming usage patterns across entire codebase
- v1.0-MILESTONE-AUDIT.md tech debt inventory
- REQUIREMENTS.md current state (all 9 SAFE-* entries present)

### Secondary (MEDIUM confidence)
- Phase 5 SUMMARY frontmatter grep results (SAFE-CASTS/SAFE-SIFER present in 05-04 and 05-05)

## Metadata

**Confidence breakdown:**
- Dead export removal: HIGH - exact files, lines, and consumers identified
- networkName removal: HIGH - exact files and zero-consumer status confirmed
- E2e sync->status test: HIGH - container infrastructure exists, pattern established
- Documentation fixes: MEDIUM - may already be resolved, needs verification
- Sync test timing: MEDIUM - depends on container performance with large repo

**Research date:** 2026-03-16
**Valid until:** 2026-04-16 (stable codebase, no external dependency changes expected)
