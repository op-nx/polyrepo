# fileMap Guard Resolution: Research Synthesis and Decision

**Project:** @op-nx/polyrepo
**Domain:** Nx plugin -- cross-repo project graph registration
**Researched:** 2026-03-19
**Confidence:** HIGH (both analyses verified against Nx 22.x Rust source code)

---

## Executive Summary

The `@op-nx/polyrepo` plugin registers external repo projects into the host Nx workspace via `createNodesV2`. Detection and graph construction work correctly (463 cross-repo edges visible in `nx graph --print`), but Nx's native task hasher -- written in Rust and compiled into a NAPI addon -- crashes with "project not found" when it encounters project nodes without file map entries. Since `.repos/` is gitignored, the native workspace file walker excludes all external project files, leaving zero file map entries for every registered external project.

Two research tracks investigated independent solutions. **Approach A** (from `filemap-guard-nx-source.md`) traces the exact Rust call chain and identifies that setting `namedInputs: { default: [] }` on external project nodes prevents the hash planner from generating `ProjectFileSet` instructions during dependency traversal -- a one-line fix in `createNodesV2` that uses a fully supported Nx configuration API. **Approach B** (from `external-nodes-api.md`) proposes registering each synced repo project as BOTH a regular project node AND a `repo:`-prefixed external node, with cross-repo edges targeting the external node names to bypass the file map entirely.

**The clear winner is Approach A.** It is simpler, lower risk, preserves existing edge semantics, avoids graph duplication, and uses a public Nx API (project-level `namedInputs`) designed exactly for this purpose. Approach B solves the same crash but introduces unnecessary complexity: dual registration, changed naming conventions, duplicated graph entries, and reliance on an under-tested code path (`CreateNodesResult.externalNodes` has zero first-party users in the Nx monorepo).

---

## Decision Matrix

| #   | Criterion                                   | Approach A: namedInputs override                                                      | Approach B: hybrid externalNodes                                                        | Winner                                  |
| --- | ------------------------------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | --------------------------------------- |
| 1   | Cross-repo edges in `nx graph --print`      | YES -- edges use existing project names                                               | YES -- edges target `repo:` prefixed names                                              | A (preserves existing names)            |
| 2   | `nx graph` visualization                    | Normal project-to-project edges                                                       | Dual entries per external project (node + external)                                     | A (cleaner graph)                       |
| 3   | `nx test` / task running does NOT crash     | YES -- no `ProjectFileSet` instructions generated for external deps                   | YES -- external nodes hashed by version, no file map                                    | Tie                                     |
| 4   | External projects visible with tags/targets | YES -- unchanged, they remain regular project nodes                                   | YES -- project nodes kept alongside external nodes                                      | Tie                                     |
| 5   | `nx affected` works across repos            | Partial -- edges exist but `.repos/` file changes invisible to `calculateFileChanges` | Same limitation -- `.repos/` still gitignored                                           | Tie (both deferred to future milestone) |
| 6   | Simplicity of implementation                | One line added to `createNodesV2` + relax guard in `createDependencies`               | Dual registration in `createNodesV2` + rename all edge targets + update detection logic | A (much simpler)                        |
| 7   | Maintenance burden                          | Minimal -- standard Nx config pattern                                                 | Higher -- two representations to keep in sync, `repo:` naming convention                | A                                       |
| 8   | User experience (edge semantics, naming)    | Edges show `my-app -> nx/devkit` (natural)                                            | Edges show `my-app -> repo:nx/devkit` (unfamiliar prefix)                               | A                                       |
| 9   | Risk of breakage with future Nx versions    | LOW -- `namedInputs` is a stable, documented API                                      | MEDIUM -- `CreateNodesResult.externalNodes` has zero first-party users                  | A                                       |
| 10  | Requires Nx core changes                    | NO                                                                                    | NO                                                                                      | Tie                                     |

**Score: Approach A wins 6 criteria, Approach B wins 0, 4 ties.**

---

## Recommended Approach: A (namedInputs override)

### Why This Wins

1. **Minimal change surface.** One property added to external project nodes in `createNodesV2`, one guard relaxed in `createDependencies`. No new naming conventions, no dual registration, no changed edge targets.

2. **Uses a mainstream Nx API.** `namedInputs` at the project level is how any Nx project customizes its hash inputs. Setting `{ default: [] }` tells the hash planner "this project has no file-based inputs to hash." The planner still generates `ProjectConfiguration` and `TsConfiguration` instructions (which succeed because the project IS in `project_graph.nodes`), but skips `ProjectFileSet` (which would crash).

3. **Preserves existing edge semantics.** Cross-repo edges remain `source: 'my-app', target: 'nx/devkit'` -- the same names visible in `nx show projects`. Users reference projects by their natural namespaced names, not by an artificial `repo:` prefix.

4. **No graph duplication.** Each external project appears exactly once in the graph. Approach B creates two entries per project (one project node, one external node), which complicates visualization and mental models.

