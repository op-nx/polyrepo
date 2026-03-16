---
status: diagnosed
trigger: "E2E test 'should show project counts after sync' times out at 120s"
created: 2026-03-16T00:00:00Z
updated: 2026-03-16T00:00:00Z
---

## Current Focus

hypothesis: After sync clones the nx repo, the next Nx command triggers graph extraction which runs `nx graph --print` inside the cloned nrwl/nx repo -- a massive monorepo. This child Nx process takes far longer than 120s in a Docker container.
test: Trace the execution path from sync -> status -> createNodesV2 -> populateGraphReport -> extractGraphFromRepo
expecting: The extractGraphFromRepo call on the nrwl/nx repo is the bottleneck
next_action: Report diagnosis (find_root_cause_only mode)

## Symptoms

expected: Test completes within 120s -- sync clones from file:///repos/nx, status shows project counts
actual: Test times out at 120,000ms
errors: Vitest timeout
reproduction: Run e2e test suite; 4th test always times out
started: Phase 06 (containerized e2e tests)

## Eliminated

(none needed -- root cause identified on first hypothesis)

## Evidence

- timestamp: 2026-03-16T00:01:00Z
  checked: sync executor (executor.ts)
  found: After cloning, sync calls `tryInstallDeps` which runs `corepack pnpm install` (nrwl/nx uses pnpm via corepack). This installs dependencies for the entire nrwl/nx monorepo inside the container.
  implication: Installing deps for nrwl/nx is extremely slow -- hundreds of packages, running in a resource-constrained Docker container on Windows/QEMU.

- timestamp: 2026-03-16T00:02:00Z
  checked: createNodesV2 in index.ts
  found: When `npx nx polyrepo-status` runs after sync, Nx loads the plugin. createNodesV2 calls `populateGraphReport()` which calls `extractGraphFromRepo()` for each synced repo.
  implication: extractGraphFromRepo spawns a child `nx graph --print` process INSIDE the cloned nrwl/nx repo.

- timestamp: 2026-03-16T00:03:00Z
  checked: extractGraphFromRepo in extract.ts
  found: Runs `"<repoPath>/node_modules/.bin/nx" graph --print` with NX_DAEMON=false. For the nrwl/nx monorepo (600+ projects), this is an extremely expensive operation -- it computes the full project graph of the entire Nx monorepo.
  implication: This is the primary bottleneck. Running `nx graph --print` on nrwl/nx takes minutes even on fast hardware, let alone inside a Docker container with potential QEMU emulation overhead.

- timestamp: 2026-03-16T00:04:00Z
  checked: status executor (executor.ts)
  found: The status executor itself calls `gitFetch` for synced repos (line 119-121). For a depth=1 clone from file:///repos/nx, this fetch goes to a local path so it's fast. But the real cost is already paid by the time createNodesV2 runs during Nx's plugin loading phase.
  implication: The status executor code is not the bottleneck -- the plugin loading phase is.

- timestamp: 2026-03-16T00:05:00Z
  checked: Dockerfile
  found: Container is node:22-slim with git. The nrwl/nx repo is pre-cloned to /repos/nx. The test clones from file:///repos/nx to /workspace/.repos/nx/ (fast local clone). But after clone, sync installs deps AND then any subsequent nx command triggers graph extraction.
  implication: Two sequential expensive operations: (1) pnpm install for nrwl/nx, (2) nx graph --print on nrwl/nx. Either alone could exceed 120s in a container.

- timestamp: 2026-03-16T00:06:00Z
  checked: Test flow (spec lines 98-120)
  found: Test runs `npx nx polyrepo-sync` (clones + installs deps + Nx plugin loads which triggers graph extraction), then `npx nx polyrepo-status` (plugin loads again, but should hit disk cache). The sync command itself triggers createNodesV2 during Nx startup, which extracts the graph.
  implication: The FIRST nx command after sync (polyrepo-sync itself or polyrepo-status) triggers full graph extraction. The 120s timeout covers BOTH the sync AND status commands sequentially.

## Resolution

root_cause: The test runs `polyrepo-sync` on the nrwl/nx monorepo inside a Docker container, which triggers three sequential expensive operations that collectively exceed 120s:

1. **git clone** from file:///repos/nx (fast, ~seconds)
2. **dependency installation** via `corepack pnpm install` for the entire nrwl/nx monorepo (slow, potentially 30-60s+)
3. **graph extraction** via `nx graph --print` on the nrwl/nx monorepo (very slow, 60-120s+ -- computes full project graph for 600+ projects)

Operation #2 happens inside `syncRepo()` -> `tryInstallDeps()`. Operation #3 happens when Nx loads the `@op-nx/polyrepo` plugin for ANY subsequent nx command -- `createNodesV2` calls `populateGraphReport()` -> `extractGraphFromRepo()` which spawns `nx graph --print` as a child process inside the cloned repo.

The `polyrepo-status` command then triggers another plugin load, but this should hit the disk cache (no re-extraction). However, even hitting disk cache, the `gitFetch` call in the status executor adds time.

The core issue is that **the e2e test uses the real nrwl/nx monorepo** as its test fixture, which is far too large for a 120s timeout in a containerized environment.

fix: (not applied -- diagnosis only)
verification: (not applied)
files_changed: []
