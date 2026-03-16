# Research: Speeding Up pnpm Linking Phase in Docker Containers

**Context:** `pnpm install --frozen-lockfile` in a Docker container (`node:22-slim`, arm64) takes ~130s for nrwl/nx (4649 packages, 138 workspace projects) even with a fully warm store (0 downloads, 4299 reused). All time is spent on linking.
**Researched:** 2026-03-16
**Overall confidence:** HIGH

---

## Executive Summary

The 130s linking time is caused by OverlayFS overhead on thousands of `link()` and `symlink()` syscalls. pnpm's default `isolated` linker creates a deep `.pnpm` virtual store with hardlinks from the content-addressable store plus symlinks for the dependency graph -- roughly 2x the package count in filesystem operations. On OverlayFS, each `link()` triggers a copy-up of the source file from the read-only lower layer to the writable upper layer, making hardlinks effectively as expensive as full copies.

The **fastest solution** is to bypass `pnpm install` entirely by copying a pre-installed `node_modules` snapshot (via `cp -a` or tar extraction) from the prebaked image layer. The **best pnpm-native solution** is `node-linker=hoisted` combined with `package-import-method=copy`, which eliminates symlinks and avoids the OverlayFS hardlink copy-up penalty. Mounting `node_modules` as tmpfs provides an additional speedup for any approach.

---

## Root Cause Analysis

### Why OverlayFS Makes Linking Slow

OverlayFS is a union filesystem with read-only lower layers and a single writable upper layer. When pnpm calls `fs.linkSync()` to hardlink a file from the store (lower layer) into `node_modules` (upper layer):

1. The kernel cannot create a true hardlink across layers
2. It triggers a **copy-up**: the entire file is copied from lowerdir to upperdir
3. Only then is the hardlink created in the upper layer
4. This makes every hardlink equivalent to a full file copy

For 4649 packages with potentially tens of thousands of individual files, this means tens of thousands of implicit file copies -- even though pnpm reports "0 downloaded, 4299 reused."

