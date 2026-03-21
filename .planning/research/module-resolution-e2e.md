# Research: Module Resolution/Linker Optimizations for e2e Docker Performance

**Context:** Two workspaces inside a Docker container: `/workspace/` (host, npm, ~200MB node_modules) and `/workspace/.repos/nx/` (synced nrwl/nx monorepo, pnpm, ~800MB node_modules). Container is snapshot-committed after setup. The overlay2 diff layer captures `/workspace/node_modules/` (runtime-created); `.repos/nx/node_modules/` is from a COPY layer (not in diff).
**Researched:** 2026-03-19
**Overall confidence:** HIGH

---

## Executive Summary

The primary performance bottleneck is `docker commit` time, which is proportional to the number of files in the overlay2 writable layer (the diff). The host workspace's `node_modules/` (~200MB, ~30K files) is the main contributor since it is created at runtime (after image build). The synced repo's `node_modules/` (~800MB) is baked into a COPY layer and does NOT appear in the diff -- it is read-only.

**Recommended approach: Yarn PnP for the HOST workspace only.** This eliminates node_modules entirely from the runtime-created overlay diff. The synced repo (nrwl/nx) stays on pnpm -- it is not feasible to change a third-party repo's package manager, and its node_modules is already in a static image layer.

Yarn PnP reduces the host workspace's runtime-created filesystem footprint from ~30K files (~200MB) to ~3 files (~2MB: `.pnp.cjs` + `.yarnrc.yml` + `yarn.lock`). The `.yarn/cache/` directory contains compressed zip archives and would also need to be in the diff, but it is far smaller and has far fewer files than expanded node_modules.

**However, there is a critical compatibility blocker:** The `@op-nx/polyrepo` plugin's `extractGraphFromRepo()` function resolves the nx binary at `node_modules/.bin/nx` -- a path that does not exist under Yarn PnP. Additionally, Nx's own PnP support is officially documented but has known stability issues with certain Nx plugins and build tooling. For these reasons, the migration is **feasible but carries MEDIUM risk** and requires plugin code changes.

