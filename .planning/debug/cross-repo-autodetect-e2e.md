---
status: diagnosed
trigger: "Why auto-detected cross-repo edges don't appear in the e2e test environment"
created: 2026-03-18T23:00:00Z
updated: 2026-03-18T23:30:00Z
---

## Current Focus

hypothesis: The fileMap filter in createDependencies (index.ts:156-166) silently drops ALL cross-repo edges because .repos/ projects have no file map entries
test: Trace the data flow from detect.ts (produces edges) through index.ts (filters edges)
expecting: Edges are produced by detect.ts but eliminated by the fileMap guard
next_action: Report diagnosis

## Symptoms

expected: Auto-detected cross-repo edges from @workspace/source to nx/\* projects (e.g., nx/devkit) should appear in nx graph --print output
actual: No auto-detected edges appear; the e2e test was removed claiming nrwl/nx projects lack packageName fields
errors: None (silent data loss)
reproduction: Run auto-detect e2e test inside Docker container
started: Commit 885e0c7 removed the test; commit c839559 introduced the fileMap filter

## Eliminated

- hypothesis: nrwl/nx projects lack metadata.js.packageName fields
  evidence: The nrwl/nx monorepo publishes @nx/devkit, @nx/js, nx, etc. Their project.json or package.json files set packageName. The Zod schema (types.ts) parses metadata.js.packageName. transform.ts line 104 extracts it correctly. The original e2e test at commit d5fbbb7 even injected @nx/devkit into host package.json and expected it to work. The REAL issue is downstream filtering, not missing metadata.
  timestamp: 2026-03-18T23:10:00Z

- hypothesis: The cross-repo guard in detect.ts (Step 2) incorrectly treats all projects as same-repo
  evidence: Commit c839559 fixed this exact bug (projectToRepo overwrite). The current code at detect.ts:291-296 now correctly guards with `if (!projectToRepo.has(projectName))`. This bug was fixed but the e2e test was already removed before it could benefit.
  timestamp: 2026-03-18T23:15:00Z

## Evidence

- timestamp: 2026-03-18T23:05:00Z
  checked: transform.ts lines 103-104, 161
  found: packageName is correctly extracted from node.data.metadata?.js?.packageName and stored on TransformedNode
  implication: The transform pipeline preserves packageName correctly

- timestamp: 2026-03-18T23:06:00Z
  checked: detect.ts lines 199-210 (Step 1a)
  found: pkgNameToProject map is built from TransformedNode.packageName for all external nodes
  implication: If nrwl/nx projects have packageName in their graph output, the lookup map will contain entries like "@nx/devkit" -> "nx/devkit"

- timestamp: 2026-03-18T23:07:00Z
  checked: detect.ts lines 409-438 (Step 3b)
  found: Host project package.json is read from disk, all deps/devDeps/peerDeps are scanned against pkgNameToProject map. Cross-repo guard ensures source and target are in different repos.
  implication: detect.ts WOULD produce edges if the lookup map has entries

- timestamp: 2026-03-18T23:08:00Z
  checked: index.ts lines 149-166 (createDependencies fileMap filter)
  found: "const fileMap = context.fileMap?.projectFileMap ?? {};" then edges are only included if fileMap[dep.source] AND fileMap[dep.target] are truthy
  implication: CRITICAL -- .repos/ is gitignored, so Nx's projectFileMap has NO entries for nx/\* projects. fileMap["nx/devkit"] is undefined. ALL cross-repo edges where target is an external project are silently dropped.

- timestamp: 2026-03-18T23:09:00Z
  checked: Commit c839559 message and diff
  found: Three bugs fixed -- (1) projectToRepo overwrite, (2) stale cache, (3) task hasher fileMap. Bug 3 added the fileMap filter specifically because "edges to projects without files cause 'project not found' errors during task hashing"
  implication: The fileMap filter was added to fix a REAL task hasher crash, but it also prevents ALL auto-detected edges from appearing in the graph

- timestamp: 2026-03-18T23:11:00Z
  checked: Commit d5fbbb7 (original e2e test)
  found: Original test injected @nx/devkit into host's devDependencies, then expected crossRepoEdges.length > 0 with type 'static' from @workspace/source to nx/\* projects
  implication: The test design was correct -- it expected auto-detection to work after injecting a matching dependency

