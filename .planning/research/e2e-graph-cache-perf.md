# Research: Why Is Plugin Graph Cache Warming Slow in E2E Container?

**Researched:** 2026-03-19
**Domain:** Nx plugin graph extraction, Docker caching, JVM cold start, Nx internal cache invalidation
**Overall Confidence:** HIGH

---

## Executive Summary

The ~4m42s delay in Phase 5 ("Graph cache warmed") of `global-setup.ts` is spent almost entirely inside the child `nx graph --print` process running inside `/workspace/.repos/nx/`. This child process must build the nrwl/nx monorepo's full project graph from scratch, which involves loading 18 Nx plugins -- including `@nx/gradle`, which spawns a cold JVM to run the `nxProjectGraph` Gradle task.

**The pre-warmed Nx cache from the Dockerfile does NOT skip plugin execution.** Nx's `.nx/workspace-data/` cache stores file maps and content hashes, but `buildProjectGraphAndSourceMapsWithoutDaemon()` (the code path used when `NX_DAEMON=false`) ALWAYS runs all plugins' `createNodesV2` functions regardless of cache state. The file-map cache only avoids re-hashing source files (~10-30s saved), not re-running plugins (~3-4 minutes for Gradle alone).

The polyrepo plugin's own disk cache (`.repos/.polyrepo-graph-cache.json`) does not exist at Phase 5 runtime because it is only written AFTER the first successful `populateGraphReport` call. Phase 5 is the very first invocation -- it IS the cache warming step.

**Primary recommendation:** Capture the raw `nx graph --print` JSON output during Docker build and serve it from a file, bypassing the child Nx process entirely at plugin graph extraction time. This eliminates the JVM cold start, plugin loading, and file scanning completely.

---

## 1. Root Cause Analysis (HIGH confidence)

### The Extraction Pipeline Timeline

When Phase 5 runs `npx nx show projects` inside the container:

```
Host Nx process
  -> loads @op-nx/polyrepo plugin
  -> createNodesV2 calls populateGraphReport()
  -> computeOuterHash() [fast, ~1-2s]
  -> disk cache miss (no .polyrepo-graph-cache.json exists yet)
  -> extractGraphFromRepo('/workspace/.repos/nx/')
     -> spawns child: nx graph --print (with NX_DAEMON=false)
     -> child Nx process inside .repos/nx/:
        1. Bootstraps Nx CLI                          [~3-5s]
        2. Loads 18 plugins from nx.json              [~5-15s]
        3. @nx/gradle spawns JVM, runs Gradle task    [~1-3 MINUTES]
        4. Other plugins run createNodes              [~10-30s]
        5. File scanning and hashing                  [~10-30s]
        6. Graph construction + JSON serialization    [~5-10s]
     -> stdout JSON parsed, Zod-validated
  -> transformGraphForRepo() [fast, ~1-2s]
  -> writes .polyrepo-graph-cache.json to disk
```

