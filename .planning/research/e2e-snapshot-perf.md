# Research: Optimizing Docker Container Snapshot Commit for E2E Tests

**Researched:** 2026-03-19
**Domain:** Docker commit performance, testcontainers snapshot workflow, npm/pnpm cache restoration
**Overall Confidence:** HIGH

---

## Executive Summary

The e2e test suite's `container.commit()` step takes ~3m27s because Docker must diff the container's writable layer (upperdir) against the base image, then package the changes as a tar archive and create a new image layer. The key insight is that **`docker commit` captures ONLY the writable layer diff, not the entire container filesystem**. Files from the base image that were not modified at runtime (including `.repos/nx/` and its ~800MB node_modules from the Dockerfile's `COPY` layer) do NOT contribute to the commit time.

The ~3m27s is therefore spent diffing and archiving **only the runtime changes**: `/workspace/node_modules/` (~200MB from `npm install -D @op-nx/polyrepo`), `/workspace/nx.json`, `/workspace/package.json`, `/workspace/package-lock.json`, `/workspace/.nx/` (~50MB from graph cache warming), and `/workspace/.repos/.polyrepo-graph-cache.json`. The dominant item is `/workspace/node_modules/` at ~200MB, consisting of many thousands of small files -- which is precisely the worst case for overlay2's diff computation.

**Primary recommendation:** Delete `/workspace/node_modules/` before committing the snapshot. Each test's `beforeAll` restores it via `npm install --prefer-offline` from the warm `~/.npm/_cacache/` that persists in the snapshot. This should reduce commit time from ~3m27s to seconds, at the cost of ~15-30s per test file for npm cache restore.

---

## 1. How Docker Commit Works (HIGH confidence)

### The Commit Pipeline

When `container.commit()` is called (testcontainers wraps Dockerode's `container.commit()`, which calls Docker Engine API `/commit`):

1. **Container is paused** (default behavior, prevents data corruption)
2. **Diff computation:** Docker identifies all files in the container's writable layer (overlay2 upperdir) that differ from the base image layers (lowerdir). With overlay2, this is tracked at runtime -- Docker knows which files were created/modified/deleted in the upperdir.
3. **Tar archive creation:** The diff is packaged as a tar archive
4. **New layer creation:** The tar archive is extracted into a new image layer
5. **Image metadata update:** The new image references the base image's layers plus the new layer
6. **Container is unpaused**

### What Determines Commit Speed

**The committed layer size is NOT the full container filesystem.** It is ONLY the changes made at runtime (in the upperdir). Unchanged files from the base image layers remain in the lowerdir and are referenced by pointer, not copied.

Speed is determined by:

- **Number of changed files** in the upperdir (more files = longer diff walk)
- **Total size of changed files** (more data = longer tar creation and write)
- **NaiveDiffDriver fallback** (if overlay2 native diff is disabled by `CONFIG_OVERLAY_FS_REDIRECT_DIR`, Docker falls back to walking the entire filesystem tree -- can be 10x+ slower)
- **Disk I/O throughput** (WSL2's ext4-in-VHD adds virtualization overhead)

**Sources:**

- [Docker overlay2 storage driver docs](https://docs.docker.com/engine/storage/drivers/overlayfs-driver/)
- [Docker container commit docs](https://docs.docker.com/reference/cli/docker/container/commit/)
- [Portworx: Speed Up Docker Commit](https://portworx.com/blog/lcfs-speed-up-docker-commit/)
- [moby/moby#23457 - Slow docker commit](https://github.com/moby/moby/issues/23457)
- [Docker forum: commit slow on large images](https://forums.docker.com/t/docker-commit-is-quite-slow-on-large-images/45966)

### Real-World Benchmarks

| Scenario                                 | Commit Time   | Source                  |
| ---------------------------------------- | ------------- | ----------------------- |
| Small container (~few MB diff)           | < 1 second    | Portworx LCFS benchmark |
| 1GB file in busybox container            | 15-20 seconds | moby/moby#23457         |
| 50GB container                           | ~10 minutes   | Docker forum reports    |
| Our case (~200MB diff, many small files) | ~3m27s        | Measured                |

The 3m27s for our ~200MB diff is disproportionately slow, suggesting either the NaiveDiffDriver fallback is active, or the "many small files" pattern is the bottleneck (overlay2 must stat each file individually during diff computation).

---

## 2. Critical Insight: What Is Actually in Our Commit Diff (HIGH confidence)

### Container Filesystem Breakdown

| Path                                           | Source                                   | In Writable Layer?        | Size      |
| ---------------------------------------------- | ---------------------------------------- | ------------------------- | --------- |
| `/workspace/.repos/nx/`                        | Dockerfile `COPY --from=nx-prep`         | **NO** (base image layer) | ~800MB    |
| `/workspace/.repos/nx/node_modules/`           | Dockerfile `COPY --from=nx-prep`         | **NO** (base image layer) | ~700MB    |
| `/workspace/node_modules/`                     | Runtime `npm install -D @op-nx/polyrepo` | **YES**                   | ~200MB    |
| `/workspace/.nx/`                              | Runtime `npx nx show projects`           | **YES**                   | ~50MB     |
| `/workspace/.repos/.polyrepo-graph-cache.json` | Runtime graph cache warming              | **YES**                   | ~500KB    |
| `/workspace/nx.json`                           | Runtime `container.exec()` write         | **YES**                   | ~1KB      |
| `/workspace/package.json`                      | Modified by `npm install`                | **YES** (copy-on-write)   | ~1KB      |
| `/workspace/package-lock.json`                 | Created by `npm install`                 | **YES**                   | ~100KB    |
| `/workspace/.gitignore`                        | Dockerfile `RUN echo >> .gitignore`      | **NO** (base image layer) | ~1KB      |
| `~/.npm/_cacache/`                             | Populated by `npm install`               | **YES**                   | ~50-100MB |

**Key finding:** `.repos/nx/` and its ~800MB of node_modules are from the Dockerfile's COPY layer and are NOT in the writable layer. They do NOT affect commit speed at all. The commit diff is dominated by:

1. `/workspace/node_modules/` (~200MB, many thousands of files)
2. `~/.npm/_cacache/` (~50-100MB, many small files)
3. `/workspace/.nx/` (~50MB)

### Verification Approach

Before implementing, verify with `docker diff <container_id>` to see exactly what files are in the writable layer. This will confirm the analysis above.

---

## 3. The Optimization: Delete node_modules Before Commit (HIGH confidence)

### Strategy

Before calling `container.commit()`, run `rm -rf /workspace/node_modules/` inside the container. This removes the ~200MB of many small files from the writable layer. The `~/.npm/_cacache/` stays (it is needed to restore node_modules in each test).

After this change, the commit diff shrinks to:

- `~/.npm/_cacache/` (~50-100MB, but content-addressable = fewer files than node_modules)
- `/workspace/.nx/` (~50MB)
- `/workspace/.repos/.polyrepo-graph-cache.json` (~500KB)
- Config files (negligible)
- **Whiteout entries** for the deleted node_modules

### Whiteout Files and COW Semantics (HIGH confidence)

**Critical question:** Does deleting `/workspace/node_modules/` create whiteout files that add to the diff?

**Answer: NO** -- because `/workspace/node_modules/` was created at RUNTIME (by `npm install` in global-setup), not in the base image. Whiteout files are only created when deleting files from a LOWER (read-only) layer. Since node_modules exists only in the UPPER (writable) layer, deleting it simply removes those files from the upperdir. No whiteouts are created.

This is the key: deleting runtime-created files GENUINELY reduces the writable layer size. Deleting files from base image layers would create whiteouts (not helpful). But node_modules was created at runtime, so deleting it is a pure win.

### Expected Impact

| Metric              | Before     | After        | Change  |
| ------------------- | ---------- | ------------ | ------- |
| Writable layer size | ~300-350MB | ~100-150MB   | -60%    |
| File count in diff  | ~10,000+   | ~2,000-3,000 | -70-80% |
| Commit time (est.)  | ~3m27s     | ~30-60s      | -70-85% |

The file count reduction is the most impactful factor, as overlay2 diff speed is dominated by per-file operations (stat, read, archive).

### Implementation Sketch

```typescript
// Phase 5.5: Shrink writable layer before commit
await timed('node_modules deleted for snapshot', () =>
  ctr.exec(['rm', '-rf', '/workspace/node_modules'], {
    workingDir: '/workspace',
  }),
);

// Phase 6: Commit snapshot image (now much faster)
const snapshotImage = await timed('Snapshot committed', () =>
  ctr.commit({
    repo: 'op-nx-e2e-snapshot',
    tag: 'latest',
    deleteOnExit: true,
  }),
);
```

### Trade-off: Per-Test Restore Cost

Each test file's `beforeAll` must now restore node_modules:

```typescript
export async function startContainer(
  snapshotImage: string,
  name: string,
): Promise<StartedTestContainer> {
  const ctr = await new GenericContainer(snapshotImage)
    .withName(`op-nx-polyrepo-e2e-${name}`)
    .withCommand(['sleep', 'infinity'])
    .start();

  // Restore node_modules from warm npm cache
  await ctr.exec(['npm', 'install', '--prefer-offline'], {
    workingDir: '/workspace',
  });

  return ctr;
}
```

---

## 4. npm Cache Restore Speed (MEDIUM confidence)

### How npm Offline Install Works

npm stores compressed tarballs in `~/.npm/_cacache/` (content-addressable by SHA-512). When `npm install --prefer-offline` is run:

1. npm reads `package-lock.json` (skips resolution -- all versions known)
2. For each package: checks `_cacache` for the tarball by content hash
3. If found (cache hit): extracts tarball directly to `node_modules/`
4. If not found: falls back to network (won't happen since cache is warm)

### Expected Restore Time

For a workspace with ~20-30 direct dependencies (typical create-nx-workspace + our plugin):

| Factor                  | Impact                                     |
| ----------------------- | ------------------------------------------ |
| Lock file present       | Skips dependency resolution (~2-5s saving) |
| Warm cache              | No network requests (~5-15s saving)        |
| `--prefer-offline`      | Skips staleness checks                     |
| Overlay2 write overhead | Writing to upperdir = file-level I/O       |
| Total estimated time    | **15-30 seconds**                          |

### Key Flags

- `--prefer-offline`: Use cache, fall back to network if missing. **Recommended** -- safe fallback.
- `--offline`: Fail if not in cache. Faster but fragile.
- `--ignore-scripts`: Skip postinstall scripts. Useful if no native modules need building.
- `--no-audit`: Skip vulnerability check. Saves a few seconds.

**Recommended command:**

```bash
npm install --prefer-offline --no-audit
```

### Benchmarks from External Sources

- "Moving from clean to warm cache gives a 10x increase in speed" (tiernok.com CI benchmarks)
- "By strategically caching the npm cache directory... you can reduce dependency install times from minutes to seconds" (codegenes.net)
- No specific benchmark found for "20-30 deps from warm cache" but consensus is sub-30 seconds

**Sources:**

- [Speeding up npm install in CI](https://www.tiernok.com/posts/2019/faster-npm-installs-during-ci/)
- [npm cli install docs](https://docs.npmjs.com/cli/v10/commands/npm-install)
- [npm cache docs](https://docs.npmjs.com/cli/v10/commands/npm-cache)

---

## 5. The .repos/nx/node_modules Problem: pnpm Store Strategy (MEDIUM confidence)

### Current Situation

The `.repos/nx/node_modules/` (~700MB) comes from the Dockerfile COPY layer and is NOT in the writable layer. It does NOT affect commit speed. However, if we WERE to delete it (to make the snapshot even smaller for faster container starts), restoring it is much harder than npm because:

1. The Dockerfile uses `--mount=type=cache,target=/root/.local/share/pnpm/store` for the pnpm install
2. This means the pnpm store is NOT in the image -- it only exists on the Docker host as a BuildKit cache
3. At runtime, `pnpm install --offline` would fail because there is no store to restore from

### Option A: Keep .repos/nx/node_modules in Base Image (RECOMMENDED)

Since it does not affect commit speed, leave it as-is. This is the simplest approach.

### Option B: Bake pnpm Store Into Image

Replace the BuildKit cache mount with a regular RUN:

```dockerfile
# Instead of:
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    cd /synced-nx && corepack pnpm install --frozen-lockfile

# Use:
RUN cd /synced-nx && corepack enable && \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm install --frozen-lockfile
```

This bakes the pnpm store into the image layer. Then at runtime:

1. Delete `/workspace/.repos/nx/node_modules/` before commit
2. Each test restores with `pnpm install --offline --frozen-lockfile`

**Trade-offs:**

- Image size increase: The pnpm store is content-addressable, so it shares content with node_modules. Net size increase is modest (~100-300MB for the store metadata).
- Build speed regression: Without the BuildKit cache mount, `docker build` re-downloads packages on every rebuild when the NX_VERSION changes.
- Complexity: Two package managers to restore in each test (npm + pnpm).

**Verdict:** Not worth it since .repos/nx/node_modules does not affect commit speed.

### Option C: pnpm Store Prune

If Option B is chosen, minimize store size:

```dockerfile
RUN cd /synced-nx && corepack pnpm install --frozen-lockfile && \
    corepack pnpm store prune
```

`pnpm store prune` removes unreferenced packages from the store. After a fresh install, all packages should be referenced, so this has minimal effect. It is more useful for cleaning up after package upgrades.

### Option D: pnpm deploy

`pnpm deploy` creates a self-contained output directory with its own node_modules (hardlinked from the store). This is designed for production deployments, not for workspace restoration. Not applicable here since we need the full workspace structure, not a deployed package.

---

## 6. Alternative Snapshot Strategies (Ranked)

### Strategy 1: Delete /workspace/node_modules Before Commit (RECOMMENDED)

**Complexity:** Very Low
**Expected speedup:** Commit ~3m27s --> ~30-60s; per-test restore +15-30s
**Net effect on total suite time:** With 3 parallel test files, the per-test restore cost is paid once per file (in beforeAll). Total suite time improvement: ~3m27s saved on commit, 15-30s added per test file = ~2m30s net savings.

```typescript
// Before commit
await ctr.exec(['rm', '-rf', '/workspace/node_modules'], {
  workingDir: '/workspace',
});
// Commit is now fast
const snapshotImage = await ctr.commit({
  repo: 'op-nx-e2e-snapshot',
  tag: 'latest',
  deleteOnExit: true,
});

// In each test's startContainer:
await ctr.exec(['npm', 'install', '--prefer-offline', '--no-audit'], {
  workingDir: '/workspace',
});
```

### Strategy 2: docker export | docker import Instead of docker commit

**Complexity:** Medium (requires custom testcontainers wrapper)
**Expected speedup:** Flattens all layers into one. Eliminates diff computation but must stream the ENTIRE filesystem (~1.5GB+) as a tar. May be slower for large containers, faster for many-layer containers.
**Risk:** Loses CMD, ENV, WORKDIR metadata (must re-specify with --change). Testcontainers `commit()` does not support this; would need raw Docker API calls.

```typescript
// Pseudocode -- NOT directly supported by testcontainers
const containerId = ctr.getId();
execSync(
  `docker export ${containerId} | docker import - op-nx-e2e-snapshot:latest`,
);
```

**Verdict:** Not recommended. The diff-only approach (Strategy 1) reduces the data that needs to be processed. Export streams the entire filesystem regardless.

### Strategy 3: Skip Snapshot Entirely

**Complexity:** Low
**Expected speedup:** Eliminates commit entirely. Each test starts from the base image and runs the full setup.
**Problem:** Each test file would need to: install plugin from Verdaccio, write nx.json, warm graph cache. This duplicates the global setup work 3x (once per test file) and requires Verdaccio to stay running.
**Verdict:** Worse total time unless setup is very fast. Not recommended.

### Strategy 4: Bind Mount Pre-Built node_modules from Host

**Complexity:** High (non-portable, host-dependent)
**Expected speedup:** Eliminates both commit overhead and restore overhead.
**Problem:** Bind mounts are platform-dependent, require host setup, and break portability. The node_modules would need to be compatible with the container's architecture.
**Verdict:** Not recommended for CI. Possible local development optimization.

### Strategy 5: Docker Volume for node_modules

**Complexity:** Medium
**Expected speedup:** Volumes bypass overlay2, so read/write is faster. But volumes are NOT captured by `docker commit`.
**Problem:** Cannot use with the snapshot pattern. Each test would need the volume mounted, and volumes cannot be duplicated efficiently for parallel tests.
**Verdict:** Incompatible with the current snapshot-per-test pattern.

### Strategy 6: Also Delete ~/.npm/\_cacache Before Commit

**Complexity:** Very Low (additive to Strategy 1)
**Risk:** Each test would need to download packages from Verdaccio again (no warm cache).
**Verdict:** Only viable if Verdaccio stays running and accessible to test containers. The current architecture stops Verdaccio before tests run (it is only used during global setup). Would require keeping Verdaccio alive.

---

## 7. Testcontainers-Specific Optimizations (HIGH confidence)

### Container Commit API

The testcontainers `commit()` method passes through to Dockerode's `container.commit()`:

```typescript
// testcontainers source (docker-container-client.js)
async commit(container, opts) {
  const { Id: imageId } = await container.commit(opts);
  return imageId;
}
```

Options: `repo`, `tag`, `changes` (Dockerfile-style commands), `deleteOnExit`.
There are NO options to exclude paths or control the diff scope. The Docker Engine API `/commit` does not support path exclusion.

### Exec Before Commit

Yes, you can run `exec()` to modify the container filesystem before committing. This is the recommended approach for deleting node_modules:

```typescript
await ctr.exec(['rm', '-rf', '/workspace/node_modules']);
const snapshotImage = await ctr.commit({ repo: '...', tag: '...' });
```

The `rm -rf` will remove the files from the upperdir (since they were created at runtime), reducing the commit diff.

### withCopyContentToContainer / withCopyFilesToContainer

These methods use `putArchive` (tar stream) to inject files into a running container. They could be used to inject pre-built tarballs into test containers instead of running `npm install`, but this adds complexity without clear benefit over `npm install --prefer-offline`.

### Container Reuse

`withReuse()` allows reusing containers across test runs. This is NOT applicable here because each test file needs an isolated container (tests modify nx.json and state).

---

## 8. NaiveDiffDriver Investigation (MEDIUM confidence)

### What It Is

When overlay2's native diff support is incompatible with `CONFIG_OVERLAY_FS_REDIRECT_DIR` (enabled in many modern kernels), Docker falls back to `NaiveDiffDriver`. This driver walks the entire filesystem tree to compute diffs instead of relying on overlay2's native tracking.

### Warning Signs

Docker logs a warning when falling back:

```
Not using native diff for overlay2, this may cause degraded performance for building images
```

Check with `docker info | grep "Native Overlay Diff"`. If it shows `false`, the NaiveDiffDriver is active and is likely the primary cause of the 3m27s commit time.

### Workaround

Inside the WSL2 VM:

```bash
echo 'options overlay redirect_dir=off' > /etc/modprobe.d/disable_overlay_redirect_dir.conf
```

This requires access to the Docker Desktop WSL2 VM's kernel module configuration, which is non-trivial and may be reset by Docker Desktop updates.

**Verdict:** Worth checking but not actionable without Docker Desktop cooperation. Strategy 1 (delete node_modules) is a better fix.

---

## 9. Recommended Implementation Plan

### Phase 1: Verify the Analysis (Quick)

Before changing any code:

1. Run the e2e global setup
2. Before the commit step, run `docker diff <container_id>` to see exactly what files are in the writable layer
3. Confirm that `.repos/nx/node_modules/` is NOT in the diff
4. Confirm that `/workspace/node_modules/` IS in the diff

### Phase 2: Implement the Optimization

1. Add `rm -rf /workspace/node_modules` exec before commit in `global-setup.ts`
2. Modify `startContainer()` in `container.ts` to run `npm install --prefer-offline --no-audit` after starting
3. Run full e2e suite to verify tests still pass

### Phase 3: Measure and Iterate

1. Compare commit time before/after
2. Measure per-test restore overhead
3. If commit is still slow, investigate NaiveDiffDriver (check `docker info`)
4. If per-test restore is too slow, consider also deleting `.nx/` cache or keeping node_modules but removing `node_modules/.cache`

### Implementation Code

**global-setup.ts changes:**

```typescript
// Between Phase 5 (graph cache warming) and Phase 6 (commit):

// Phase 5.5: Shrink writable layer for fast snapshot commit.
// Delete node_modules (created at runtime, so no whiteout files).
// The npm cache (~/.npm/_cacache/) stays -- tests restore from it.
await timed('Snapshot prep (rm node_modules)', () =>
  ctr.exec(['rm', '-rf', '/workspace/node_modules'], {
    workingDir: '/workspace',
  }),
);
```

**container.ts changes:**

```typescript
export async function startContainer(
  snapshotImage: string,
  name: string,
): Promise<StartedTestContainer> {
  const ctr = await new GenericContainer(snapshotImage)
    .withName(`op-nx-polyrepo-e2e-${name}`)
    .withCommand(['sleep', 'infinity'])
    .start();

  // Restore node_modules from warm npm cache (no network needed).
  // The snapshot includes ~/.npm/_cacache/ with all tarballs.
  const installResult = await ctr.exec(
    ['npm', 'install', '--prefer-offline', '--no-audit'],
    { workingDir: '/workspace' },
  );

  if (installResult.exitCode !== 0) {
    throw new Error(
      `npm install restore failed (exit ${String(installResult.exitCode)}):\n${installResult.output}`,
    );
  }

  return ctr;
}
```

---

## 10. Additional Considerations

### What About Also Deleting ~/.npm/\_cacache?

If the npm cache is also deleted, the commit diff shrinks further. But test containers would have no way to restore node_modules without network access. Since Verdaccio is stopped before tests run, this is only viable if Verdaccio stays alive through the test suite, adding complexity. **Not recommended for the first iteration.**

### What About Also Deleting /workspace/.nx/?

The `.nx/` cache (~50MB) is in the writable layer. Deleting it before commit would shrink the diff further but each test's first `nx` command would take longer (cold Nx workspace cache). The trade-off depends on how many `nx` commands each test runs. For now, keep `.nx/` in the snapshot.

### Container Start Time

Smaller snapshot images start faster because Docker has less data to apply to the overlay2 stack. Reducing the committed layer from ~300MB to ~100MB should also improve container start times by 1-2 seconds.

### Parallel Test Impact

With 3 test files running in parallel, the per-test `npm install` runs concurrently. The WSL2 VM's I/O bandwidth is shared across all three containers, so the total wall-clock time for parallel restores may be longer than a single restore. With ~50MB of cached tarballs being extracted, this should still complete in under 30 seconds even with contention.

---

## Sources

### Primary (HIGH confidence)

- [Docker overlay2 storage driver docs](https://docs.docker.com/engine/storage/drivers/overlayfs-driver/) -- CoW behavior, upperdir/lowerdir, whiteout files
- [Docker container commit docs](https://docs.docker.com/reference/cli/docker/container/commit/) -- Pause behavior, commit semantics
- [Docker image layers docs](https://docs.docker.com/get-started/docker-concepts/building-images/understanding-image-layers/) -- Layer composition
- [testcontainers-node source code](https://github.com/testcontainers/testcontainers-node) -- `commit()` implementation verified in local `node_modules/`
- [pnpm install docs](https://pnpm.io/cli/install) -- `--offline`, `--frozen-lockfile` flags
- [pnpm Docker docs](https://pnpm.io/docker) -- `pnpm fetch`, BuildKit cache mounts

### Secondary (MEDIUM confidence)

- [Portworx: LCFS Speed Up Docker Commit](https://portworx.com/blog/lcfs-speed-up-docker-commit/) -- Diff computation internals, performance benchmarks
- [moby/moby#23457](https://github.com/moby/moby/issues/23457) -- Slow docker commit reports
- [Docker forum: commit slow on large images](https://forums.docker.com/t/docker-commit-is-quite-slow-on-large-images/45966) -- Real-world commit times
- [Speeding up npm install in CI](https://www.tiernok.com/posts/2019/faster-npm-installs-during-ci/) -- Warm cache benchmarks
- [Docker export vs import](https://tuhrig.de/difference-between-save-and-export-in-docker/) -- Flattening semantics
- [Docker forum: NaiveDiffDriver](https://jarekprzygodzki.dev/post/a-curious-case-of-slow-docker-image-builds/) -- CONFIG_OVERLAY_FS_REDIRECT_DIR fallback

### Tertiary (LOW confidence)

- npm cache restore timing estimates -- extrapolated from CI benchmark reports, not directly measured for this project's dependency count
- NaiveDiffDriver diagnosis -- cannot confirm without running `docker info` (Docker Desktop not currently running)

---

## Metadata

**Confidence breakdown:**

- Docker commit mechanics: HIGH -- verified from Docker official docs + source code inspection
- Writable layer analysis: HIGH -- based on Dockerfile review + overlay2 semantics
- Whiteout behavior for runtime files: HIGH -- overlay2 spec: deleting upperdir files removes them, no whiteout
- npm cache restore speed: MEDIUM -- extrapolated from external benchmarks, not measured locally
- NaiveDiffDriver impact: MEDIUM -- plausible root cause but cannot confirm without running Docker
- pnpm store strategies: MEDIUM -- verified from pnpm docs but trade-off analysis is estimated

**Research date:** 2026-03-19
**Valid until:** 2026-04-19 (stable domain -- Docker overlay2 and npm cache behavior change slowly)
**Related:** `docker-io-optimization.md`, `docker-e2e-monorepo-fixtures.md`, `pnpm-preinstall-bypass.md`
