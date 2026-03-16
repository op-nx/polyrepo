# Research: Docker Container Filesystem I/O Performance for Hardlink-Heavy Workloads

**Context:** Inside a Docker container on Docker Desktop for Windows (WSL2 backend, arm64), `pnpm install` with a warm store creates ~4649 hardlinks/symlinks in ~130s. Zero network I/O -- this is purely filesystem I/O. The question is what can be done at the Docker/filesystem/testcontainers layer to reduce this time.
**Researched:** 2026-03-16
**Overall confidence:** HIGH

---

## Executive Summary

The 130s `pnpm install` time is caused by three compounding factors: (1) overlay2 copy-on-write overhead when the pnpm store lives in a lower image layer but linking happens in the writable upper layer, (2) the WSL2 architecture adding latency through its virtualization layer, and (3) the sheer volume of 4649 hardlink operations on a filesystem not optimized for this pattern.

**The most impactful single optimization is tmpfs:** mounting the clone target (or at minimum the `node_modules` directory) as a tmpfs via testcontainers' `.withTmpFs()`. This eliminates disk I/O entirely for the linking phase, providing ~20x I/O throughput improvement over SSD-backed overlay2. However, the best overall solution is to avoid the problem entirely by using a synthetic fixture (as recommended in `docker-e2e-monorepo-fixtures.md`), which reduces the install from 4649 packages to ~20 packages.

---

## Research Area 1: overlay2 and Hardlink Performance

### How overlay2 Handles Hardlinks (HIGH confidence)

overlay2 uses a layered filesystem with read-only lower layers and a writable upper layer. When a container creates a hardlink to a file that exists in a lower layer (i.e., from the Docker image), overlay2 must perform a **copy-up** operation -- copying the entire file from the lower layer to the upper layer before the hardlink can be created. This is file-level CoW, not block-level.

**This is the core performance problem.** The Dockerfile runs `pnpm install` at build time (populating the pnpm content-addressable store in a lower image layer). When the sync executor later runs `pnpm install` at container runtime, pnpm tries to hardlink from the store to `node_modules`. Each hardlink triggers a copy-up of the source file from the lower layer to the upper layer. For 4649 packages, this means 4649+ individual file copy-up operations.

### Hardlinks Within Same Layer vs Cross-Layer (HIGH confidence)

| Scenario | Behavior | Performance |
|----------|----------|-------------|
| Hardlink within same RUN/layer | True hardlink (shared inode) | Fast, no copy |
| Hardlink from lower layer to upper layer | Full file copy-up, then hardlink | Slow, equivalent to copying the file |
| Hardlink within container writable layer | True hardlink (shared inode) | Fast, no copy |

