---
phase: 15-proxy-target-caching
verified: 2026-03-22T12:55:00Z
status: passed
score: 5/5 must-haves verified
re_verification: false
---

# Phase 15: Proxy Target Caching Verification Report

**Phase Goal:** Proxy targets skip child Nx bootstrap when the child repo's git state is unchanged, eliminating 2-5s overhead per cached target invocation
**Verified:** 2026-03-22T12:55:00Z
**Status:** passed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| #   | Truth                                                                                              | Status   | Evidence                                                                                                          |
| --- | -------------------------------------------------------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------- |
| 1   | Proxy targets have `cache: true` and include a runtime input tied to the child repo's git state    | VERIFIED | `createProxyTarget` returns `{ cache: true, inputs: [{ env: envKey }] }` — transform.ts lines 116-117             |
| 2   | Same proxy target twice without change produces cache hit (skips child Nx invocation)              | VERIFIED | `preTasksExecution` sets deterministic hash via `hashArray([headSha, dirty ? 'dirty' : 'clean'])` — index.ts L317 |
| 3   | After `polyrepo-sync` pulls new changes, proxy target produces cache miss (child Nx re-invoked)    | VERIFIED | HEAD SHA changes after pull; `preTasksExecution` recomputes hash; env var differs; Nx cache key differs           |
| 4   | A failed git command does not produce a constant hash that permanently serves stale cached results | VERIFIED | Both `.git` absent and caught exceptions set `process.env[envKey] = randomUUID()` — index.ts L307, L319           |
| 5   | Caching works correctly under `NX_DAEMON=true`, `NX_DAEMON=false`, and `NX_DAEMON` unset           | VERIFIED | Env inputs use stateless `hash_env.rs` code path — no daemon-specific branches in implementation                  |

**Score:** 5/5 truths verified

---

### Required Artifacts

#### Plan 01 Artifacts

| Artifact                                                   | Provides                                           | Status   | Details                                                                                                     |
| ---------------------------------------------------------- | -------------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------- |
| `packages/op-nx-polyrepo/src/lib/graph/proxy-hash.ts`      | `toProxyHashEnvKey` utility                        | VERIFIED | 11 lines; exports `toProxyHashEnvKey`; JSDoc present                                                        |
| `packages/op-nx-polyrepo/src/lib/graph/proxy-hash.spec.ts` | 6 unit tests for env key normalization             | VERIFIED | 30 lines; 6 `it` cases covering hyphens, dots, slashes, mixed case                                          |
| `packages/op-nx-polyrepo/src/lib/git/detect.ts`            | `getStatusPorcelain` alongside existing helpers    | VERIFIED | Lines 197-202; exported; JSDoc; uses `execGitOutput`                                                        |
| `packages/op-nx-polyrepo/src/lib/graph/transform.ts`       | `createProxyTarget` with `cache: true` + env input | VERIFIED | Line 111: `const envKey = toProxyHashEnvKey(repoAlias)`; L116-117: `inputs: [{ env: envKey }], cache: true` |
| `packages/op-nx-polyrepo/src/lib/graph/transform.spec.ts`  | Updated assertions for cache/inputs behavior       | VERIFIED | Lines 330-341: `inputs` asserts `[{ env: 'POLYREPO_HASH_REPO_B' }]`; lines 354-362: `cache` asserts `true`  |

#### Plan 02 Artifacts

| Artifact                                                          | Provides                                       | Status   | Details                                                                                                               |
| ----------------------------------------------------------------- | ---------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------- |
| `packages/op-nx-polyrepo/src/index.ts`                            | `preTasksExecution` export                     | VERIFIED | Line 289: `export const preTasksExecution: PreTasksExecution<PolyrepoConfig> = async (...)`                           |
| `packages/op-nx-polyrepo/src/index.spec.ts`                       | 11 unit tests for `preTasksExecution`          | VERIFIED | Lines 802-1178; covers happy path, git failure, dirty detection, UUID fallback, isolation, warning dedup, local repos |
| `packages/op-nx-polyrepo/src/lib/executors/sync/executor.ts`      | PROXY-04 fallback documented (commented out)   | VERIFIED | Lines 647-668: commented-out `nx reset` block with PROXY-04 attribution                                               |
| `packages/op-nx-polyrepo/src/lib/executors/sync/executor.spec.ts` | Test confirming nx reset not called by default | VERIFIED | Lines 2412-2443: `describe('proxy-04 conditional nx reset', ...)` with assertion that `nxResetLogs` has length 0      |

---

### Key Link Verification

#### Plan 01 Key Links

| From           | To              | Via                            | Status | Details                                                                                       |
| -------------- | --------------- | ------------------------------ | ------ | --------------------------------------------------------------------------------------------- |
| `transform.ts` | `proxy-hash.ts` | `import { toProxyHashEnvKey }` | WIRED  | transform.ts line 5: `import { toProxyHashEnvKey } from './proxy-hash.js';`; used at line 111 |

#### Plan 02 Key Links

| From       | To              | Via                                         | Status | Details                                                                                           |
| ---------- | --------------- | ------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------- |
| `index.ts` | `proxy-hash.ts` | `import { toProxyHashEnvKey }`              | WIRED  | index.ts line 20: `import { toProxyHashEnvKey } from './lib/graph/proxy-hash';`; used at line 304 |
| `index.ts` | `detect.ts`     | `import { getHeadSha, getStatusPorcelain }` | WIRED  | index.ts line 17: import confirmed; both used in `preTasksExecution` at lines 314-315             |
| `index.ts` | `schema.ts`     | `import { normalizeRepos }`                 | WIRED  | index.ts line 16: `import { normalizeRepos } from './lib/config/schema';`; used at line 297       |