**The dominant sub-step is #3: `@nx/gradle` JVM cold start.** The Gradle plugin runs `nxProjectGraph` as a Gradle task, which requires:
- JVM startup (~10-20s cold)
- Gradle daemon initialization (~30-60s cold, no daemon running)
- Gradle project evaluation and task execution (~30-60s for nrwl/nx's Gradle setup)

### Why the Dockerfile Pre-Warm Does Not Help

The Dockerfile Stage 1 runs `nx graph --print` in `/synced-nx`:

```dockerfile
RUN cd /synced-nx && npx nx graph --print > /dev/null 2>&1 || true
```

This warms:
1. **`.nx/workspace-data/`** -- file-map cache, project-graph cache, source maps
2. **Gradle daemon** -- a running JVM process with warm JIT caches
3. **Native file cache** -- Nx's Rust `.node` binaries cached in `/tmp/nx-native-file-cache-<hash>`

But after `COPY --link --from=nx-prep /synced-nx /workspace/.repos/nx`:

| What Was Warmed | Survives COPY? | Why? |
|-----------------|---------------|------|
| `.nx/workspace-data/` | YES (files preserved) | Docker COPY preserves file content |
| Gradle daemon process | **NO** | Processes don't survive between Docker layers |
| JVM JIT compilation cache | **NO** | In-process memory, not on disk |
| Native file cache in `/tmp/` | **NO** | `/tmp/` is not part of the COPY source |
| pnpm store (BuildKit cache mount) | **NO** | BuildKit cache mounts are host-side only |

Even though `.nx/workspace-data/` survives, Nx's `buildProjectGraphAndSourceMapsWithoutDaemon()` still calls ALL plugins:

```javascript
// node_modules/nx/src/project-graph/project-graph.js line 81-100
async function buildProjectGraphAndSourceMapsWithoutDaemon() {
    const plugins = await getPlugins();  // Always loads all plugins
    configurationResult = await retrieveProjectConfigurations(plugins, ...);  // Always runs createNodes
    // ...
}
```

The file-map cache only helps in `buildProjectGraphUsingProjectFileMap()` (step 5 above), which skips re-hashing files whose content hasn't changed. But this saves only ~10-30s out of 4m42s.

### Source Code Evidence

From `node_modules/nx/src/project-graph/utils/retrieve-workspace-files.js`:

```javascript
async function retrieveProjectConfigurations(plugins, workspaceRoot, nxJson) {
    const pluginsWithCreateNodes = plugins.filter((p) => !!p.createNodes);
    const globPatterns = getGlobPatternsOfPlugins(pluginsWithCreateNodes);
    const pluginConfigFiles = await multiGlobWithWorkspaceContext(workspaceRoot, globPatterns);
    return createProjectConfigurationsWithPlugins(workspaceRoot, nxJson, pluginConfigFiles, pluginsWithCreateNodes);
}
```

There is no "skip plugins if cache is valid" path. Plugins ALWAYS execute.

---

## 2. The nrwl/nx Plugin Landscape (HIGH confidence)

The nrwl/nx monorepo at v22.5.4 has 18 plugin entries in `nx.json`:

| Plugin | Estimated Cold createNodes Time | Why Slow |
|--------|-------------------------------|----------|
| `@nx/gradle` | **1-3 minutes** | JVM startup + Gradle daemon init + project evaluation |
| `@nx/storybook/plugin` | 10-30s | Walks many Storybook configs ([GitHub #31276](https://github.com/nrwl/nx/issues/31276), [#32737](https://github.com/nrwl/nx/issues/32737)) |
| `@nx/js/typescript` (x2) | 5-15s each | TypeScript config resolution across 149 projects |
| `@nx/vite/plugin` (x2) | 3-10s each | Vite config detection |
| `@nx/eslint/plugin` | 5-10s | ESLint config scanning |
| `@nx/jest/plugin` (x3) | 3-5s each | Jest config detection |
| `@nx/playwright/plugin` | 2-5s | Playwright config scanning |
| `@nx/webpack/plugin` | 2-5s | Webpack config scanning |
| `@nx/next/plugin` | 2-5s | Next.js config detection |
| `@nx/rspack/plugin` | 2-5s | Rspack config scanning |
| `@nx/vitest` (x2) | 2-5s each | Vitest config detection |
| `@monodon/rust` | 1-3s | Rust/Cargo.toml scanning |
| `@nx/enterprise-cloud` | 1-2s | Cloud config |

**Total estimated cold plugin time: ~2.5-5 minutes**, dominated by `@nx/gradle` at ~1-3 minutes.

Sources:
- [nrwl/nx #32872: @nx/gradle plugin fails without Java](https://github.com/nrwl/nx/issues/32872)
- [nrwl/nx #31835: @nx/gradle extremely slow](https://github.com/nrwl/nx/issues/31835)
- [nrwl/nx #31276: @nx/storybook slow](https://github.com/nrwl/nx/issues/31276)
- [nrwl/nx #29386: Slow task execution due to project graph creation](https://github.com/nrwl/nx/issues/29386)

---

## 3. Why the Disk Cache Miss Is Guaranteed (HIGH confidence)

The polyrepo plugin's disk cache at `.repos/.polyrepo-graph-cache.json` cannot exist at Phase 5 runtime:

1. **Dockerfile Stage 1** runs `nx graph --print` inside `/synced-nx`, but the polyrepo plugin is NOT installed in `/synced-nx`. The polyrepo plugin is a HOST workspace plugin, not a child repo plugin. So no `.polyrepo-graph-cache.json` is written during Docker build.

2. **Dockerfile Stage 2** runs `nx show projects` in `/workspace`, but without the polyrepo plugin installed (it gets installed in Phase 4 of `global-setup.ts`). This only warms the HOST workspace's `.nx/workspace-data/`.

3. **Phase 5** is the FIRST time the polyrepo plugin runs `populateGraphReport`. The disk cache does not exist yet. This is a **guaranteed cold-start extraction**.

### Hash Stability Analysis

Even if we could pre-compute the cache file, the hash would need to match at runtime:

```typescript
// cache.ts computeOuterHash:
hashArray([optionsHash, alias, headSha, dirtyFiles])
```

| Component | Dockerfile Value | Runtime Value | Match? |
|-----------|-----------------|---------------|--------|
| `optionsHash` | N/A (plugin not installed) | `hashObject({nx: {url:'file:///repos/nx', depth:1, ref:'22.5.4'}})` | N/A |
| `alias` | N/A | `'nx'` | N/A |
| `headSha` | SHA of nrwl/nx@22.5.4 | Same SHA (COPY preserves .git) | YES |
| `dirtyFiles` | `''` (clean clone) | `''` (COPY preserves content, git sees no diff) | YES |

If we pre-computed the cache file with the correct `optionsHash`, the hash would match at runtime. This is a viable optimization path.

---

## 4. Optimization Options (Ranked by ROI)

### Option 1: Cache Raw nx graph --print JSON in Dockerfile (HIGH ROI)

**Approach:** During Docker build, capture the `nx graph --print` JSON output to a file. At runtime, have `extractGraphFromRepo` read the file instead of spawning a child process.

**Implementation:**

Dockerfile change (Stage 1):
```dockerfile
# Capture graph JSON to a file instead of discarding it
RUN cd /synced-nx && npx nx graph --print > /synced-nx/.nx-graph-output.json 2>/dev/null || true
```

This file gets COPY'd to `/workspace/.repos/nx/.nx-graph-output.json`.

Plugin change (extract.ts): Add a "cached JSON file" fast path:
```typescript
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const CACHED_GRAPH_FILENAME = '.nx-graph-output.json';

export function extractGraphFromRepo(repoPath: string): Promise<ExternalGraphJson> {
  // Fast path: pre-computed graph JSON from Docker build
  const cachedPath = join(repoPath, CACHED_GRAPH_FILENAME);

  if (existsSync(cachedPath)) {
    const raw = readFileSync(cachedPath, 'utf-8');
    const jsonStart = raw.indexOf('{');

    if (jsonStart >= 0) {
      const result = externalGraphJsonSchema.safeParse(JSON.parse(raw.substring(jsonStart)));

      if (result.success) {
        return Promise.resolve(result.data);
      }
    }
  }

  // Fallback: live extraction (existing code)
  // ...
}
```

**Pros:**
- Eliminates the entire child process (~4m42s -> ~1-2s for file read + JSON parse)
- No JVM startup, no plugin loading, no file scanning
- Works for any child repo, not just nrwl/nx
- Minimal code change (add fast path to existing function)

**Cons:**
- Couples Docker build to plugin internals (must know to save the JSON)
- The cached JSON could become stale if .repos/nx/ content changes at runtime (e.g., polyrepo-sync modifies files)
- Adds a convention that Docker builders must follow

**Complexity:** Low
**Expected speedup:** ~4m40s (eliminates 99%+ of Phase 5 time)
**Risk:** Low -- fallback to live extraction if file is missing or invalid

---

### Option 2: Pre-Compute polyrepo-graph-cache.json in Dockerfile (MEDIUM ROI)

**Approach:** Generate `.repos/.polyrepo-graph-cache.json` with the correct hash during Docker build, so the plugin's disk cache is a hit at runtime.

**Challenge:** The cache hash includes `optionsHash` which depends on the nx.json content written in Phase 3 of global-setup.ts. During Docker build, we don't know the exact nx.json content (it's generated at runtime). However, since the nx.json content is deterministic (same nxVersion constant), we COULD:

1. Write the nx.json during Docker build
2. Install the plugin during Docker build
3. Run `nx show projects` during Docker build (with the plugin)

This essentially moves Phases 3-5 of global-setup.ts into the Dockerfile.

**Pros:**
- No plugin code changes needed
- Clean architectural boundary (all warming happens in Docker)

**Cons:**
- Requires installing the plugin during Docker build (needs Verdaccio or local tarball)
- Makes the Docker build SLOWER (adds the 4m42s to Docker build time)
- Only moves the cost, doesn't eliminate it
- Docker build cache would need to be invalidated when plugin code changes

**Complexity:** High
**Expected speedup:** ~4m42s runtime savings, but adds ~4m42s to Docker build time
**Net effect:** Zero improvement unless Docker build cache hits consistently

---

### Option 3: Pass NX_FORCE_REUSE_CACHED_GRAPH to Child Process (LOW ROI - WON'T WORK)

**Why it won't work:** `NX_FORCE_REUSE_CACHED_GRAPH` is only checked in `createProjectGraphAsync()`, but `nx graph --print` calls `createProjectGraphAndSourceMapsAsync()` which does NOT check this env var. Even if it did, it would skip plugin execution entirely and return a stale graph from `.nx/workspace-data/project-graph.json` -- which may not include the latest source maps.

---

### Option 4: Strip @nx/gradle from Child Repo's nx.json (MEDIUM ROI)

**Approach:** During Docker build, remove or disable the `@nx/gradle` plugin from the nrwl/nx repo's nx.json. Since we only need project metadata (names, roots, targets, dependencies), we don't actually need the Gradle-discovered projects to be correct -- we just need the JS/TS projects.

**Implementation:**

Dockerfile change:
```dockerfile
# Remove @nx/gradle from the child repo's nx.json to avoid JVM startup
RUN cd /synced-nx && node -e "
  const nx = JSON.parse(require('fs').readFileSync('nx.json', 'utf-8'));
  nx.plugins = (nx.plugins || []).filter(p => {
    const name = typeof p === 'string' ? p : p.plugin;
    return !name.includes('gradle') && !name.includes('storybook');
  });
  require('fs').writeFileSync('nx.json', JSON.stringify(nx, null, 2));
"
```

**Pros:**
- No plugin code changes needed
- Eliminates ~2-4 minutes of JVM + Storybook overhead
- Simple Docker-side change

**Cons:**
- Loses Gradle-discovered projects from the graph (may or may not matter for e2e tests)
- Fragile -- depends on plugin naming conventions
- The pre-warmed `.nx/workspace-data/` cache from Stage 1 would be invalidated (different plugins = `shouldRecomputeWholeGraph` returns true because `nxJsonPlugins` hash changes)

**Complexity:** Low-Medium
**Expected speedup:** ~2-4 minutes (eliminates Gradle + Storybook plugin overhead)
**Risk:** Medium -- may break if tests rely on Gradle-discovered projects

---

### Option 5: Add Timing Instrumentation to extractGraphFromRepo (QUICK WIN)

**Approach:** Before committing to a specific optimization, add timing logs to pinpoint the exact bottleneck.

**Implementation:**

```typescript
export function extractGraphFromRepo(repoPath: string): Promise<ExternalGraphJson> {
  const startTime = Date.now();
  // ... existing code ...
  // In the callback:
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[polyrepo] extractGraphFromRepo ${repoPath} completed in ${elapsed}s`);
}
```

Also, pass `NX_PERF_LOGGING=true` to the child process env to get Nx's built-in performance marks:

```typescript
env: {
  ...process.env,
  NX_DAEMON: 'false',
  NX_VERBOSE_LOGGING: 'false',
  NX_PERF_LOGGING: 'true',  // <-- add this
},
```

Note: `NX_PERF_LOGGING` writes to stderr, not stdout, so it won't contaminate the JSON output on stdout. This gives granular timing for each plugin's createNodes call.

**Pros:** Zero risk, confirms the hypothesis before investing in a fix
**Cons:** Doesn't fix anything, just diagnoses

**Complexity:** Very Low
**Expected value:** Confirms which sub-step dominates, validates optimization choice

---

### Option 6: Alternative to nx graph --print (LOW ROI -- LIMITED)

**Approach:** Use a lighter-weight command to get project metadata without full graph construction.

Candidates:
- `nx show projects --json` -- returns project list but NOT full graph (no dependencies, no targets)
- `nx print-affected` -- different purpose (affected analysis)
- Reading `project.json` / `package.json` files directly -- loses plugin-inferred targets

**Why this is limited:** The polyrepo plugin needs the FULL graph (nodes with targets, dependencies, metadata) to create proxy targets and dependency edges. `nx show projects` only returns project names. There is no lighter-weight Nx command that returns the full graph JSON.

The `nx graph --print` command IS the canonical way to get the full graph. Nx does not expose a "get project configurations without running plugins" API.

**Complexity:** High (would need major refactoring of what data the plugin uses)
**Expected speedup:** Unknown -- depends on what data can be dropped

---

## 5. Recommended Approach

### Immediate (Quick Win): Option 5 -- Add Timing Instrumentation

Confirm that `@nx/gradle` JVM startup is the dominant cost before investing in a larger change.

### Short Term (Best ROI): Option 1 -- Cache Raw JSON in Dockerfile

This is the highest-impact optimization with the lowest risk:

1. Modify Dockerfile Stage 1 to save `nx graph --print` output to a file
2. Add a fast path in `extractGraphFromRepo` to read from the cached file
3. Fall back to live extraction if the file is missing or invalid

Expected improvement: Phase 5 drops from ~4m42s to ~1-2s.

### Medium Term: Option 4 as Complement

If Option 1 is not feasible (e.g., requiring plugin code changes is undesirable), stripping `@nx/gradle` and `@nx/storybook` from the child repo's nx.json during Docker build eliminates ~2-4 minutes with no plugin code changes.

---

## 6. Common Pitfalls

### Pitfall 1: Assuming .nx/ Cache Skips Plugin Execution

**What goes wrong:** Developers assume that having `.nx/workspace-data/` from a previous run means the next `nx graph --print` will be fast.

**Why it happens:** Nx's file-map cache avoids re-hashing files, but the graph construction ALWAYS runs all plugins. The cache only helps with file-level operations, not plugin-level operations.

**How to avoid:** Understand that the Nx graph cache has two layers: file hashing (cached) and plugin execution (always runs). Pre-warming `.nx/` saves ~10-30s, not minutes.

### Pitfall 2: Docker COPY Preserves Files but NOT Processes

**What goes wrong:** Pre-warming a Gradle daemon in Dockerfile Stage 1, then expecting it to be available after `COPY`.

**Why it happens:** Docker COPY copies filesystem state between layers, but processes (Gradle daemon, JVM, Nx daemon) are ephemeral to the RUN instruction that created them.

**How to avoid:** Only rely on file-based caches surviving COPY. Process-based caches (Gradle daemon, JVM JIT cache, Nx daemon) must be re-initialized after COPY.

### Pitfall 3: NX_VERBOSE_LOGGING Contaminates Stdout

**What goes wrong:** `extractGraphFromRepo` fails to parse JSON when `NX_VERBOSE_LOGGING=true` is inherited.

**Why it happens:** The child `nx graph --print` process inherits env vars via `{ ...process.env }`, including `NX_VERBOSE_LOGGING`. When true, Nx emits `[isolated-plugin]` log lines to stdout before the JSON payload.

**How to avoid:** Always override `NX_VERBOSE_LOGGING: 'false'` and `NX_PERF_LOGGING: 'false'` in the child process env (already done in current code at extract.ts:34-35).

### Pitfall 4: Native File Cache Is Path-Dependent

**What goes wrong:** Nx's native `.node` binary cache is at `/tmp/nx-native-file-cache-<hash>`, where hash includes `workspaceRoot`. Moving a workspace changes the hash.

**Why it happens:** `getNativeFileCacheLocation()` computes `sha256(workspaceRoot + nxVersion + username)`. When COPY moves `/synced-nx` to `/workspace/.repos/nx/`, the workspace root changes and the native cache path changes.

**Impact:** Minimal (this cache just avoids re-copying `.node` binaries, saves <1s). But it explains why the native module warning may appear on first run after COPY.

---

## 7. Hash Stability Under Docker COPY (MEDIUM confidence)

### Git State After COPY

Docker COPY preserves file content but modifies timestamps. Git tracks content, not timestamps. However:

- **git's stat cache** (`.git/index`) stores file timestamps for fast dirty-checking
- After Docker COPY, all timestamps change
- `git diff --name-only HEAD` must read every tracked file to verify content matches
- For nrwl/nx with thousands of files, this takes ~5-10s (not a major bottleneck)
- The result is still `''` (empty string -- no dirty files)

### The Outer Hash Components

| Component | After COPY | Stability |
|-----------|-----------|-----------|
| `optionsHash` | Deterministic (same nx.json) | STABLE |
| `alias` | `'nx'` | STABLE |
| `headSha` | Same as clone source | STABLE |
| `dirtyFiles` | `''` (COPY preserves content) | STABLE |

**Conclusion:** The outer hash computed at runtime is deterministic and reproducible. If a cache file with the correct hash existed, it would be a cache hit.

---

## 8. Docker COPY Behavior Summary (HIGH confidence)

| Property | Dockerfile COPY Behavior | Impact on Our Pipeline |
|----------|------------------------|----------------------|
| File content | Preserved exactly | Content hashes match |
| File timestamps | **NOT preserved** (set to build time) | git stat cache invalidated, minor overhead |
| Symlinks | **Dereferenced** (target copied, not link) | pnpm node_modules structure may break if hard-linked |
| `.git/` directory | Copied as regular files | git operations work correctly |
| File permissions | Preserved (with caveats for git context) | No impact |
| Running processes | Not applicable (COPYs files, not processes) | Gradle daemon lost |

Sources:
- [Docker COPY reference](https://docs.docker.com/reference/dockerfile/#copy)
- [Docker forum: timestamps not preserved](https://forums.docker.com/t/dockerfile-need-to-preserve-timestamps-of-files-copy-add/76224)
- [moby/moby#23511: Feature request for timestamp preservation](https://github.com/moby/moby/issues/23511)

---

## 9. Open Questions

### Q1: Exact Time Breakdown Within nx graph --print

**What we know:** The total time is ~4m42s for `nx graph --print` inside `.repos/nx/`.
**What's unclear:** The exact breakdown between JVM startup, Gradle task execution, other plugins, and file scanning.
**Recommendation:** Add `NX_PERF_LOGGING=true` to stderr (does not contaminate stdout) to get Nx's built-in performance marks. Alternatively, run `time nx graph --print` manually in the container with verbose logging directed to stderr.

### Q2: Does Stripping @nx/gradle Affect E2E Test Correctness?

**What we know:** The polyrepo plugin extracts ALL projects from the child repo's graph, including Gradle-discovered projects.
**What's unclear:** Whether any e2e test specifically asserts on Gradle-discovered projects (e.g., project count = 149 including Gradle projects).
**Recommendation:** Check e2e test assertions for specific project counts or Gradle project names before stripping the plugin.

### Q3: pnpm Symlink/Hardlink Integrity After Docker COPY

**What we know:** Docker COPY dereferences symlinks. pnpm's node_modules uses symlinks to the pnpm store.
**What's unclear:** Whether the `/synced-nx/node_modules/` after COPY is a fully materialized tree (all symlinks resolved to copies) or broken (symlinks pointing to non-existent store paths).
**Implication:** If symlinks are broken, the child `nx graph --print` may fail to load plugins, adding to startup time as Node.js retries module resolution.
**Recommendation:** Run `ls -la /workspace/.repos/nx/node_modules/.pnpm/` inside the container to verify node_modules integrity.

---

## Sources

### Primary (HIGH confidence)
- `node_modules/nx/src/project-graph/project-graph.js` -- `buildProjectGraphAndSourceMapsWithoutDaemon()` always calls `getPlugins()` and `retrieveProjectConfigurations()`
- `node_modules/nx/src/project-graph/nx-deps-cache.js` -- `shouldRecomputeWholeGraph()` checks nxVersion, nxJsonPlugins, pathMappings, pluginsConfig
- `node_modules/nx/src/project-graph/utils/retrieve-workspace-files.js` -- `retrieveProjectConfigurations()` always runs all plugins
- `node_modules/nx/src/native/native-file-cache-location.js` -- Cache path is `sha256(workspaceRoot + nxVersion + username)`
- `node_modules/nx/src/utils/cache-directory.js` -- `.nx/workspace-data/` is relative to workspace root
- `packages/op-nx-polyrepo/src/lib/graph/cache.ts` -- Two-layer cache with `computeOuterHash`
- `packages/op-nx-polyrepo/src/lib/graph/extract.ts` -- Child process spawning with env overrides
- `packages/op-nx-polyrepo-e2e/docker/Dockerfile` -- Multi-stage build with pre-warming
- `packages/op-nx-polyrepo-e2e/src/setup/global-setup.ts` -- Phase 5 graph cache warming

### Secondary (MEDIUM confidence)
- [nrwl/nx #32872: @nx/gradle fails without Java](https://github.com/nrwl/nx/issues/32872) -- Confirms @nx/gradle is active in nrwl/nx nx.json
- [nrwl/nx #31835: @nx/gradle extremely slow](https://github.com/nrwl/nx/issues/31835) -- JVM cold start cost documented
- [nrwl/nx #31276: @nx/storybook slow](https://github.com/nrwl/nx/issues/31276) -- Storybook plugin takes 13-27s
- [nrwl/nx #29386: Slow project graph creation](https://github.com/nrwl/nx/issues/29386) -- Plugin loading dominates graph time
- [nrwl/nx nx.json at v22.5.4](https://github.com/nrwl/nx/blob/22.5.4/nx.json) -- 18 plugin entries confirmed
- [Docker COPY reference](https://docs.docker.com/reference/dockerfile/#copy) -- COPY dereferences symlinks, doesn't preserve timestamps

### Tertiary (LOW confidence)
- Plugin-by-plugin time estimates are extrapolated from GitHub issues and general Nx benchmarks, not measured in this specific container environment

---

## Metadata

**Confidence breakdown:**
- Root cause (plugins always execute): HIGH -- verified from Nx source code
- @nx/gradle as dominant cost: MEDIUM-HIGH -- consistent with multiple GitHub issues, but not measured in this container
- Docker COPY behavior: HIGH -- verified from Docker docs + source code
- Hash stability: HIGH -- verified from Nx hasher source code
- Optimization ROI estimates: MEDIUM -- based on analysis, not measured

**Research date:** 2026-03-19
**Valid until:** 2026-04-19 (stable domain -- Nx plugin architecture, Docker COPY behavior change slowly)
**Related:** `e2e-snapshot-perf.md`, `docker-io-optimization.md`
