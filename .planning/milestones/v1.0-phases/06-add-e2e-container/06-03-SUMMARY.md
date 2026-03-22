---
phase: 06-add-e2e-container
plan: 03
status: completed
gap_closure: true
duration: ~90min
tasks_completed: 3
files_modified: 4
files_deleted: 1
commit: 737181a
---

# Plan 06-03 Summary: Fix e2e sync test timeout

## Objective

Fix the "should show project counts after sync" e2e test that was timing out at 120s when syncing nrwl/nx inside a Docker container.

## Approach Taken

Kept nrwl/nx as the test fixture (user rejected synthetic repo) and applied three optimizations:

1. **`ENV CI=true` in Dockerfile** — bypasses nrwl/nx `scripts/preinstall.js` Rust compiler check. The preinstall is a contributor-environment gate, not needed for running Nx.
2. **Prebaked `corepack pnpm install --frozen-lockfile`** — warms the pnpm content-addressable store in the Docker image layer. After sync clone, pnpm resolves from cache via hardlinks instead of downloading.
3. **`.withTmpFs({ '/workspace/.repos': 'rw,exec,size=4g' })`** — RAM-based filesystem eliminates OverlayFS copy-up overhead during pnpm install linking (130s on overlay2 -> 37s on tmpfs).

## Deviation from Plan

The plan specified replacing nrwl/nx with a synthetic test repo. After the executor built this approach, the user rejected it: "this plugin is built with scalability in mind and the nrwl/nx repo is a good reference as a medium-sized repo." The solution pivoted to optimizing the Docker container I/O instead.

## Measured Results

| Metric                  | Before          | After    |
| ----------------------- | --------------- | -------- |
| pnpm install (overlay2) | 130s (timeout)  | N/A      |
| pnpm install (tmpfs)    | N/A             | 37s      |
| Sync test total         | >120s (timeout) | 53.7s    |
| All 4 e2e tests         | 1 failing       | All pass |

## Files Changed

- `packages/op-nx-polyrepo-e2e/docker/Dockerfile` — added CI=true, prebaked pnpm install, restored nrwl/nx clone
- `packages/op-nx-polyrepo-e2e/docker/create-test-repo.sh` — deleted (synthetic repo no longer needed)
- `packages/op-nx-polyrepo-e2e/src/op-nx-polyrepo.spec.ts` — added tmpfs mount, fixed assertions (expect.assertions(3) + expect instead of conditional throw), kept 120s timeout
- `packages/op-nx-polyrepo-e2e/src/setup/global-setup.ts` — fixed Windows path handling with replaceAll('\\', '/')

## Research Produced

- `.planning/research/pnpm-preinstall-bypass.md` — 5 solutions for bypassing nrwl/nx preinstall
- `.planning/research/docker-e2e-monorepo-fixtures.md` — patterns for large monorepo fixtures in Docker e2e
- `.planning/research/pnpm-linking-speed-docker.md` — OverlayFS root cause analysis, ranked solutions
- `.planning/research/docker-io-optimization.md` — Docker I/O performance analysis