5. **Battle-tested code path.** The `namedInputs` expansion in `hash_planner.rs` (`get_named_inputs`) is exercised by every Nx project that customizes its inputs. The `CreateNodesResult.externalNodes` return path has zero first-party callers -- it exists in the type system but is untested in production by Nx itself.

### Why Approach B Is Not Recommended

- **Complexity without benefit.** The dual-registration pattern solves the same crash but adds conceptual overhead (two representations per project), naming complexity (`repo:` prefix), and a testing surface that Nx's own codebase does not exercise.
- **Edge semantics are worse.** Users would see `repo:nx/devkit` as the dependency target rather than `nx/devkit`. This creates confusion about which name to use when (project node name for `nx run`, external node name for dependency declarations).
- **`Object.assign` merge is fragile.** External nodes from plugins are merged via simple `Object.assign` with no conflict detection. If another plugin registers an external node with a colliding name, last writer wins silently.
- **`nx show project` behavior differs.** External nodes don't appear in `nx show project` output the same way project nodes do. Users lose the ability to inspect external projects with standard Nx commands.

---

## Implementation Sketch

### Step 1: Add `namedInputs` to external project nodes

In `packages/op-nx-polyrepo/src/index.ts`, `createNodesV2` loop:

```typescript
// Current:
projects[node.root] = {
  name: node.name,
  projectType: toProjectType(node.projectType),
  sourceRoot: node.sourceRoot,
  targets: node.targets,
  tags: node.tags,
  metadata: node.metadata,
};

// Change to:
projects[node.root] = {
  name: node.name,
  projectType: toProjectType(node.projectType),
  sourceRoot: node.sourceRoot,
  targets: node.targets,
  tags: node.tags,
  metadata: node.metadata,
  namedInputs: { default: [] },
};
```

**Why this works (full trace):**

1. Host project `@op-nx/polyrepo` has default inputs: `["{projectRoot}/**/*", { input: "default", dependencies: true }]`
2. Hash planner walks to dependency `nx/devkit` (a project node in `graph.nodes`)
3. `get_inputs_for_dependency()` expands `"default"` using the DEPENDENCY project's named inputs
4. `nx/devkit` now has `namedInputs: { default: [] }` -- expands to empty
5. `gather_self_inputs()` receives zero file sets -- generates only `ProjectConfiguration` + `TsConfiguration`
6. `ProjectConfiguration` succeeds (project is in `graph.nodes`)
7. `TsConfiguration` succeeds (reads tsconfig paths, does not touch file map)
8. No `ProjectFileSet` instruction generated -- no file map lookup -- no crash

### Step 2: Relax the fileMap guard in `createDependencies`

In `packages/op-nx-polyrepo/src/index.ts`, replace the fileMap-based guard:

```typescript
// Current (drops ALL cross-repo edges):
const fileMap = context.fileMap?.projectFileMap ?? {};
for (const dep of crossRepoDeps) {
  if (
    context.projects[dep.source] &&
    context.projects[dep.target] &&
    fileMap[dep.source] &&
    fileMap[dep.target]
  ) {
    dependencies.push(dep);
  }
}

// Change to (allows edges between registered projects):
for (const dep of crossRepoDeps) {
  if (context.projects[dep.source] && context.projects[dep.target]) {
    dependencies.push(dep);
  }
}
```

The `context.projects` check is still needed to handle partial sync scenarios (edge targeting a project from an unsynced repo). The fileMap check is no longer needed because `namedInputs: { default: [] }` prevents the hasher from requesting file data for external projects.

### Step 3: Verify

After both changes:

- `nx graph --print` should show 463 cross-repo edges (same as before)
- `nx test @op-nx/polyrepo` should NOT crash (the fix)
- `nx run nx/devkit:build` should work (proxy target execution unchanged)
- Cross-repo edges should appear in `nx graph` visualization

### Step 4: Update e2e tests

The 3 failing cross-repo e2e tests (`cross-repo-deps.spec.ts`) should now pass since the fileMap guard no longer blocks edges.

---

## Risks and Mitigations

| Risk                                                                          | Severity   | Mitigation                                                                                                                                                                                                                               |
| ----------------------------------------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Future Nx version adds a new implicitly-expanded named input beyond "default" | LOW        | Monitor `DEFAULT_INPUTS` in `inputs.rs` across Nx releases. If a new named input is added, override it too.                                                                                                                              |
| `ProjectConfiguration` hash changes when external project config changes      | NEGLIGIBLE | This is correct behavior -- the project config hash SHOULD change when we update the external project's registration.                                                                                                                    |
| `TsConfiguration` hash fails for external projects without tsconfig           | LOW        | `hash_tsconfig_selectively` gracefully handles missing tsconfig files -- returns empty hash.                                                                                                                                             |
| Workspace-level `namedInputs` (e.g., "production") reference file patterns    | NEGLIGIBLE | Only matters if someone explicitly configures a target with `inputs: [{ input: "production", dependencies: true }]` AND the production named input includes file globs. The empty "default" override does not affect other named inputs. |
| `.nxignore` vs `.gitignore` interaction                                       | NONE       | The fix does not depend on which ignore file excludes `.repos/`. It works regardless of file walker behavior because it prevents file map lookups entirely.                                                                              |