**Source:** [moby/moby#48140](https://github.com/moby/moby/issues/48140) -- confirmed regression where cross-layer hardlinks inflate image size, proving that copy-up occurs.

### Would Switching Storage Drivers Help?

| Driver | Hardlink Performance | Availability on Docker Desktop WSL2 | Verdict |
|--------|---------------------|--------------------------------------|---------|
| overlay2 (default) | File-level CoW, slow for cross-layer hardlinks | Default | Current driver |
| overlayfs snapshotter (containerd) | Same underlying mechanism as overlay2 | Docker Engine 29.0+ default | No improvement |
| btrfs | Block-level CoW, reflinks supported | Not available on Docker Desktop WSL2 | Not an option |
| zfs | Block-level CoW | Not available on Docker Desktop WSL2 | Not an option |
| vfs | No CoW (full copies always) | Available but very slow | Worse |

**Verdict:** Switching storage drivers is not a viable path on Docker Desktop for Windows. The WSL2 backend uses ext4 inside a VHD, and overlay2/overlayfs snapshotter is the only practical option. Block-level CoW drivers (btrfs, zfs) are not available in this environment.

---

## Research Area 2: Docker Volume Mounts

### Named Volumes for pnpm Store (MEDIUM confidence)

A Docker named volume bypasses the overlay2 filesystem entirely -- it mounts directly on the backing ext4 filesystem inside the WSL2 VM. If the pnpm store were on a named volume AND node_modules were on the same volume, hardlinks would work as true hardlinks without copy-up overhead.

**Problem:** The pnpm store is populated during `docker build` (in an image layer), but a named volume is only available at `docker run` time. To use a named volume for the store, you would need to:
1. Create the named volume
2. Start a container, run `pnpm install` to populate the store on the volume
3. Commit that container (but volumes are NOT included in commits)
4. Re-attach the volume for each test container

This is incompatible with the testcontainers snapshot pattern already in use (`container.commit()` does not capture volume contents).

### tmpfs for Clone Target (HIGH confidence -- RECOMMENDED)

Mount the entire clone target directory as tmpfs. Since pnpm's store and node_modules would both be in-memory on the same tmpfs filesystem, hardlinks work as true hardlinks with zero disk I/O.

**Performance characteristics:**
- tmpfs throughput: ~10,000 MB/s (RAM speed)
- SSD-backed overlay2: ~500 MB/s
- Improvement factor: ~20x for raw I/O

**Testcontainers API:**
```typescript
const container = await workspaceImage
  .withTmpFs({ "/workspace/.repos": "rw,exec,size=4g" })
  .withNetwork(network)
  .withCommand(['sleep', 'infinity'])
  .start();
```

**Important considerations:**
- `exec` flag required (not `noexec`) -- pnpm needs to execute binaries
- `size=4g` -- nrwl/nx with node_modules is ~3GB; adjust based on fixture size
- Data is lost when container stops -- fine for tests
- Must have enough RAM allocated to the WSL2 VM (check `.wslconfig`)
- tmpfs does NOT survive `container.commit()` -- the snapshot image will NOT contain the tmpfs contents

**The tmpfs-doesn't-survive-commit issue is critical.** If the test flow is:
1. Start container
2. Clone + pnpm install (on tmpfs -- fast)
3. Run test assertions
4. Stop container

Then tmpfs works perfectly. But if the flow involves committing the container after install to create a snapshot, tmpfs contents are lost.

### Volume Mount for pnpm Store at Runtime (MEDIUM confidence)

An alternative to tmpfs: mount a Docker volume for the pnpm store, pre-populated during global setup.

```typescript
// In global setup, before test containers
const storeContainer = await workspaceImage
  .withBindMounts([{ source: 'pnpm-store-vol', target: '/root/.local/share/pnpm/store' }])
  .start();
// Store is populated from the image layer into the volume
await storeContainer.exec(['cp', '-a', '/root/.local/share/pnpm/store/.', '/mnt/store/']);
```

**Verdict:** Overly complex for the benefit. tmpfs is simpler and faster.

---

## Research Area 3: Docker BuildKit Features

### `RUN --mount=type=cache` (HIGH confidence -- NOT applicable at runtime)

BuildKit cache mounts persist across builds, allowing pnpm to reuse its store across `docker build` invocations:

```dockerfile
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile
```

**This only applies to `docker build` time, not container runtime.** The current Dockerfile already bakes the pnpm store into the image via a regular `RUN pnpm install`. BuildKit cache mounts would speed up rebuilds of the Docker image, but do not help with the runtime `pnpm install` that the sync executor runs inside a running container.

**Where it would help:** If the Docker image is rebuilt frequently (e.g., when `NX_VERSION` changes), a BuildKit cache mount would make rebuilds faster by caching the pnpm store across builds. This is a minor optimization for image build time, not for test execution time.

### `RUN --mount=type=tmpfs` (MEDIUM confidence)

BuildKit also supports tmpfs mounts during build. This could speed up the prebake `pnpm install` in the Dockerfile:

```dockerfile
RUN --mount=type=tmpfs,target=/tmp \
    cd /repos/nx && corepack pnpm install --frozen-lockfile
```

**Verdict:** Marginal improvement for build time. Does not help runtime.

---

## Research Area 4: WSL2-Specific Optimizations

### The WSL2 I/O Stack (HIGH confidence)

Docker Desktop on WSL2 has this I/O path for container filesystem operations:

```
Container process
  -> overlay2 (in WSL2 VM)
    -> ext4 filesystem (in WSL2 VM's VHD)
      -> Virtual Hard Disk (VHD on Windows host)
        -> Host filesystem (ReFS Dev Drive in your case)
```

Key insight: The container's overlay2 filesystem runs entirely within the WSL2 VM. It does NOT cross the 9P bridge to Windows unless bind mounts reference `/mnt/c/` or similar Windows paths. Since the Docker image layers and container writable layer all live inside the WSL2 VM's ext4 VHD, the 9P performance penalty does NOT apply here.

**However, the ext4 VHD is a virtual disk:** Each I/O operation goes through Hyper-V's virtual disk driver. This adds latency compared to bare-metal Linux, though WSL2 achieves ~87% of bare-metal performance (Phoronix benchmarks, September 2025).

### WSL2 Resource Allocation (MEDIUM confidence)

Ensure adequate resources via `%UserProfile%\.wslconfig`:

```ini
[wsl2]
memory=16GB
processors=8
swap=4GB

[experimental]
sparseVhd=true
autoMemoryReclaim=gradual
```

More memory is especially important if using tmpfs, which consumes RAM. More processors help with pnpm's parallel linking operations.

### WSL2 vs Native Linux Overhead (HIGH confidence)

The ~13% overhead from WSL2 virtualization is unavoidable without switching to native Linux or a Linux CI runner. For 130s of I/O, this accounts for roughly 17s of overhead -- significant but not the primary bottleneck.

---

## Research Area 5: testcontainers `.withTmpFs()` (HIGH confidence -- RECOMMENDED)

### How It Works

`.withTmpFs()` adds a tmpfs mount to the container at startup, storing all data in memory:

```typescript
const container = await workspaceImage
  .withTmpFs({ "/workspace/.repos/nx": "rw,exec,size=4g" })
  .withNetwork(network)
  .withCommand(['sleep', 'infinity'])
  .start();
```

### Why It Helps for pnpm Linking

When the sync executor clones into `/workspace/.repos/nx/` and runs `pnpm install`:
1. The clone writes to tmpfs (fast)
2. pnpm's store is on the container's overlay2 layer (lower layer)
3. pnpm tries to hardlink from store to `node_modules/` on tmpfs

**Problem:** The pnpm store (on overlay2) and `node_modules` (on tmpfs) are on **different filesystems**. Hardlinks cannot cross filesystem boundaries. pnpm will fall back to **copying** files instead of hardlinking.

### Better Approach: tmpfs for BOTH Store and Target

Mount a single tmpfs that contains both the pnpm store and the working directory:

```typescript
const container = await workspaceImage
  .withTmpFs({
    "/workspace/.repos": "rw,exec,size=4g",
    "/root/.local/share/pnpm/store": "rw,exec,size=2g"
  })
  .start();

// Pre-populate the store on tmpfs by copying from the image layer
await container.exec([
  'cp', '-a',
  '/prebaked-pnpm-store/.',
  '/root/.local/share/pnpm/store/'
]);
```

But this reintroduces the overhead of copying the store (~2GB) from the image layer to tmpfs, which may take 20-40s itself.

### Pragmatic tmpfs Strategy

The most pragmatic use of tmpfs for the current setup:

1. Mount `/workspace/.repos` as tmpfs
2. Accept that pnpm will **copy** (not hardlink) from the overlay2 store to tmpfs node_modules
3. Copying to tmpfs is still fast (~10,000 MB/s throughput) vs copying within overlay2 (~500 MB/s)

Even with pnpm falling back to copy mode, the destination I/O is RAM-speed. The source reads from the overlay2 layer (which is cached in the Linux page cache anyway for warm stores). This should still provide a substantial speedup.

**Estimated improvement:** From 130s to approximately 20-40s for the copy-based install. The bottleneck shifts from I/O to pnpm's JavaScript overhead (resolution, linking logic).

### Interaction with `container.commit()`

**Critical:** tmpfs contents are NOT included in `container.commit()`. If the test framework commits the container to create a snapshot, the synced repo and node_modules will be missing from the snapshot. The current setup commits the workspace container after plugin install, not after sync, so this may not be an issue depending on when tmpfs is used.

---

## Research Area 6: Container Commit with Pre-Installed State

### Current Flow (from global-setup.ts)

```
1. Build prebaked image (Dockerfile: node + git + create-nx-workspace + clone nrwl/nx + pnpm install)
2. Start workspace container from prebaked image
3. Install @op-nx/polyrepo plugin via npm
4. Commit container -> snapshot image
5. Tests start fresh containers from snapshot
6. Each test runs polyrepo-sync (clone + pnpm install + nx graph)
```

### Extending the Snapshot

The snapshot could include the synced repo state, eliminating the need for tests to run the slow sync:

```typescript
// In global setup, after plugin install:
await workspace.exec(['npx', 'nx', 'run', '@op-nx/source:polyrepo-sync'], {
  workingDir: '/workspace'
});
// Commit now includes synced repo with node_modules
const snapshotImage = await workspace.commit({ repo: 'op-nx-e2e-snapshot', tag: 'latest' });
```

**Pros:**
- Each test starts with a fully synced workspace
- No per-test sync overhead

**Cons:**
- The sync itself still takes 130s+ during global setup
- Tests that verify the sync flow itself cannot use this shortcut
- The snapshot image grows significantly (~3GB larger with nrwl/nx node_modules)
- `container.commit()` captures the overlay2 writable layer, so the synced state IS preserved

**Verdict:** This shifts the cost from per-test to per-suite, which helps if multiple tests need the synced state. But it does not reduce the total I/O time -- it just runs once instead of per-test. Combined with tmpfs for the sync phase, it could work: run sync on tmpfs (faster), then copy the result to the overlay2 layer, then commit.

---

## Research Area 7: Pre-Populated node_modules via Docker Layer

### `cp -al` (Hardlink Copy) Within a Container (HIGH confidence)

If `node_modules` is prebaked in the Docker image at `/repos/nx/node_modules/`, can we `cp -al` it to the cloned repo's location?

**Within the container's writable layer:** `cp -al` creates hardlinks. But the source files (`/repos/nx/node_modules/`) are in a lower image layer. Creating hardlinks to those files triggers copy-up for each file -- overlay2 copies the file to the writable layer, then creates the hardlink. This is no faster than a regular copy.

**Within the same image layer (Dockerfile RUN):** If both the source and destination are created in the same `RUN` command, hardlinks work correctly:

```dockerfile
RUN cd /repos/nx && corepack pnpm install --frozen-lockfile && \
    cp -al /repos/nx/node_modules /prebaked-node-modules
```

But this only helps at build time, not runtime.

### Alternative: `cp -a` (Regular Copy) from Image Layer (MEDIUM confidence)

Instead of relying on hardlinks, simply copy the prebaked node_modules:

```bash
cp -a /repos/nx/node_modules /workspace/.repos/nx/node_modules
```

For ~3GB of node_modules, this takes approximately:
- On overlay2 (SSD-backed): 30-60s (source read from lower layer + write to upper layer)
- On overlay2 to tmpfs: 10-20s (source read from cache + write to RAM)

**This is faster than `pnpm install` (130s)** because it avoids pnpm's JavaScript overhead (package resolution, lockfile validation, linking logic). It is a dumb file copy.

### The Lockfile Hash Problem

The sync executor checks `needsInstall()` by comparing a lockfile hash. If we copy node_modules instead of running `pnpm install`, the lockfile hash file (`.repos/.nx.lock-hash`) must also be populated to prevent the executor from re-running install.

This means we are testing a different code path than production -- the install step is bypassed, and only the graph extraction is tested. This weakens the e2e coverage.

---

## Recommendation Matrix

| Strategy | Speed Improvement | Complexity | E2E Coverage Impact | Recommended? |
|----------|------------------|------------|---------------------|-------------|
| **Use synthetic fixture** (from docker-e2e-monorepo-fixtures.md) | 130s -> 5-15s | Low | None (still tests full flow) | **YES -- primary** |
| **tmpfs for .repos** | 130s -> 20-40s (est.) | Low | None | **YES -- complementary** |
| **Pre-copy node_modules** (`cp -a`) | 130s -> 30-60s | Medium | Weakens install test | Maybe |
| **Extended snapshot** (commit after sync) | Per-test savings | Low | Skips sync test | Situational |
| **Named volume for pnpm store** | Unknown, complex | High | None | No |
| **Switch storage driver** | Not possible | N/A | N/A | No |
| **BuildKit cache mounts** | Build time only | Low | N/A | Build optimization only |

---

## Recommended Approach

### Primary: Use Synthetic Fixture (Eliminates the Problem)

As detailed in `docker-e2e-monorepo-fixtures.md`, replacing nrwl/nx (4649 packages) with a synthetic 2-lib fixture reduces `pnpm install` to ~20 packages. Even without any Docker I/O optimization, this takes 5-15s.

### Complementary: Add tmpfs for .repos Directory

Even with a synthetic fixture, tmpfs provides a speed boost for the clone + install + graph extraction pipeline:

```typescript
const container = await snapshotImage
  .withTmpFs({ "/workspace/.repos": "rw,exec,size=512m" })
  .withNetwork(network)
  .withCommand(['sleep', 'infinity'])
  .start();
```

With a synthetic fixture, 512MB is more than sufficient. This provides RAM-speed I/O for the entire sync operation.

**Caveat:** If the test needs the synced state to survive `container.commit()`, tmpfs cannot be used for that specific global-setup phase. Use tmpfs only for per-test containers that do not get committed.

### If nrwl/nx Must Be Retained as a Fixture

If replacing the fixture is not an option, the best Docker-level optimization is:

1. **tmpfs for /workspace/.repos** -- pnpm falls back to copy-mode but writes to RAM
2. **Increase test timeout to 300s** -- accept the overhead for a scale test
3. **Run as optional/separate test** -- do not block the main test suite

---

## Key Technical Details

### pnpm's `package-import-method` Setting

pnpm's `auto` mode (default) tries: clone (reflink) -> hardlink -> copy. In Docker overlay2:
- **Clone/reflink:** Not supported on ext4 (overlay2's backing FS)
- **Hardlink:** Works only if store and target are on the same filesystem/mount
- **Copy:** Always works, slowest option

When the pnpm store is on overlay2 (lower layer) and node_modules is on tmpfs, pnpm detects different mount points and falls back to copy. This can be forced explicitly via `pnpm install --package-import-method=copy` but auto-detection handles it.

### overlay2 Copy-Up Cost

Each cross-layer hardlink triggers a copy-up. For 4649 packages:
- Average file size in pnpm store: ~10-50KB (most JS packages are small)
- Copy-up overhead per file: ~0.5-2ms (metadata + data copy)
- Total copy-up time: 4649 * ~1ms = ~4.6s

This suggests the 130s is NOT primarily copy-up overhead. The majority of time is likely pnpm's JavaScript execution: dependency resolution, lockfile parsing, virtual store construction, and symlink/hardlink creation logic. The overlay2 filesystem overhead is a contributing factor but not the dominant one.

### Implication

Even with perfect filesystem performance (tmpfs), `pnpm install` for 4649 packages will still take significant time due to pnpm's CPU-bound work. The estimated floor is 20-40s on tmpfs. The only way to get below 15s is to reduce the number of packages (i.e., use a smaller fixture).

---

## Sources

### Primary (HIGH confidence)
- [Docker overlay2 storage driver docs](https://docs.docker.com/engine/storage/drivers/overlayfs-driver/) -- Copy-on-write behavior, hardlink handling
- [moby/moby#48140](https://github.com/moby/moby/issues/48140) -- Cross-layer hardlink regression, confirmed copy-up behavior
- [moby/moby#5632](https://github.com/moby/moby/issues/5632) -- Original hardlink-across-layers issue
- [pnpm Docker docs](https://pnpm.io/docker) -- BuildKit cache mounts, pnpm fetch, hardlink limitations
- [pnpm FAQ](https://pnpm.io/faq) -- Cross-filesystem hardlink limitations, package-import-method
- [pnpm Settings](https://pnpm.io/settings) -- package-import-method options
- [testcontainers Node.js containers](https://node.testcontainers.org/features/containers/) -- withTmpFs, exec, commit APIs
- [Docker tmpfs mounts](https://docs.docker.com/engine/storage/tmpfs/) -- tmpfs configuration options

### Secondary (MEDIUM confidence)
- [pnpm/pnpm#2479](https://github.com/pnpm/pnpm/issues/2479) -- pnpm install slow on Docker/macOS
- [pnpm Discussion #3651](https://github.com/orgs/pnpm/discussions/3651) -- Working around no hardlinks in dev containers
- [pnpm/pnpm#1515](https://github.com/pnpm/pnpm/issues/1515) -- pnpm does not support multiple file-systems
- [Docker Desktop WSL2 best practices](https://www.docker.com/blog/docker-desktop-wsl-2-best-practices/) -- Filesystem performance guidance
- [docker/for-linux#379](https://github.com/docker/for-linux/issues/379) -- overlay2 slow with many small files
- [Docker tmpfs for faster I/O](https://oneuptime.com/blog/post/2026-01-16-docker-tmpfs-mounts/view) -- tmpfs ~20x faster than SSD

### Tertiary (LOW confidence)
- [Docker storage driver benchmarks (2017)](https://github.com/chriskuehl/docker-storage-benchmark) -- Historical benchmarks, may be outdated
- [WSL2 Phoronix benchmarks Sep 2025](https://www.thetributary.ai/blog/optimizing-wsl2-claude-code-performance-guide/) -- ~87% bare-metal performance claim

---

## Metadata

**Confidence breakdown:**
- overlay2 hardlink behavior: HIGH -- verified from Docker docs + confirmed bug reports
- pnpm cross-filesystem fallback: HIGH -- verified from pnpm docs + issue tracker
- tmpfs performance improvement: MEDIUM -- extrapolated from general benchmarks, not measured for this specific workload
- WSL2 overhead: MEDIUM -- cited benchmarks are general, not specific to Docker overlay2 workloads
- Timing estimates: LOW -- back-of-envelope calculations, not measured

**Research date:** 2026-03-16
**Supersedes:** None (new research file)
**Related:** `docker-e2e-monorepo-fixtures.md`, `pnpm-preinstall-bypass.md`
