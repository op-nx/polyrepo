# Research: DETECT-07 — `nx affected` across repo boundaries

**Researched:** 2026-03-18
**Source confidence:** HIGH — all findings verified against Nx source code in `node_modules/nx/src/`

---

## 1. How Nx affected consumes changed files

`nx affected` resolves the file list in `command-line-utils.js: parseFiles()`, which returns one of:

- `--files=<list>` — explicit file list (bypasses git)
- `--uncommitted` — `git diff --name-only --relative HEAD .`
- `--base/--head` — `git diff --name-only --no-renames --relative "<base>" "<head>"`

The result is passed to `calculateFileChanges()` in `project-graph/file-utils.js`. **Critically, this function always runs the file list through `ignore.ignores(f)` first**, where `ignore` is built from the workspace's `.gitignore` and `.nxignore`. Files matching those patterns are silently discarded before any project mapping occurs.

After filtering, surviving files are passed to `getTouchedProjects()` in `affected/locators/workspace-projects.js`, which calls `findProjectForPath()`. That function walks up path segments matching against registered project roots — so it **would** match `.repos/nx/packages/devkit` if the project is registered with that root, but only if the file was not filtered out first.

**Conclusion:** The `.gitignore` filter in `calculateFileChanges` is the sole blocking mechanism. There is no plugin hook, no override, no flag that bypasses this filter. It runs unconditionally on every code path.

---

## 2. Plugin hooks for affected computation

The `NxPluginV2` API (verified in `node_modules/nx/src/project-graph/plugins/public-api.d.ts`) exposes exactly five hooks:

| Hook | Purpose |
|------|---------|
| `createNodesV2` | Register projects |
| `createDependencies` | Add dependency edges |
| `createMetadata` | Add project metadata |
| `preTasksExecution` | Run before task execution |
| `postTasksExecution` | Run after task execution |

There is **no `createAffectedProjects`, no `createTouchedFiles`, and no `injectChangedFiles` hook**. Affected computation is hardcoded inside `nx/src/command-line/affected/` and is not extensible via the plugin API. The `NxAffectedConfig` type exported from `nx/src/config/nx-json` only covers default base/head ref configuration — it does not add a plugin extension point.

**Conclusion:** There is no plugin API surface for injecting "changed files" or "changed projects" into the affected computation. A plugin cannot participate in affected detection beyond contributing graph edges (which `createDependencies` already does).

---

## 3. The `--files` workaround — does it actually work?

The `--files` flag does bypass git and accepts arbitrary relative paths. However, `calculateFileChanges()` applies the `.gitignore`/`.nxignore` filter regardless of whether files came from git or from `--files`. A quick verification with the `ignore` library confirms this:

```
ig.add('.repos/')
ig.ignores('.repos/nx/packages/devkit/src/index.ts')
// returns: true
```

Therefore, `nx affected --files=.repos/nx/packages/devkit/src/index.ts` silently drops the file before it reaches project mapping. The workaround described in the task prompt **does not work** as stated.

**What does work:** Passing `--projects=<name>` directly. The `NxArgs.projects` field bypasses the file-to-project mapping step entirely and names affected projects directly. From `getAffectedGraphNodes()` in `affected.js`, when `nxArgs.all` is set, it also bypasses the file step. The `--projects` flag (available on `nx run-many`) does not exist on `nx affected` as a direct entry point — `nx affected` selects projects via file changes, not project names. However, there is an alternative: `nx run-many --projects=host-app --target=build` achieves the same result when the caller knows which projects to run.

**The only reliable workaround:** Remove `.repos/` from `.nxignore` (not `.gitignore`) — or never add it to `.nxignore` — since `calculateFileChanges` reads both files. If `.repos/` is only in `.gitignore` and not in `.nxignore`, the `ignore` object would still include it because `getIgnoreObject()` reads both files. The only escape is to add a `.nxignore` that explicitly does NOT include `.repos/`, while `.gitignore` does. But `getIgnoreObject()` reads `.gitignore` first and adds its contents, so even a `.nxignore` without `.repos/` would not un-do the `.gitignore` filter.