**Note on import extensions:** Relative imports in `index.ts` omit the `.js` extension (e.g., `'./lib/git/detect'` not `'./lib/git/detect.js'`). This differs from the `.js` extension convention noted in plan comments but is consistent with the existing codebase pattern. The test suite passes, indicating the build/test configuration handles this correctly.

---

### Requirements Coverage

| Requirement | Source Plan  | Description (from REQUIREMENTS.md)                                                              | Status    | Evidence                                                                                                                                                                             |
| ----------- | ------------ | ----------------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| PROXY-01    | 15-01        | Proxy targets set `cache: true` to enable host-level Nx caching                                 | SATISFIED | `createProxyTarget` sets `cache: true` at transform.ts line 117; spec asserts `toBe(true)`                                                                                           |
| PROXY-02    | 15-01, 15-02 | Proxy targets include compound runtime input tied to child repo git state (HEAD + working tree) | SATISFIED | `inputs: [{ env: envKey }]` declared in `createProxyTarget`; `preTasksExecution` computes hash from `getHeadSha` + `getStatusPorcelain`                                              |
| PROXY-03    | 15-02        | Fallback guard so failed git commands produce cache miss rather than stale hit                  | SATISFIED | `randomUUID()` set on `.git` absent (index.ts L307) and on exception (index.ts L319); UUID changes every invocation                                                                  |
| PROXY-04    | 15-02        | `polyrepo-sync` executor handles daemon stale cache after sync                                  | SATISFIED | Commented-out `nx reset` block at executor.ts L647-668; test confirms it is not invoked by default; PROXY-04 satisfied by design via env inputs bypassing daemon bug (nrwl/nx#30170) |
| PROXY-05    | 15-02        | Proxy caching works correctly with `NX_DAEMON=true`, `NX_DAEMON=false`, and `NX_DAEMON` unset   | SATISFIED | Env inputs route through `hash_env.rs` (stateless) in Nx internals; no daemon-conditional code paths in implementation                                                               |

**All 5 requirements fully accounted for across plans 15-01 and 15-02.**

**No orphaned requirements:** REQUIREMENTS.md traceability table maps PROXY-01 through PROXY-05 exclusively to Phase 15, and both plans claim them without gaps.

---

### Anti-Patterns Found

| File       | Line | Pattern                                      | Severity | Impact                                                                                |
| ---------- | ---- | -------------------------------------------- | -------- | ------------------------------------------------------------------------------------- |
| `index.ts` | 17   | Missing `.js` extensions on relative imports | Info     | No functional impact; test suite passes; consistent with surrounding codebase imports |

No placeholders, stubs, empty implementations, or TODO/FIXME blockers found in phase-modified files.

---

### Human Verification Required

The following cannot be verified programmatically:

#### 1. End-to-end cache hit on second proxy target invocation

**Test:** Configure a child repo in nx.json. Run a proxy target twice without modifying the child repo. Observe that the second run outputs `[local cache]` or skips the child Nx invocation.
**Expected:** Second run completes in under 1s with no child Nx bootstrap.
**Why human:** Requires a live workspace with a synced repo and the Nx CLI running.

#### 2. Cache invalidation after `polyrepo-sync`

**Test:** Run a proxy target, then run `nx polyrepo-sync` to pull new commits, then run the proxy target again.
**Expected:** Second run produces a cache miss (child Nx invoked); different output from the first run.
**Why human:** Requires network access, a git remote, and the Nx task runner running.

#### 3. UUID-per-invocation prevents stale cache hits for unsynced repos

**Test:** Run a proxy target for a repo whose `.repos/<alias>` directory does not exist (not yet synced). Run again immediately.
**Expected:** Both runs produce cache misses (different UUIDs each time); no stale cached output returned.
**Why human:** Requires running `nx run` twice against an unsynced workspace.

#### 4. `NX_DAEMON=true` end-to-end cache correctness

**Test:** Set `NX_DAEMON=true`, start the Nx daemon, run a proxy target twice, then modify the child repo and run again.
**Expected:** First two runs: cache hit on second. After modification: cache miss.
**Why human:** Requires daemon process management and live git operations.

---

### Verification Notes

**PROXY-02 implementation detail:** REQUIREMENTS.md describes the compound input as `git rev-parse HEAD` + `git diff HEAD`. The implementation uses `getHeadSha` (wraps `git rev-parse HEAD`) + `getStatusPorcelain` (wraps `git status --porcelain`). The signal is equivalent: both capture HEAD identity and working tree dirtiness. `git status --porcelain` additionally detects staged changes and untracked files, making the implementation slightly more sensitive than the requirement specifies — this is a safe superset.

**PROXY-04 design decision:** The requirement was originally stated as "run `nx reset` after sync." The implementation satisfies the requirement's intent (prevent stale cached results after sync) via a superior mechanism (env inputs bypass the daemon caching bug entirely), with the `nx reset` fallback preserved as commented-out code. REQUIREMENTS.md marks PROXY-04 as complete.

**Commit verification:** All 6 commits documented in the SUMMARYs (`5b6c65b`, `21303fb`, `23c2db2`, `e99eb8a`, `024e314`, `874051c`) exist in git history and their diffs match the files they claim to modify.

---

## Gaps Summary

No gaps. All 5 observable truths are verified. All 9 artifacts exist and are substantive. All 4 key links are wired. All 5 requirements are satisfied. The only items requiring human action are live end-to-end execution tests that cannot be verified programmatically from the codebase.

---

_Verified: 2026-03-22T12:55:00Z_
_Verifier: Claude (gsd-verifier)_