- timestamp: 2026-03-18T23:12:00Z
  checked: Commit b9af9bb (implicit type fix)
  found: Changed all auto-detected edges from static to implicit because "Nx validates sourceFile against its file map for static edges"
  implication: This fixed sourceFile validation but did NOT address the subsequent fileMap filter in createDependencies

- timestamp: 2026-03-18T23:13:00Z
  checked: Commit 885e0c7 (removed auto-detect test)
  found: Test was removed with message "nrwl/nx repo only produces example projects... none have packageName fields matching the host's dependencies"
  implication: This diagnosis was WRONG. The actual problem was the fileMap filter silently dropping edges. The commit message misidentifies the root cause.

- timestamp: 2026-03-18T23:14:00Z
  checked: Dockerfile lines 23-24
  found: Docker image uses create-nx-workspace with --preset=apps. Host workspace would have nx as a dependency. The test at d5fbbb7 additionally injected @nx/devkit.
  implication: Host workspace DOES have deps that match nrwl/nx packages

- timestamp: 2026-03-18T23:16:00Z
  checked: index.ts line 156 -- fileMap guard on BOTH source AND target
  found: For host->external edges: fileMap["@workspace/source"] exists (host project, files tracked), but fileMap["nx/devkit"] does NOT exist (.repos/ is gitignored). For external->host edges: fileMap["nx/some-project"] does NOT exist. For external->external edges: neither has file map entries.
  implication: The fileMap guard blocks ALL cross-repo edges involving external projects. Auto-detection works correctly in detect.ts but the output is entirely discarded.

## Resolution

root_cause: |
TWO compounding issues prevent auto-detected cross-repo edges from appearing:

**Primary (Bug): fileMap filter in createDependencies (index.ts:156-166) silently drops ALL cross-repo edges involving external projects.**

Commit c839559 added a guard that requires BOTH source AND target to have entries in `context.fileMap.projectFileMap`. Since `.repos/` is gitignored, Nx's file map has no entries for any `nx/*` project. This means:

- Host -> External edges: blocked (target has no file map)
- External -> Host edges: blocked (source has no file map)
- External -> External edges: blocked (neither has file map)

The fileMap filter was added to fix a real task hasher crash ("project not found" during task hashing), but it has the side effect of making cross-repo auto-detection completely non-functional at the integration level.

**Secondary (Misdiagnosis): The e2e test was removed based on a wrong diagnosis.**

Commit 885e0c7 claimed "nrwl/nx repo only produces example projects without packageName fields." This is incorrect. The nrwl/nx monorepo's projects DO have `metadata.js.packageName` set (e.g., `@nx/devkit`, `@nx/js`, `nx`). The `detect.ts` function correctly builds the lookup map and produces edges. But `createDependencies` in `index.ts` drops them all before they reach the graph.

fix: |
The fileMap filter needs to be relaxed for cross-repo edges. Options:

1. **Only check fileMap for the source side of host-sourced edges**: Host projects have file map entries; external projects don't. For host->external edges, only verify fileMap[source]. For external->host, only verify fileMap[target]. For external->external, skip fileMap check entirely. The task hasher issue only matters when Nx tries to hash inputs for a task -- implicit deps don't trigger cascading task hashing.

2. **Inject synthetic file map entries for external projects**: In createNodesV2, register a minimal file entry (e.g., the project root package.json path) so that the fileMap guard passes. This requires understanding how Nx populates projectFileMap.

3. **Remove the fileMap guard entirely for implicit edges**: Since commit b9af9bb already changed all auto-detected edges to implicit type (not static), and the task hasher concern was about static edges with sourceFile, the fileMap guard may be unnecessary for implicit edges.

Option 3 is the most targeted fix: the fileMap guard was added alongside the static->implicit migration but may have been overly conservative. Implicit edges don't carry sourceFile, so the task hasher's "project not found" error path may not apply to them.

verification: |
Not yet verified (diagnosis only).

files_changed:

- packages/op-nx-polyrepo/src/index.ts (lines 156-166, fileMap filter)
- packages/op-nx-polyrepo/src/lib/graph/detect.ts (correct, no changes needed)
- packages/op-nx-polyrepo/src/lib/graph/transform.ts (correct, no changes needed)
- packages/op-nx-polyrepo-e2e/src/op-nx-polyrepo.spec.ts (restore auto-detect test after fix)