**Conclusion:** The `--files` workaround is blocked by the `.gitignore` filter in `calculateFileChanges`. There is no way to pass `.repos/` paths through `nx affected --files` as long as `.repos/` is in `.gitignore`. The filter cannot be overridden via plugin API or CLI flag.

---

## 4. Recommended approach for DETECT-07

**What Phase 10 should implement:**

DETECT-07 ("nx affected correctly traces changes across repo boundaries via cross-repo edges") cannot be satisfied by injecting files from `.repos/` into `nx affected --files`, because the `.gitignore` filter blocks them. The requirement needs to be re-scoped to what is actually achievable.

**Two viable implementations:**

**Option A — Shallow DETECT-07 (graph edges only):** Assert that the cross-repo edges ARE in the project graph (verified via `nx graph --print-affected` or programmatic graph inspection). Affected propagation will work correctly if Nx ever receives a touched project from a synced repo — for example, if the user provides `--projects` on `nx run-many` manually. The plugin's job (emitting edges) is done; the limitation is in how Nx receives the initial touched set, not in edge traversal.

**Option B — Wrapper script:** Provide a `polyrepo-affected` executor (or document a shell alias) that:
1. For each synced repo, runs `git -C .repos/<alias> diff --name-only <base>..<head>`
2. Maps each changed file to its project name (already known from the graph report)
3. Calls `nx run-many --projects=<list> --target=<target>` with the combined host-affected + cross-repo-propagated project list

This is the only approach that gives users a true "affected" experience across repo boundaries.

**Recommendation:** Phase 10 should implement Option A (verify edges are present and that graph traversal is correct via unit/integration tests) and document Option B as the user workflow. Implementing Option B as an executor is a separate feature (outside v1.1 scope) but the documentation belongs in Phase 10.

**What to defer:** A `polyrepo-affected` executor or `nx:affected` integration that automatically enumerates cross-repo changes. This is a v1.2+ feature.

---

## 5. User-facing workflow after `polyrepo-sync`

The practical workflow for a user who wants affected-aware cross-repo builds after `polyrepo-sync` pulls new commits into `.repos/nx/`:

```bash
# Step 1: Determine which external projects changed
CHANGED_EXTERNAL=$(
  git -C .repos/nx diff --name-only HEAD~1..HEAD \
  | xargs -I{} echo ".repos/nx/{}" \
  | xargs -I{} node -e "
      // Map file path to project name using nx project graph
      // (requires custom script or nx show project --files)
    "
)

# Step 2: Run affected on host projects that depend on changed external projects
# nx run-many traverses the reverse dep graph from the named projects
pnpm nx run-many --projects=$(echo $CHANGED_EXTERNAL | tr '\n' ',') --target=build
```

In practice, until a `polyrepo-affected` executor exists, the recommended user workflow is simpler and more explicit:

```bash
# After polyrepo-sync, treat all dependents of the synced repo as affected
# Use nx show project to inspect deps, then run-many explicitly
pnpm nx run-many --projects=host-app,another-host-lib --target=build --output-style=static
```

The cross-repo edges registered by `createDependencies` ensure that `nx run-many` respects task ordering and dependency chains (e.g., if `host-app` depends on `nx/devkit`, Nx will run `nx/devkit:build` before `host-app:build` if both have build targets). The gap is only in the *initial* detection of which projects changed — not in the propagation or task ordering once the set is known.

**Summary for the planner:** DETECT-07 in its current form ("nx affected correctly traces changes") is not achievable end-to-end in v1.1 due to the `.gitignore` filter in Nx core that cannot be bypassed by plugin API. Phase 10 should verify the graph edge half (cross-repo edges exist and reverse-dep traversal is correct) and document the manual workflow. The full `polyrepo-affected` automation should be a separate tracked requirement (DETECT-08 or similar) deferred to v1.2.
