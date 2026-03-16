# Research: Large Monorepos as Test Fixtures in Docker-Based E2E Tests

**Context:** `@op-nx/polyrepo` Nx plugin e2e tests use nrwl/nx (600+ projects, 4600+ packages) as a test fixture inside Docker containers via testcontainers. The sync executor clones it, runs `pnpm install`, then `nx graph --print` to extract the project graph. This pipeline exceeds 120s in a container.
**Researched:** 2026-03-16
**Overall confidence:** HIGH (verified from source code + official docs)

## Executive Summary

The e2e sync test timeout has **three distinct bottlenecks**: (1) preinstall script requiring Rust, (2) 4600+ package install, (3) graph extraction on 600+ projects. The preinstall issue is already solved by `CI=true` (see `pnpm-preinstall-bypass.md`), but even with that fix, the install + graph extraction pipeline is fundamentally too slow for a 120s test timeout in a resource-constrained Docker container.

**The recommended fix is to replace nrwl/nx with a synthetic minimal fixture (2-5 projects) prebaked into the Docker image, with node_modules pre-installed.** This eliminates all three bottlenecks: no preinstall issue, instant "install" (already done), and sub-second graph extraction. The nrwl/nx monorepo adds zero test coverage value that a synthetic fixture cannot provide -- the test verifies that the plugin can clone, extract a graph, and report status, not that it can handle 600+ projects.

---

## Problem Analysis

### Three Sequential Bottlenecks

| # | Operation | Time (estimated) | Where | Root Cause |
|---|-----------|-----------------|-------|------------|
| 1 | `corepack pnpm install` preinstall check | Instant fail (no Rust) | `syncRepo()` -> `tryInstallDeps()` | nrwl/nx `scripts/preinstall.js` requires `rustc`, exits non-zero |
| 2 | `corepack pnpm install` dependency resolution | 60-120s+ | `syncRepo()` -> `tryInstallDeps()` | 4600+ packages, even with pnpm store warm |
| 3 | `nx graph --print` | 60-120s+ | `createNodesV2` -> `populateGraphReport()` -> `extractGraphFromRepo()` | Computes full project graph for 600+ projects |

**Total wall time:** Exceeds 120s test timeout. Even if bottleneck #1 is fixed (via `CI=true`), bottlenecks #2 and #3 together likely exceed 120s in a Docker container, especially on Windows/QEMU or resource-constrained CI.

### What the Test Actually Verifies

The "should show project counts after sync" test verifies:

1. `polyrepo-sync` executor can clone a repo (from `file:///repos/nx`)
2. `polyrepo-sync` runs dependency installation
3. After sync, `polyrepo-status` shows project counts from cached graph
4. The `[not synced]` label disappears after sync

**None of these assertions require 600+ projects.** A 2-project synthetic workspace provides identical coverage.

---

## Research Area 1: How Nx Plugin Authors Test with Real Repos

### How Nx Tests Its Own Plugins (HIGH confidence)

Nx's internal e2e tests use `newProject()` from `@nx/e2e/utils`. This creates a **fresh temporary workspace** via `create-nx-workspace`, installs required packages, then runs generators/executors against it. Key pattern:

```typescript
beforeAll(() => newProject({ name: uniq('proj'), packages: ['@nx/react'] }));
afterAll(() => cleanupProject());
```

They **never test against a copy of their own monorepo**. Each test gets a minimal synthetic workspace with only the packages needed for that test.