The **pragmatically safer approach** is to keep npm for the host workspace but optimize the Docker commit by reducing file count through other means (e.g., pre-baking the host workspace's node_modules into the image layer so it does not appear in the diff).

---

## Comparison Matrix

### Module Resolution Strategies for Docker e2e

| Criterion | npm (current) | pnpm isolated (default) | pnpm hoisted | pnpm PnP | Yarn PnP |
|-----------|---------------|------------------------|--------------|----------|----------|
| **node_modules created** | Yes (~30K files) | Yes (~50K+ files with .pnpm) | Yes (~30K files) | No | No |
| **Overlay diff file count** | ~30K | ~50K+ | ~30K | ~5 files | ~5 files (.pnp.cjs, .yarn/cache/*.zip) |
| **Overlay diff size** | ~200MB | ~400MB (store + symlinks) | ~200MB | ~100MB (cache zips) | ~100MB (cache zips) |
| **docker commit speed** | Slow (30K file diff) | Slowest (50K+ file diff) | Slow (30K file diff) | Fast (~5 file diff) | Fast (~5 file diff) |
| **Cold install time** | ~14s (50 deps) | ~4s (50 deps) | ~5s (50 deps) | ~4s | ~7s |
| **Warm install time** | ~3s | ~1s | ~1s | ~1s | 0s (zero-install) |
| **Nx 22.x compatibility** | Full | Full | Full | Experimental (bugs) | Documented, fragile |
| **Shared cache feasibility** | npm cache global (but node_modules duplicated) | Same store = hardlinks (same FS only) | Same as isolated | N/A (no node_modules) | No global cross-project cache |
| **Migration effort** | None (current) | Medium | Medium | High | High |
| **Plugin code changes** | None | None | None | Yes (binary resolution) | Yes (binary resolution) |

### Docker-Specific Pros/Cons

| Strategy | Docker Pros | Docker Cons |
|----------|-------------|-------------|
| **npm (current)** | Simple, well-understood | Large diff layer from runtime node_modules |
| **pnpm isolated** | Content-addressable store | Hardlinks become copies on overlay2; inflated diff; store + node_modules duplication in layers |
| **pnpm hoisted** | Flat layout, fewer symlinks | Same overlay2 copy-up problem; no size advantage over npm |
| **pnpm PnP** | No node_modules = tiny diff | Experimental in pnpm (bugs: still generates node_modules in some cases); binary resolution broken |
| **Yarn PnP** | No node_modules = tiny diff; zero-install possible; `.yarn/cache/` is compressed zips (small, few files) | Breaking: `node_modules/.bin/` does not exist; needs `yarn run` or `yarn node`; package compatibility issues |

---

## Detailed Analysis

### 1. Yarn PnP (Plug'n'Play)

**How it works:**
- No `node_modules` folder at all
- `.pnp.cjs` is a generated resolver that maps package names to zip archives in `.yarn/cache/`
- Packages are stored as compressed `.zip` files in `.yarn/cache/`
- Node's module resolution is monkey-patched at runtime to use the PnP resolver
- Binaries are accessed via `yarn run <bin>` or `yarn exec <bin>`, NOT via `node_modules/.bin/`

**Nx compatibility (MEDIUM confidence):**
- Nx officially documents Yarn PnP support at [nx.dev/docs/guides/tips-n-tricks/yarn-pnp](https://nx.dev/docs/guides/tips-n-tricks/yarn-pnp)
- `create-nx-workspace --pm=yarn` works with Yarn Berry
- Nx defaults to `nodeLinker: node-modules` for backward compatibility
- Switching to `nodeLinker: pnp` requires fixing peer dependency errors via `packageExtensions` in `.yarnrc.yml`
- Known issues: ESM support gaps, NestJS builds fail, `@nx/jest` has reported incompatibilities (GitHub issue #11733)
- `createNodesV2` and `createDependencies` APIs themselves are linker-agnostic -- they receive project configs, not filesystem paths
- **However:** The `@op-nx/polyrepo` plugin's `extractGraphFromRepo()` resolves `node_modules/.bin/nx` -- this path does not exist under PnP

**Docker footprint:**
- `.pnp.cjs`: ~2MB (single file)
- `.yarn/cache/`: compressed zips, typically 50-70% smaller than expanded node_modules
- For a typical Nx workspace with ~50 direct deps: `.yarn/cache/` would be ~60-80MB vs ~200MB expanded
- **File count in diff: ~100 zip files vs ~30,000 individual files**
- `docker commit` diff is dramatically smaller

**Shared cache between workspaces:**
- Yarn Berry does NOT provide a global shared cache across separate projects (unlike Yarn 1)
- Each project maintains its own `.yarn/cache/`
- Two Yarn PnP workspaces on the same machine cannot share a cache
- This means the host workspace and .repos/nx cannot share dependencies via Yarn PnP cache

**Source:** [Yarn PnP docs](https://yarnpkg.com/features/pnp), [Nx Yarn PnP guide](https://nx.dev/docs/guides/tips-n-tricks/yarn-pnp), [yarnpkg/berry#954](https://github.com/yarnpkg/berry/issues/954)

### 2. pnpm Linker Strategies

#### node-modules (default / isolated)

**How it works:**
- Content-addressable store at `~/.local/share/pnpm/store/`
- `node_modules/.pnpm/` contains hardlinks from store to per-package directories
- `node_modules/<pkg>` are symlinks to `.pnpm/` entries
- Strict dependency isolation (packages only see declared deps)

**Docker problem:**
- On overlay2, hardlinks from the store (lower layer) to node_modules (upper layer) trigger **copy-up** -- each hardlink effectively becomes a full file copy
- The store AND node_modules both end up in the image, roughly doubling size
- For the nrwl/nx repo: ~800MB store + ~800MB node_modules in the worst case

**Source:** [pnpm FAQ](https://pnpm.io/faq), [Docker overlay2 docs](https://docs.docker.com/engine/storage/drivers/overlayfs-driver/)

#### hoisted

**How it works:**
- Flat `node_modules` like npm (no `.pnpm/` virtual store, no symlinks)
- `package-import-method: copy` avoids hardlink copy-up
- Packages can accidentally access undeclared dependencies

**Docker footprint:** Similar to npm -- ~30K files, ~200MB. No size advantage over npm for Docker.

**Source:** [pnpm blog: node-modules config options](https://pnpm.io/blog/2020/10/17/node-modules-configuration-options-with-pnpm)

#### pnp

**How it works:**
- Similar concept to Yarn PnP but implemented by pnpm
- Should create no `node_modules`, generating a `.pnp.cjs` instead
- Requires `symlink: false` alongside `node-linker: pnp`

**Status: EXPERIMENTAL / BUGGY:**
- [pnpm issue #8146](https://github.com/pnpm/pnpm/issues/8146): `node-linker=pnp` with `symlink=false` still generates `node_modules` in some cases (reported pnpm 9.1.3, May 2024)
- pnpm's PnP implementation is less mature than Yarn's
- No documented Nx compatibility testing with pnpm PnP

**Source:** [pnpm settings](https://pnpm.io/settings), [pnpm#8146](https://github.com/pnpm/pnpm/issues/8146)

### 3. Shared Cache Between Host and External Repo

**Scenario:** Host workspace (npm or yarn) and `.repos/nx/` (pnpm) share many deps (@nx/devkit, typescript, etc.)

| Cache Strategy | Feasibility | Why |
|---------------|-------------|-----|
| npm global cache (`~/.npm/_cacache/`) | Shared download cache, but node_modules still duplicated | npm caches tarballs, not installed packages |
| pnpm store (both workspaces on pnpm) | Hardlinks share content on same FS | Requires both workspaces to use pnpm; hardlinks break on overlay2 cross-layer |
| pnpm global virtual store (experimental) | Symlinks to shared store | Requires pnpm 11+, `enableGlobalVirtualStore: true`; experimental |
| Yarn PnP cache | Per-project only | Yarn Berry has no global cross-project cache |
| Mixed PM (npm + pnpm) | Not possible | Different package managers, different store formats |

**Verdict:** Shared caching between the two workspaces is NOT practically achievable because:
1. They use different package managers (npm vs pnpm)
2. Even with the same PM, overlay2 defeats hardlink-based sharing
3. The synced repo's node_modules is already baked into an image layer (static, not re-installed at runtime)

**The real optimization target is reducing runtime-created files**, not sharing caches.

### 4. Docker-Specific Considerations

#### overlay2 diff and `docker commit`

`docker commit` captures the writable layer diff. The NaiveDiffDriver walks every file in the container's upper layer, comparing against lower layers. Performance is proportional to file count, not file size.

**Current diff contents (runtime-created):**
- `/workspace/node_modules/` -- ~30K files, ~200MB (npm install of plugin + deps)
- `/workspace/nx.json` -- 1 file (written in global setup)
- `/workspace/package.json` -- 1 file (modified by npm install)
- `/workspace/package-lock.json` -- 1 file (modified by npm install)
- `/workspace/.repos/.polyrepo-graph-cache.json` -- 1 file (graph cache)
- `/workspace/.nx/` -- Nx cache directory (varies)

The `.repos/nx/` directory is from a `COPY --link` layer and is read-only -- it does NOT appear in the diff.

**Impact of eliminating host node_modules from diff:**
- `docker commit` time: proportional to file count reduction
- Portworx benchmarks show `docker commit` can be [800% faster](https://portworx.com/blog/lcfs-speed-up-docker-commit/) with fewer diff files
- Going from ~30K files to ~100 files (Yarn PnP) would make commit near-instantaneous

#### Bind mounts / volumes as alternatives

| Approach | Pros | Cons |
|----------|------|------|
| Docker volume for node_modules | Bypasses overlay2 | Not captured by `docker commit` -- breaks snapshot pattern |
| Bind mount for shared store | Host-speed I/O | Not captured by commit; path compatibility issues on Windows |
| tmpfs for node_modules | RAM-speed I/O | Not captured by commit; ephemeral |

**Verdict:** All mount-based approaches are incompatible with the `container.commit()` snapshot pattern because volume/tmpfs/bind mount contents are not included in commits. The snapshot pattern requires everything to be on the overlay2 filesystem.

### 5. Nx Plugin Compatibility Considerations

The `@op-nx/polyrepo` plugin has two module-resolution-sensitive code paths:

**1. `extractGraphFromRepo()` in `extract.ts`:**
```typescript
const nxBin = join(repoPath, 'node_modules', '.bin', 'nx');
const command = `"${nxBin}" graph --print`;
```
This directly resolves `node_modules/.bin/nx`. Under Yarn PnP, this path does not exist. The fix would be to use `yarn exec nx graph --print` or `npx nx graph --print` (npx works under PnP when the package is installed).

**2. Host workspace module loading:**
When Nx loads the `@op-nx/polyrepo` plugin, it resolves it from `node_modules/@op-nx/polyrepo/`. Under Yarn PnP, Nx itself handles this via the PnP resolver (Nx's documented PnP support covers plugin loading).

**3. `createNodesV2` and `createDependencies`:**
These APIs receive `context.workspaceRoot` and project configs -- they do not directly resolve modules from `node_modules`. They are linker-agnostic.

**Risk assessment for PnP migration:**
- `extractGraphFromRepo()`: **MUST be patched** -- the hardcoded `node_modules/.bin/nx` path will fail
- Plugin loading: **Should work** -- covered by Nx's documented PnP support
- createNodesV2/createDependencies: **No risk** -- API-level, not filesystem-level

### 6. Migration Effort Assessment

#### Option A: Switch HOST workspace from npm to Yarn PnP

| Step | Effort | Risk |
|------|--------|------|
| Install Yarn Berry, configure `.yarnrc.yml` with `nodeLinker: pnp` | Low | Low |
| Run `yarn install`, resolve peer dependency errors with `packageExtensions` | Medium | Medium -- depends on how many Nx plugins have undeclared peers |
| Fix `extractGraphFromRepo()` to not use `node_modules/.bin/nx` | Low | Low |
| Update Dockerfile to use `yarn` instead of `npm` for workspace creation | Low | Low |
| Update global-setup.ts to publish/install via yarn | Medium | Medium |
| Test all Nx commands work under PnP (build, test, lint, graph) | High | Medium -- breakage likely with some tools |
| Update CI workflows | Low | Low |
| **Total** | **Medium-High** | **Medium** |

**Can the synced repo stay on pnpm?** Yes. The synced repo is an independent workspace with its own package manager. The host workspace's PM choice does not affect the synced repo. The `extractGraphFromRepo()` function shells out to the synced repo's own nx binary -- it just needs to find that binary correctly (which it already does for pnpm repos via `node_modules/.bin/nx`).

#### Option B: Pre-bake host node_modules into the Docker image layer (RECOMMENDED)

Instead of changing the package manager, move the host workspace's npm install into the Dockerfile so node_modules is in a static image layer (not the runtime diff).

| Step | Effort | Risk |
|------|--------|------|
| Move `npm install @op-nx/polyrepo` into Dockerfile | Low | Low -- but requires publishing to a registry at build time, or using a local tarball |
| Alternative: install a placeholder package set that matches the plugin's deps | Low | Low |
| Result: node_modules is in a COPY/RUN layer, not in the writable diff | N/A | N/A |
| **Total** | **Low** | **Low** |

**Why this works:** The `docker commit` diff only captures changes to the writable layer. If node_modules already exists in a read-only image layer, the diff is near-empty (only modified files, not the full tree). The only new files in the diff would be `nx.json`, `package.json` changes, and the graph cache file.

**Limitation:** The plugin version installed at build time may differ from the e2e version being tested. However, the current global-setup already runs `npm install @op-nx/polyrepo@e2e` which MODIFIES existing node_modules (adds/updates packages). Modified files in overlay2 trigger copy-up of only the changed files, not the entire tree.

#### Option C: Keep npm, accept current performance

If `docker commit` time is acceptable (measure first!), do nothing. The ~30K file diff may only add 2-5 seconds to commit time depending on the Docker engine and storage driver performance.

---

## Benchmarks (Synthesized from Sources)

### Install Time Comparison (50 direct / ~400 total dependencies)

| Package Manager | Cold Install | Warm Install |
|-----------------|-------------|--------------|
| npm 11.x | ~14s | ~3s |
| pnpm 10.x (isolated) | ~4s | ~1s |
| pnpm (hoisted) | ~5s | ~1s |
| Yarn 4.x (PnP) | ~7s | ~0s (zero-install) |

**Source:** [pnpm benchmarks](https://pnpm.io/benchmarks), [2026 PM comparison](https://windframe.dev/blog/pnpm-vs-npm-vs-yarn), [Syncfusion comparison](https://www.syncfusion.com/blogs/post/pnpm-vs-npm-vs-yarn)

### Docker Image Size Impact (estimated for host workspace ~50 deps)

| Strategy | node_modules Size | File Count | docker commit Diff |
|----------|------------------|------------|-------------------|
| npm (current) | ~200MB | ~30,000 | ~200MB / 30K files |
| pnpm isolated | ~400MB (store+nm) | ~50,000+ | ~400MB / 50K files |
| pnpm hoisted | ~200MB | ~30,000 | ~200MB / 30K files |
| Yarn PnP | 0 (no node_modules) | 0 | ~100MB / ~100 files (.yarn/cache/) |
| Pre-baked npm (Option B) | ~200MB (in image layer) | 0 in diff | ~5MB / ~10 files (modified only) |

### `docker commit` Time Estimates

Based on overlay2 NaiveDiffDriver behavior (file-count-proportional):

| Scenario | Files in Diff | Estimated Commit Time |
|----------|--------------|----------------------|
| Current (npm, runtime install) | ~30,000 | 3-8s |
| pnpm isolated | ~50,000+ | 5-12s |
| Yarn PnP | ~100 | <1s |
| Pre-baked npm (Option B) | ~10-50 | <1s |

**Confidence:** LOW for absolute times (not measured), HIGH for relative ordering.

---

## Recommended Approach

### Primary: Pre-bake host node_modules into Docker image (Option B)

**Why:** Lowest risk, lowest effort, significant commit-time improvement. No package manager migration, no plugin code changes, no Nx compatibility concerns.

**How:** In the Dockerfile, after `create-nx-workspace`, install a dummy/placeholder set of dependencies that matches the plugin's transitive dependency tree. Or install the plugin from a pre-built tarball:

```dockerfile
# Pre-install dependencies that the plugin will need
# This puts node_modules in a static image layer
COPY plugin-tarball.tgz /tmp/plugin-tarball.tgz
RUN cd /workspace && npm install /tmp/plugin-tarball.tgz && rm /tmp/plugin-tarball.tgz
```

When global-setup later runs `npm install @op-nx/polyrepo@e2e --registry http://verdaccio:4873`, npm only modifies/adds the changed packages. The overlay diff captures only the delta, not the full tree.

### Secondary: Measure before optimizing

Before implementing any optimization, measure the actual `docker commit` time for the current setup:

```bash
time docker commit <container-id> test-snapshot
```

If commit time is under 3 seconds, the optimization is premature. The 30K-file diff sounds large but may be fast enough on modern Docker engines.

### Deferred: Yarn PnP migration

If measurements show `docker commit` is a significant bottleneck AND pre-baking doesn't sufficiently reduce the diff, consider Yarn PnP for the host workspace. This is a higher-effort, higher-risk approach but provides the most aggressive file-count reduction.

**Prerequisites for Yarn PnP migration:**
1. Fix `extractGraphFromRepo()` to use `npx nx` or `yarn exec nx` instead of `node_modules/.bin/nx`
2. Verify all Nx plugins work under PnP (build, test, lint, graph)
3. Test the full e2e flow with Yarn PnP
4. Add `packageExtensions` for any broken peer dependencies

---

## Gaps and Open Questions

1. **Actual `docker commit` time not measured.** All timing estimates are theoretical. Measure before optimizing.

2. **Pre-bake approach delta behavior.** When `npm install @op-nx/polyrepo@e2e` runs on top of a pre-existing node_modules, does npm only write changed files? Or does it rewrite `package-lock.json` and trigger broader modifications? Needs testing.

3. **Nx 22.x + Yarn PnP stability.** The Nx docs acknowledge PnP support but the issue tracker shows ongoing problems. No first-hand testing has been done for this project's specific plugin set.

4. **pnpm PnP maturity.** pnpm's `node-linker=pnp` has known bugs (still generating node_modules). Do not use until pnpm stabilizes this feature.

5. **Global virtual store in Docker.** pnpm 11's `enableGlobalVirtualStore` is experimental and Docker-untested. Could theoretically help if both workspaces used pnpm, but they don't.

---

## Sources

### Official Documentation (HIGH confidence)
- [Nx + Yarn PnP guide](https://nx.dev/docs/guides/tips-n-tricks/yarn-pnp) -- Nx's official PnP setup instructions and known limitations
- [Yarn PnP feature docs](https://yarnpkg.com/features/pnp) -- How PnP works, migration guide
- [pnpm Docker guide](https://pnpm.io/docker) -- BuildKit cache mounts, multi-stage builds
- [pnpm settings reference](https://pnpm.io/settings) -- nodeLinker, packageImportMethod, symlink options
- [pnpm global virtual store](https://pnpm.io/11.x/global-virtual-store) -- Experimental shared store feature
- [Docker overlay2 storage driver](https://docs.docker.com/engine/storage/drivers/overlayfs-driver/) -- Copy-on-write behavior, hardlink handling
- [pnpm FAQ](https://pnpm.io/faq) -- Cross-filesystem limitations, store behavior
- [pnpm benchmarks](https://pnpm.io/benchmarks) -- Install time comparisons

### Issue Trackers (MEDIUM confidence)
- [nrwl/nx#2386](https://github.com/nrwl/nx/issues/2386) -- Yarn 2 / PnP support request (2020, ongoing)
- [nrwl/nx#11733](https://github.com/nrwl/nx/issues/11733) -- @nrwl/jest PnP mode failures
- [nrwl/nx#15406](https://github.com/nrwl/nx/issues/15406) -- NestJS + Yarn PnP failures
- [pnpm#8146](https://github.com/pnpm/pnpm/issues/8146) -- pnp linker still generating node_modules
- [yarnpkg/berry#954](https://github.com/yarnpkg/berry/issues/954) -- No global cache in Yarn Berry
- [yarnpkg/berry#2188](https://github.com/yarnpkg/berry/issues/2188) -- Binary execution in PnP mode
- [yarnpkg/berry#3201](https://github.com/yarnpkg/berry/discussions/3201) -- Zero-installs with Docker

### Community / Benchmarks (LOW-MEDIUM confidence)
- [Portworx: docker commit performance](https://portworx.com/blog/lcfs-speed-up-docker-commit/) -- 800% improvement with fewer files
- [Klaviyo: Goodbye dependency installations](https://klaviyo.tech/goodbye-dependency-installations-a242ccf6fa40) -- Real-world Yarn PnP CI improvement (90% build time reduction)
- [2026 PM comparison (windframe)](https://windframe.dev/blog/pnpm-vs-npm-vs-yarn) -- Install benchmarks
- [2026 PM comparison (Syncfusion)](https://www.syncfusion.com/blogs/post/pnpm-vs-npm-vs-yarn) -- Install benchmarks
- [Depot: optimal pnpm Dockerfile](https://depot.dev/docs/container-builds/optimal-dockerfiles/node-pnpm-dockerfile) -- Docker + pnpm best practices
- [Docker commit size bloat](https://forums.docker.com/t/docker-image-size-is-becoming-huge-after-docker-commit/74351) -- Community reports on commit size

### Project-Internal (HIGH confidence)
- `.planning/research/pnpm-linking-speed-docker.md` -- overlay2 copy-up analysis, pnpm linker comparison
- `.planning/research/docker-io-optimization.md` -- Container filesystem I/O deep dive
- `packages/op-nx-polyrepo/src/lib/graph/extract.ts` -- Plugin's hardcoded `node_modules/.bin/nx` path
- `packages/op-nx-polyrepo-e2e/docker/Dockerfile` -- Current Docker setup
- `packages/op-nx-polyrepo-e2e/src/setup/global-setup.ts` -- Current e2e setup flow