**Key evidence:**
- [pnpm issue #10217](https://github.com/pnpm/pnpm/issues/10217): OverlayFS returns ENOENT instead of EXDEV for cross-layer hardlinks (fixed in pnpm 10.24 to fallback to copy)
- [Docker docs on OverlayFS](https://docs.docker.com/engine/storage/drivers/overlayfs-driver/): "Hard links do not work across layers"
- [Docker for-linux #379](https://github.com/docker/for-linux/issues/379): Poor performance with large quantities of small files on overlay2

### The Isolated Linker's Cost

pnpm's default `isolated` linker creates:
- `node_modules/.pnpm/<pkg>/node_modules/<pkg>/` -- hardlinks to store files (one per file in each package)
- `node_modules/<pkg>` -- symlinks to the `.pnpm` virtual store entries
- Workspace `node_modules/<pkg>` -- symlinks for each workspace package

For 4649 packages, this is roughly:
- ~50,000+ hardlink operations (files across all packages)
- ~5,000+ symlink operations (dependency graph)
- All hitting OverlayFS copy-up overhead

**Confidence:** HIGH -- verified from pnpm docs, Docker docs, and multiple issue reports.

---

## Solutions Ranked by Expected Impact

### 1. Bypass pnpm install: Copy Pre-installed node_modules (RECOMMENDED)

**Expected speedup: 80-90% (130s -> 15-25s)**
**Confidence:** HIGH

Since the Docker image already has a prebaked `/repos/nx/` with fully installed `node_modules`, copy the entire tree instead of re-running `pnpm install` after cloning.

**Approach A: `cp -a` (preserve symlinks)**
```bash
# In the test setup, after cloning the repo
cp -a /repos/nx/node_modules /path/to/cloned/repo/node_modules
```

**Approach B: Pre-built tar snapshot**
```dockerfile
# During image build, after pnpm install succeeds:
RUN cd /repos/nx && tar cf /repos/nx-node-modules.tar node_modules/
```
```bash
# During test, after clone:
cd /path/to/cloned/repo && tar xf /repos/nx-node-modules.tar
```

**Gotchas with copying pnpm's node_modules:**

| Concern | Risk | Mitigation |
|---------|------|------------|
| Symlinks point to relative paths | LOW | pnpm uses relative symlinks within `node_modules`, so `cp -a` preserves them correctly as long as the directory structure is the same |
| Hardlinks to store break across layers | MEDIUM | On OverlayFS, hardlinks from the lower layer get copy-up'd anyway, so copied files behave identically to hardlinked ones |
| `.pnpm` lockfile metadata | LOW | The `node_modules/.pnpm/lock.yaml` records the virtual store state; it remains valid if the lockfile matches |
| pnpm integrity check on next install | MEDIUM | If `pnpm install` runs again later, it may want to re-verify; set `verify-store-integrity=false` to skip |
| Workspace symlinks | LOW | Workspace `node_modules` symlinks are relative within the monorepo tree; copying preserves them |

**Why this works:** The prebaked image already did the expensive linking work. Copying the result is a flat sequential I/O operation -- no per-file `link()` syscalls, no OverlayFS copy-up overhead. Even `cp -a` on 50K files is much faster than 50K individual `link()` calls through OverlayFS.

**Why tar may be faster than cp:** `tar xf` writes files sequentially without the overhead of directory traversal per file. For very large trees, tar extraction can be 2-3x faster than recursive cp.

### 2. Use `node-linker=hoisted` + `package-import-method=copy`

**Expected speedup: 30-50% (130s -> 65-90s)**
**Confidence:** MEDIUM

```ini
# .npmrc in the prebaked repo
node-linker=hoisted
package-import-method=copy
```

**Why it helps:**
- `hoisted` creates a flat `node_modules` (like npm) -- eliminates all symlinks
- `copy` skips the hardlink attempt entirely -- avoids OverlayFS copy-up overhead by doing direct copies
- Fewer total filesystem operations: hoisted deduplicates packages, reducing the number of entries

**Why not more improvement:** The copy operations themselves are still expensive on OverlayFS. You're still copying ~50K files. But avoiding the `link()` -> copy-up -> `link()` dance saves syscall overhead.

**Tradeoff:** Hoisted layout loses pnpm's strict dependency isolation. Packages can accidentally access undeclared dependencies. For an e2e test fixture, this is acceptable.

**Confidence:** MEDIUM -- the mechanism is well-understood but no direct benchmark exists for this specific configuration in Docker.

### 3. Mount node_modules as tmpfs

**Expected speedup: 40-60% for any install method**
**Confidence:** MEDIUM

```bash
docker run --tmpfs /app/node_modules:exec,size=2g ...
```

Or in docker-compose:
```yaml
services:
  test:
    tmpfs:
      - /app/node_modules:exec,size=2g
```

**Why it helps:**
- tmpfs is backed by RAM -- no disk I/O, no OverlayFS overhead
- All filesystem operations (link, symlink, copy, stat) become memory operations
- Eliminates the copy-up penalty entirely

**Gotchas:**
- tmpfs is ephemeral -- contents lost when container stops (fine for tests)
- Must be mounted at `docker run` time, not during `docker build`
- Requires enough RAM (~1-2 GB for a large monorepo's node_modules)
- The `exec` flag is required -- without it, binaries in `node_modules/.bin/` cannot execute

**Combining with solution 1:** Mount tmpfs for `node_modules`, then `tar xf` the snapshot into it. This gives both the bypass benefit and the RAM-speed I/O. Expected total time: ~5-10s.

### 4. Use `node-linker=pnp` (Plug'n'Play)

**Expected speedup: 70-80% (eliminates node_modules entirely)**
**Confidence:** LOW

```ini
# .npmrc
node-linker=pnp
symlink=false
```

PnP creates no `node_modules` directory at all. Instead, it generates a `.pnp.cjs` file that patches Node's module resolution to load packages directly from the store.

**Why LOW confidence:**
- Nx monorepo with 138 workspace projects likely has tools that don't support PnP
- Many packages assume `node_modules` exists (build tools, ESLint plugins, etc.)
- [pnpm issue #8146](https://github.com/pnpm/pnpm/issues/8146): PnP mode still generates some `node_modules` in practice
- Would require testing that all nx workspace functionality works under PnP
- Not recommended unless you're willing to debug compatibility issues

### 5. pnpm `shamefully-hoist=true` (with default linker)

**Expected speedup: 10-20%**
**Confidence:** MEDIUM

```ini
shamefully-hoist=true
```

Hoists all dependencies to root `node_modules` while keeping the isolated linker and virtual store. Reduces the number of symlinks needed (fewer per-package `node_modules` directories) but still creates the `.pnpm` virtual store with hardlinks.

**Verdict:** Marginal improvement. Use `node-linker=hoisted` instead if you want hoisting -- it eliminates symlinks entirely rather than just reducing them.

### 6. pnpm `prefer-offline=true` / `offline=true`

**Expected speedup: 0-5%**
**Confidence:** HIGH

These settings only affect the resolution/download phase, not linking. Since you already have 0 downloads and `--frozen-lockfile` skips resolution, these will have negligible effect on the 130s linking time.

**Verdict:** Not useful for this problem.

---

## What Does NOT Help

| Approach | Why Not |
|----------|---------|
| `prefer-offline` / `offline` | Only affects download phase, not linking |
| `pnpm fetch` | Optimizes download-to-store, not store-to-node_modules |
| Docker BuildKit cache mounts | Useful for warm store between builds, not for runtime linking speed |
| `pnpm store prune` | Only helps if the store is bloated; doesn't affect linking speed |
| Changing `store-dir` location | Store is already on the same filesystem; moving it won't help |
| `verify-store-integrity=false` | Skips hash verification but doesn't skip linking |
| `resolution-mode=lowest-direct` | Affects resolution, not linking |

---

## Recommended Strategy

**For maximum speed (target: <15s):**

```
Phase 1: Image build (Dockerfile)
  1. Clone nx repo
  2. Run `pnpm install --frozen-lockfile` (one-time cost during image build)
  3. Create snapshot: `tar cf /repos/nx-node-modules.tar -C /repos/nx node_modules`

Phase 2: Test runtime
  1. Clone from prebaked repo (already fast)
  2. Mount target's node_modules as tmpfs: `--tmpfs /test/repo/node_modules:exec,size=2g`
  3. Extract snapshot: `tar xf /repos/nx-node-modules.tar -C /test/repo/`
  4. Skip `pnpm install` entirely
```

**Fallback if pnpm install is required** (e.g., lockfile changes between prebake and test):

```ini
# .npmrc placed in the prebaked repo
node-linker=hoisted
package-import-method=copy
```

Combined with tmpfs mount for `node_modules`.

---

## Decision Matrix

| Solution | Speedup | Complexity | Confidence | Tradeoffs |
|----------|---------|------------|------------|-----------|
| cp -a / tar snapshot | 80-90% | Low | HIGH | Must match lockfile; loses strict isolation |
| tmpfs + tar snapshot | 90-95% | Medium | HIGH | Needs RAM; ephemeral (fine for tests) |
| node-linker=hoisted + copy | 30-50% | Low | MEDIUM | Loses dependency isolation |
| PnP mode | 70-80% | High | LOW | Compatibility risk with nx ecosystem |
| shamefully-hoist | 10-20% | Low | MEDIUM | Marginal improvement |
| prefer-offline/offline | 0-5% | Low | HIGH | Wrong bottleneck |

---

## Sources

### Official Documentation
- [pnpm Settings](https://pnpm.io/settings) -- nodeLinker, packageImportMethod, shamefullyHoist, symlink
- [pnpm Docker Guide](https://pnpm.io/docker) -- BuildKit cache mounts, multi-stage builds
- [pnpm Symlinked node_modules Structure](https://pnpm.io/symlinked-node-modules-structure) -- how hardlinks and symlinks are used
- [pnpm FAQ](https://pnpm.io/faq) -- store location, cross-device limitations
- [Docker OverlayFS Driver](https://docs.docker.com/engine/storage/drivers/overlayfs-driver/) -- copy-up behavior, hardlink limitations
- [Docker tmpfs Mounts](https://docs.docker.com/engine/storage/tmpfs/) -- tmpfs usage and constraints

### Issue Reports and Discussions
- [pnpm #10217: linkSync ENOENT in containers](https://github.com/pnpm/pnpm/issues/10217) -- OverlayFS hardlink bug, fixed in pnpm 10.24
- [pnpm #2479: Slow install in Docker on macOS](https://github.com/pnpm/pnpm/issues/2479) -- Docker filesystem overhead
- [pnpm Discussion #6020: Slow Docker builds](https://github.com/orgs/pnpm/discussions/6020) -- troubleshooting guidance
- [pnpm Discussion #5409: shamefully-hoist vs node-linker=hoisted](https://github.com/orgs/pnpm/discussions/5409) -- differences explained
- [pnpm #8146: PnP still generates node_modules](https://github.com/pnpm/pnpm/issues/8146) -- PnP limitations
- [Docker for-linux #379: Slow overlay2 with small files](https://github.com/docker/for-linux/issues/379) -- overlay2 performance issue
- [moby #41110: tmpfs for overlay upperdir](https://github.com/moby/moby/issues/41110) -- tmpfs as overlay layer

### Articles and Benchmarks
- [Why Docker Containers Are Slow: OverlayFS](https://medium.com/@toyezyadav/why-your-docker-containers-are-slow-the-hidden-cost-of-overlayfs-and-how-i-fixed-it-ffbc56e899e1) -- OverlayFS overhead analysis
- [Faster Node.js VS Code Containers with RAM Disks](https://paulhammond.org/2020/vscode-ramdisks) -- tmpfs for node_modules
- [Docker Storage Comparison with Benchmarks](https://eastondev.com/blog/en/posts/dev/20251217-docker-mount-comparison/) -- volume vs bind vs tmpfs performance
- [tnpm Rapid Mode: 10s Faster Than pnpm](https://dev.to/atian25/in-depth-of-tnpm-rapid-mode-how-could-we-fast-10s-than-pnpm-3bpp) -- OverlayFS-based alternative approach
- [Docker tmpfs for Faster I/O](https://oneuptime.com/blog/post/2026-01-16-docker-tmpfs-mounts/view) -- tmpfs performance guide