**Source:** [Nx e2e/utils/index.ts](https://github.com/nrwl/nx/blob/master/e2e/utils/index.ts), [Nx e2e tests](https://github.com/nrwl/nx/tree/master/e2e)

### Public Plugin E2E Utils

The `@nx/plugin:e2e` executor and `ensureNxProject()` from `@nrwl/nx-plugin/testing` create a temporary workspace in `tmp/nx-e2e/` with the plugin installed. Again, synthetic workspace, not a real external repo.

**Source:** [Better @nrwl/nx-plugin testing utils (Issue #10992)](https://github.com/nrwl/nx/issues/10992)

### Key Insight

**No one tests Nx plugins against the nrwl/nx monorepo itself.** The pattern is always: create a minimal workspace, install the plugin, run assertions. The nrwl/nx monorepo is valuable only as a scale test, not a correctness test.

---

## Research Area 2: Prebaking Fully-Installed Repos in Docker

### Can git clone carry node_modules? (HIGH confidence)

**No.** `node_modules/` is universally `.gitignore`d. A `git clone` from a local path (`file:///repos/nx`) does not copy untracked files. Options for carrying installed state:

| Method | Works? | Tradeoffs |
|--------|--------|-----------|
| `git clone` from prebaked local repo | No | `.gitignore` excludes `node_modules` |
| `git clone` + warm pnpm store | Partial | Avoids network downloads but still runs install/linking (slow for 4600 packages) |
| Commit `node_modules` to git | Technically yes | Terrible idea: bloats git, breaks native binaries across platforms |
| Copy directory (not clone) | Yes | Skips git entirely; must fake or preserve `.git/` |
| Docker volume mount | Yes | Pre-populated volume with installed state; `docker cp` or build-time volume |
| Bind mount from host prebake layer | Possible | Not portable, breaks on Testcontainers Cloud |

### Copy Instead of Clone (MEDIUM confidence)

The sync executor currently calls `gitClone()`. To use a pre-installed copy instead:

**Option A: Prebake in Docker, copy at test time**
```dockerfile
# In Dockerfile: prebake fully installed repo
RUN git clone --depth 1 ... /repos/nx \
    && cd /repos/nx && CI=true corepack pnpm install --frozen-lockfile
```
At test time, instead of cloning, `cp -a /repos/nx /workspace/.repos/nx/`. This carries `node_modules` and `.git/`.

**Problem:** The sync executor is hardcoded to `gitClone()`. Changing it to `cp` for testing would require either:
- A test-only code path (bad: testing different code than production)
- Modifying the executor to accept local paths with `file://` scheme and detect pre-installed state
- Pre-populating `/workspace/.repos/nx/` before sync runs (faking the "already synced" state)

**Option B: Pre-populate synced state in snapshot**
In globalSetup, before committing the snapshot:
1. Copy the prebaked repo with node_modules into `/workspace/.repos/nx/`
2. Write the lockfile hash file (`.repos/.nx.lock-hash`) so `needsInstall()` returns false
3. Write the graph cache file (`.repos/.polyrepo-graph-cache.json`) so `populateGraphReport()` hits disk cache

This skips the sync test entirely. Not ideal if you want to test the sync flow.

### Warm pnpm Store (Already Implemented, Insufficient)

The current Dockerfile runs `pnpm install` at build time to warm the pnpm content-addressable store. However, a warm store only avoids network downloads -- pnpm still needs to resolve, link, and run lifecycle scripts for 4600+ packages, which takes 60s+ even from warm cache.

---

## Research Area 3: Lighter nrwl/nx Alternatives

### Using a Specific nrwl/nx Tag/Branch (LOW confidence improvement)

There is no "lite" branch or tag of nrwl/nx. All releases have 600+ projects. Older tags have fewer projects but still hundreds. Using `--depth 1` (already done) minimizes git data but has no effect on project count or install size.

### Sparse Checkout (MEDIUM confidence)

Git sparse checkout can limit which directories are checked out:

```bash
git clone --depth 1 --filter=blob:none --sparse https://github.com/nrwl/nx.git
cd nx && git sparse-checkout set packages/nx packages/devkit package.json pnpm-lock.yaml
```

**Problem:** The pnpm lockfile references all workspace packages. A sparse checkout with partial packages would fail `pnpm install --frozen-lockfile` because the lockfile expects all packages to exist. You would need `--no-frozen-lockfile` which defeats the purpose and adds resolution time.

### Subset via pnpm `--filter` (LOW confidence)

`pnpm install --filter @nx/nx` installs only the `nx` package and its workspace dependencies. But with `--frozen-lockfile` (required for reproducibility), pnpm still validates the entire lockfile. The actual install is faster but not fast enough for hundreds of transitive dependencies.

---

## Research Area 4: Synthetic Fixture (RECOMMENDED)

### What a Minimal Fixture Needs

To test the full sync + graph extraction pipeline, the fixture needs:

1. A valid git repository (for `git clone`)
2. A `package.json` with a package manager field (for `corepack pnpm install`)
3. A `pnpm-lock.yaml` (for install)
4. A `nx.json` (for `nx graph --print`)
5. At least 2 `project.json` files (to verify graph extraction with dependencies)
6. An `nx` package in `node_modules` (for `nx graph --print` binary)

### Fixture Structure

```
synthetic-nx-workspace/
  .git/
  package.json          # { "name": "synthetic", "packageManager": "pnpm@10.x" }
  pnpm-lock.yaml        # Minimal lockfile for nx + @nx/js
  pnpm-workspace.yaml   # packages: ["packages/*"]
  nx.json               # { "plugins": [] }
  packages/
    lib-a/
      project.json      # { "name": "lib-a", "targets": { "build": { ... } } }
      src/index.ts
    lib-b/
      project.json      # { "name": "lib-b", "targets": { "build": { ... } }, "implicitDependencies": ["lib-a"] }
      src/index.ts
```

### Prebaking in Docker

```dockerfile
FROM node:22-slim

RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && \
    rm -rf /var/lib/apt/lists/*

ENV NX_DAEMON=false
ENV CI=true

# Create synthetic fixture workspace
COPY synthetic-fixture/ /repos/synthetic-nx/
RUN cd /repos/synthetic-nx && \
    corepack enable && \
    corepack pnpm install --frozen-lockfile && \
    git init && git add -A && git commit -m "initial"

# Prebake host workspace (unchanged)
ARG NX_VERSION=22.5.4
RUN npx --yes create-nx-workspace@${NX_VERSION} workspace \
    --preset=apps --interactive=false --nxCloud=skip

WORKDIR /workspace
CMD ["sleep", "infinity"]
```

### Advantages Over nrwl/nx

| Aspect | nrwl/nx | Synthetic Fixture |
|--------|---------|-------------------|
| Install time | 60-120s+ (4600 packages) | 5-15s (nx + @nx/js + few deps) |
| Graph extraction | 60-120s+ (600+ projects) | <2s (2-5 projects) |
| Preinstall script | Requires Rust or CI=true bypass | No custom preinstall |
| Determinism | Master branch changes | Fully controlled, versioned |
| Docker image size | ~2-3 GB (with node_modules) | ~200-400 MB |
| Maintenance | Must track upstream changes | Zero upstream dependency |

### Creating the Fixture

**Option A: Manual creation** -- Hand-write the minimal package.json, nx.json, project.json files. Run `pnpm install` locally to generate the lockfile. Commit everything to a `docker/fixtures/synthetic-nx/` directory in the repo.

**Option B: Generate via create-nx-workspace** -- Run `create-nx-workspace` then `nx g @nx/js:lib lib-a` and `nx g @nx/js:lib lib-b` to get a valid workspace. Strip unnecessary files. This ensures the fixture is compatible with the Nx version being tested.

**Recommendation: Option B.** Generate the fixture in the Dockerfile itself:

```dockerfile
# Generate synthetic fixture with 2 libs
RUN npx --yes create-nx-workspace@${NX_VERSION} synthetic-nx \
    --preset=apps --interactive=false --nxCloud=skip && \
    cd synthetic-nx && \
    npx nx g @nx/js:lib lib-a --no-interactive && \
    npx nx g @nx/js:lib lib-b --no-interactive && \
    mv synthetic-nx /repos/synthetic-nx
```

This approach:
- Guarantees compatibility with the Nx version under test
- Generates valid lockfile, nx.json, project.json automatically
- Is fully reproducible
- Only needs to run when NX_VERSION changes (Docker layer cache)

---

## Research Area 5: Testcontainers Patterns for Expensive Setup

### Pattern: Commit-Based Snapshots (Already Used)

The project already uses `container.commit()` to snapshot the installed state. This is the correct pattern -- install plugin once, snapshot, start fresh containers per test file.

### Pattern: Pre-Populated Docker Volumes (MEDIUM confidence)

For cases where the expensive operation is the *fixture* rather than the *plugin install*, you can use Docker named volumes:

```typescript
// Create a volume with pre-installed fixture
const volume = await new Volume().start();
const prepContainer = await new GenericContainer('op-nx-e2e-workspace')
  .withBindMounts([{ source: volume.getName(), target: '/repos/fixture' }])
  .withCommand(['sh', '-c', 'cp -a /repos/synthetic-nx /repos/fixture/nx && sleep infinity'])
  .start();
// ... volume persists across test runs
```

**Caveat:** Testcontainers auto-cleans volumes via Ryuk. To persist across runs, you'd need `TESTCONTAINERS_RYUK_DISABLED=true` or manual volume management.

**Verdict:** Not needed if using a synthetic fixture -- the install is fast enough to run every time.

### Pattern: Image Layer Cache (Already Used)

Docker layer caching is already correctly used: fixture creation and dependency installation happen in Dockerfile `RUN` steps, cached by Docker layer system. Rebuild only when `ARG NX_VERSION` or fixture definition changes.

### Pattern: Reuse Containers Across Tests (Anti-Pattern)

Sharing a container across test files breaks isolation. The snapshot pattern (already implemented) is correct -- each test file gets a fresh container. With a fast fixture, container startup (~2-4s) dominates rather than fixture setup.

---

## Recommended Solution

### Immediate Fix (Unblocks Sync Test)

1. **Add `ENV CI=true` to Dockerfile** -- Fixes preinstall Rust check (already researched in `pnpm-preinstall-bypass.md`)
2. **Replace nrwl/nx fixture with synthetic 2-lib workspace** -- Eliminates the 60-120s install and 60-120s graph extraction bottlenecks
3. **Prebake synthetic fixture in Docker image** -- Generate via `create-nx-workspace` + `nx g @nx/js:lib` in Dockerfile, fully installed with node_modules

### What Changes in the Sync Test

```typescript
// Before: uses nrwl/nx monorepo (600+ projects)
const nxJsonContent = JSON.stringify({
  plugins: [{
    plugin: '@op-nx/polyrepo',
    options: {
      repos: {
        nx: { url: 'file:///repos/nx', depth: 1, ref: 'master' },
      },
    },
  }],
}, null, 2);

// After: uses synthetic fixture (2-5 projects)
const nxJsonContent = JSON.stringify({
  plugins: [{
    plugin: '@op-nx/polyrepo',
    options: {
      repos: {
        fixture: { url: 'file:///repos/synthetic-nx', depth: 1, ref: 'main' },
      },
    },
  }],
}, null, 2);
```

### Expected Timing After Fix

| Operation | Before | After |
|-----------|--------|-------|
| git clone (local file://) | ~2s | ~1s (smaller repo) |
| pnpm install | 60-120s+ (fails or slow) | 5-15s (few packages) |
| nx graph --print | 60-120s+ | <2s |
| **Total sync test** | **>120s (timeout)** | **~10-20s** |

### Optional: Keep nrwl/nx as Scale Test

If scale testing against a real large monorepo is valuable, add it as a **separate, optional** test with a longer timeout (300s+) and `skip` by default. Run it manually or in a dedicated CI job:

```typescript
it.skipIf(process.env['SKIP_SCALE_TEST'])('should sync large monorepo', async () => {
  // nrwl/nx scale test with 300s timeout
}, 300_000);
```

---

## Pitfalls to Avoid

### Pitfall 1: Synthetic Fixture Drift
**What:** The synthetic fixture's Nx version falls behind the plugin's target Nx version.
**Prevention:** Generate the fixture using the same `NX_VERSION` ARG as the host workspace prebake. Both layers share the same ARG.

### Pitfall 2: Lockfile Mismatch on Docker Rebuild
**What:** Regenerating the fixture produces a different lockfile, invalidating the install layer cache.
**Prevention:** Accept that the fixture generation layer rebuilds when NX_VERSION changes. It only takes 15-30s for a 2-lib workspace.

### Pitfall 3: Git Identity in Docker
**What:** `git init && git commit` fails without git identity.
**Prevention:** Already handled in current Dockerfile: `git config --global user.email "e2e@test.local"`.

### Pitfall 4: Fixture Must Be a Git Repo
**What:** The sync executor's `gitClone()` requires a valid git repo as source.
**Prevention:** The fixture must have `git init && git add -A && git commit` as part of the Docker build.

### Pitfall 5: Corepack Version Pinning
**What:** The synthetic fixture's `package.json` `packageManager` field pins a specific pnpm version. If the Docker image's Node.js ships a different corepack version that cannot download that pnpm version, install fails.
**Prevention:** Use `corepack enable` in the Dockerfile. corepack handles downloading the pinned pnpm version.

---

## Alternative: Prebake Graph Cache (Bypass Both Install and Extract)

If replacing the fixture is not desired, an alternative is to prebake the graph cache during Docker build:

```dockerfile
# Prebake nrwl/nx with full install + graph cache
RUN cd /repos/nx && \
    CI=true corepack pnpm install --frozen-lockfile && \
    ./node_modules/.bin/nx graph --print > /tmp/nx-graph.json
```

Then at test time, instead of running install + graph extraction:
1. Copy the prebaked repo to `/workspace/.repos/nx/`
2. Copy the prebaked graph cache to `/workspace/.repos/.polyrepo-graph-cache.json`
3. Write the lockfile hash so `needsInstall()` returns false

**Downside:** This pre-populates state that the sync executor is supposed to create, meaning you're testing a different code path than production. The sync test becomes a "verify cached state" test rather than an "end-to-end sync" test.

**Verdict:** Inferior to the synthetic fixture approach. Use only if the test must specifically use nrwl/nx.

---

## Sources

### Primary (HIGH confidence)
- [nrwl/nx scripts/preinstall.js](https://github.com/nrwl/nx/blob/master/scripts/preinstall.js) -- Verified: `CI=true` bypasses Rust check
- [nrwl/nx e2e/utils](https://github.com/nrwl/nx/blob/master/e2e/utils/index.ts) -- How Nx tests its own plugins (newProject pattern)
- [nrwl/nx package.json](https://github.com/nrwl/nx/blob/master/package.json) -- Preinstall script reference, packageManager field
- [pnpm Settings](https://pnpm.io/settings) -- `ignoreScripts`, `onlyBuiltDependencies` documentation
- [testcontainers Node.js Containers](https://node.testcontainers.org/features/containers/) -- exec(), commit(), copy APIs
- [Docker Build Cache](https://docs.docker.com/build/cache/optimize/) -- Layer caching optimization

### Secondary (MEDIUM confidence)
- [Faithful E2E Testing of Nx Preset Generators](https://blog.chiubaka.com/faithful-e2e-testing-of-nx-preset-generators) -- Plugin e2e testing patterns
- [Battle-Testing Nx Console with E2E Tests](https://blog.nrwl.io/battle-testing-nx-console-with-e2e-tests-c2d9ed299c98) -- Nx Console e2e approach
- [Better @nrwl/nx-plugin testing utils (Issue #10992)](https://github.com/nrwl/nx/issues/10992) -- Public vs internal e2e util gap
- [Docker Forums: git clone vs copy vs data container](https://forums.docker.com/t/best-practices-for-getting-code-into-a-container-git-clone-vs-copy-vs-data-container/4077)
- [Resolving a failing NX post-install](https://timdeschryver.dev/blog/resolving-a-failing-nx-post-install) -- Nx native binding install issues

### Tertiary (LOW confidence)
- [testcontainers/testcontainers-dotnet Discussion #438](https://github.com/testcontainers/testcontainers-dotnet/discussions/438) -- Volume sharing patterns across tests

---

## Metadata

**Confidence breakdown:**
- Problem analysis: HIGH -- verified from source code (preinstall.js, executor.ts, extract.ts, cache.ts)
- Nx testing patterns: HIGH -- verified from Nx's own e2e test infrastructure
- Synthetic fixture approach: HIGH -- standard pattern, no novel dependencies
- Prebake alternatives: MEDIUM -- approaches are sound but involve more complex tradeoffs
- Timing estimates: MEDIUM -- based on general Docker/Node.js performance knowledge, not measured in this specific environment

**Research date:** 2026-03-16
**Valid until:** 2026-04-16