---

## What to Monitor in Future Nx Versions

1. **`DEFAULT_INPUTS` in `inputs.rs`** -- If Nx adds new default inputs beyond `{projectRoot}/**/*` and `{ input: "default", dependencies: true }`, those could introduce new hash instructions that touch the file map.

2. **`gather_self_inputs()` fallback in `hash_planner.rs`** -- Currently, when `project_file_sets.is_empty()`, it falls back to `ProjectConfiguration` + `TsConfiguration` only. If this fallback changes to include file-based instructions, external projects would crash again.

3. **`namedInputs` resolution in `get_named_inputs()`** -- The project-level override takes precedence over workspace-level defaults. If the merge order changes, the override might stop working.

4. **`CreateNodesResult` API changes** -- If Nx deprecates or restructures plugin APIs, both approaches would need updates, but Approach A's changes (adding a property to project config) are more stable than Approach B's (returning `externalNodes`).

5. **File walker `.gitignore` handling** -- If Nx ever adds an option to include gitignored directories in the file map (e.g., via `.nxignore` negation), we could potentially remove the `namedInputs` override. But this would also mean `.repos/` files get hashed, which may not be desirable.

---

## Confidence Assessment

| Area                                     | Confidence | Notes                                                                                                    |
| ---------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------- |
| Crash root cause                         | HIGH       | Traced exact Rust call chain from `nx test` to `collect_project_files` error                             |
| namedInputs override mechanism           | HIGH       | Verified `get_named_inputs()` project-level override in `inputs.rs` source                               |
| Hash planner behavior with empty default | HIGH       | Traced through `gather_self_inputs`, `gather_dependency_inputs`, confirmed no `ProjectFileSet` generated |
| externalNodes API correctness            | HIGH       | Verified types, merge logic, and hash behavior from source                                               |
| Approach comparison                      | HIGH       | Both approaches analyzed against same source code; tradeoffs are objective                               |

**Overall confidence: HIGH** -- All findings verified against primary Nx 22.x Rust and TypeScript source code. No inference or community hearsay.

### Gaps to Address

- **`nx affected` cross-repo**: Neither approach solves `nx affected --base/--head` for cross-repo changes. `.repos/` is gitignored, so `calculateFileChanges()` is blind to synced repo file changes. This is a known deferred item (DETECT-07) for a future milestone, independent of the fileMap guard fix.
- **Proxy target `cache: false` implications**: With `namedInputs: { default: [] }`, external projects could theoretically be cached (hash would be deterministic based on project config). Whether to enable caching for proxy targets is a separate design decision.
- **E2e validation in Docker**: The Docker e2e environment has `.repos/` NOT gitignored, so the fileMap is populated and the crash never occurs there. The fix needs to be validated in the LOCAL development environment where `.repos/` IS gitignored. Consider adding an e2e test variant that simulates the gitignored `.repos/` scenario.

---

## Sources

### Primary (HIGH confidence)

- `packages/nx/src/native/tasks/hash_planner.rs` -- Hash plan generation, dependency traversal, `gather_dependency_inputs` (lines 306-358)
- `packages/nx/src/native/tasks/inputs.rs` -- Input expansion, `get_named_inputs`, `DEFAULT_INPUTS` (lines 14-289)
- `packages/nx/src/native/tasks/hashers/hash_project_files.rs` -- Crash site: `collect_project_files` (line 54)
- `packages/nx/src/native/tasks/hashers/hash_external.rs` -- External node hashing (no file map, lines 9-31)
- `packages/nx/src/native/workspace/workspace_files.rs` -- FileMap construction, gitignore interaction
- `packages/nx/src/native/walker.rs` -- Workspace file walker, `.gitignore` support
- `packages/nx/src/project-graph/plugins/public-api.ts` -- `CreateNodesResult`, `CreateDependenciesContext`
- `packages/nx/src/project-graph/project-graph-builder.ts` -- `addExternalNode`, `validateDependency`
- `packages/nx/src/config/project-graph.ts` -- `ProjectGraph`, `ProjectGraphExternalNode` interfaces

### Detailed Research Files

- `.planning/research/filemap-guard-nx-source.md` -- Full Rust call chain analysis, Solution F recommendation
- `.planning/research/external-nodes-api.md` -- externalNodes API analysis, hybrid approach recommendation

---

_Research synthesized: 2026-03-19_
_Decision: Approach A (namedInputs override)_
_Ready for implementation: yes_
