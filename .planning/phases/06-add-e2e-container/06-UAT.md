---
status: diagnosed
phase: 06-add-e2e-container
source: [06-01-SUMMARY.md, 06-02-SUMMARY.md]
started: 2026-03-16T08:00:00Z
updated: 2026-03-16T08:00:00Z
---

## Current Test

[testing complete]

## Tests

### 1. Cold Start Smoke Test
expected: With Docker Desktop running, clear any cached e2e Docker images (`docker rmi op-nx-e2e-workspace` if it exists). Run `npm exec nx e2e op-nx-polyrepo-e2e --output-style=static`. The image builds from scratch, Verdaccio starts, plugin publishes, workspace installs, and all 3 e2e tests pass without errors.
result: issue
reported: "3 of 4 tests pass but 'should show project counts after sync' timed out at 120s. Error: Test timed out in 120000ms at src/op-nx-polyrepo.spec.ts:98:5. Total duration 233.44s."
severity: blocker

### 2. E2E Test Results
expected: The test output shows 4 passing tests: (1) plugin is installed, (2) unsynced repos detected, (3) workspace targets registered, (4) project counts after sync. No test failures or timeouts.
result: issue
reported: "Fail, see Test 1 - 3 passed, 1 failed (timeout on 'should show project counts after sync')"
severity: blocker

### 3. Warm Cache Performance
expected: Run the e2e suite a second time (same command). With Docker image cached, the total wall time should be under 30 seconds. The output shows all 3 tests passing again.
result: skipped
reason: Blocked by Test 1 timeout failure — same test would fail again

### 4. Vitest Config Integration
expected: Open `packages/op-nx-polyrepo-e2e/vitest.config.mts`. It should reference the testcontainers global setup file (`src/setup/global-setup.ts`) and have reduced timeouts (60s test, 120s hook) compared to the old 300s values.
result: pass

## Summary

total: 4
passed: 1
issues: 2
pending: 0
skipped: 1

## Gaps

- truth: "All e2e tests pass without errors on cold start"
  status: failed
  reason: "User reported: 3 of 4 tests pass but 'should show project counts after sync' timed out at 120s. Error: Test timed out in 120000ms at src/op-nx-polyrepo.spec.ts:98:5. Total duration 233.44s."
  severity: blocker
  test: 1
  root_cause: "Test syncs nrwl/nx monorepo (600+ projects) inside Docker container. polyrepo-sync triggers tryInstallDeps() (pnpm install for massive repo) then createNodesV2 triggers extractGraphFromRepo() which spawns nx graph --print on the full nrwl/nx workspace. These operations collectively exceed 120s timeout."
  artifacts:
    - path: "packages/op-nx-polyrepo/src/lib/executors/sync/executor.ts"
      issue: "tryInstallDeps() runs pnpm install on nrwl/nx monorepo in container"
    - path: "packages/op-nx-polyrepo/src/lib/graph/extract.ts"
      issue: "extractGraphFromRepo() spawns nx graph --print on 600+ project repo"
    - path: "packages/op-nx-polyrepo/src/index.ts"
      issue: "createNodesV2 triggers populateGraphReport() on every Nx command after sync"
    - path: "packages/op-nx-polyrepo-e2e/src/op-nx-polyrepo.spec.ts"
      issue: "Test uses nrwl/nx as fixture — oversized for what it needs to verify"
  missing:
    - "Replace nrwl/nx fixture with a tiny synthetic Nx workspace (2-3 projects) prebaked into Docker image"
    - "Or prebake graph cache + lockfile hash so neither installDeps nor extractGraphFromRepo runs during test"
  debug_session: ".planning/debug/e2e-sync-test-timeout.md"
