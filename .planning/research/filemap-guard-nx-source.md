# Research: Nx Native Task Hasher fileMap Validation

**Researched:** 2026-03-19
**Nx version:** 22.x (local clone at `D:\projects\github\nrwl\nx`)
**Confidence:** HIGH (all findings from direct source code analysis)

---

## 1. The Error Chain: From `nx test` to "project not found"

### Overview

When `nx test @op-nx/polyrepo` (or any task-running command) executes, the native
task hasher crashes because it encounters project nodes registered by our plugin
that have no corresponding entries in the `projectFileMap`. The error originates in
Rust code and is non-recoverable within the current architecture.

### Exact Error Source

**File:** `packages/nx/src/native/tasks/hashers/hash_project_files.rs`, line 54

```rust
pub fn collect_project_files<'a>(
    project_name: &str,
    file_sets: &[String],
    project_file_map: &'a HashMap<String, Vec<FileData>>,
) -> Result<Vec<&'a FileData>> {
    // ...
    project_file_map.get(project_name).map_or_else(
        || Err(anyhow!("project {} not found", project_name)),  // <-- THE ERROR
        |files| { /* ... filter and return */ },
    )
}
```

**Second error site (project config hashing):**
`packages/nx/src/native/tasks/hashers/hash_project_config.rs`, line 14-16

```rust
pub fn hash_project_config(
    project_name: &str,
    projects: &HashMap<String, Project>,
) -> Result<String> {
    let project = projects
        .get(project_name)
        .ok_or_else(|| anyhow!("Could not find project '{}'", project_name))?;
```

This second error hits if the project is somehow not in `projectGraph.nodes` but
the hash planner still generated instructions for it. In our case, the project IS
in `nodes` (createNodesV2 puts it there), so the first error
(`hash_project_files`) is the one that fires.

### Full Call Chain

```
nx test @op-nx/polyrepo
  -> task-runner creates TaskGraph
  -> InProcessTaskHasher (task-hasher.ts:146)
    -> NativeTaskHasherImpl constructor (native-task-hasher-impl.ts:27)
      -> Receives `externals.projectFiles` (the Rust Arc<ProjectFiles>)
      -> Creates HashPlanner with projectGraph
      -> Creates TaskHasher with projectGraph + projectFileMap + allWorkspaceFiles
    -> hashTasks() (native-task-hasher-impl.ts:78)
      -> planner.getPlansReference(taskIds, taskGraph)
        [Rust] HashPlanner::get_plans_internal (hash_planner.rs:45)
          -> For each task, calls get_inputs() -> split_inputs_into_self_and_deps()
          -> gather_self_inputs() generates:
             - HashInstruction::ProjectFileSet(project_name, file_sets)
             - HashInstruction::ProjectConfiguration(project_name)
             - HashInstruction::TsConfiguration(project_name)
          -> gather_dependency_inputs() walks project_graph.dependencies[project_name]
             FOR EACH dependency that is in project_graph.nodes:
               -> Recursively generates ProjectFileSet instructions for dep project
             FOR EACH dependency that is in project_graph.external_nodes:
               -> Generates HashInstruction::External(dep_name) -- NO file lookup
      -> hasher.hashPlans(plans, env, cwd)
        [Rust] TaskHasher::hash_plans (task_hasher.rs:188)
          -> For each (task_id, instruction) pair, calls hash_instruction()
          -> HashInstruction::ProjectFileSet triggers:
             hash_project_files_with_inputs() -> collect_project_files()
               -> project_file_map.get(project_name) -> None -> ERROR
```

### Does it iterate ALL projects, or only reachable ones?

**Only reachable ones from the task being hashed.** The hash planner starts from
the task's project and follows `project_graph.dependencies[project_name]`
transitively. But the critical detail: our plugin creates implicit dependency
edges from host projects to external projects. So when hashing a host project
that depends on an external project, the planner walks into that external project
and generates `ProjectFileSet` instructions for it.

The error does NOT happen for external projects with zero inbound edges. It only
happens when a host workspace project has a dependency edge pointing to an
external project node that has no fileMap entry.

---

## 2. ProjectFileMap / FileMap Structure

### Type Definition

**Rust (canonical):** `packages/nx/src/native/workspace/types.rs`

```rust
pub type ProjectFiles = HashMap<String, Vec<FileData>>;

pub struct NxWorkspaceFiles {
    pub project_file_map: ProjectFiles,       // project_name -> [FileData]
    pub global_files: Vec<FileData>,          // files not under any project root
    pub external_references: Option<NxWorkspaceFilesExternals>,
}

pub struct NxWorkspaceFilesExternals {
    pub project_files: External<Arc<ProjectFiles>>,  // <-- passed to TaskHasher
    pub global_files: External<Arc<Vec<FileData>>>,
    pub all_workspace_files: External<Arc<Vec<FileData>>>,
}
```

**TypeScript (mirrored):** `packages/nx/src/config/project-graph.ts`

```typescript
interface FileMap {
    nonProjectFiles: FileData[];
    projectFileMap: ProjectFileMap;  // { [projectName: string]: FileData[] }
}
```

### How It Is Populated

**Source:** `packages/nx/src/native/workspace/workspace_files.rs`, `get_files()`

1. `nx_walker()` walks the workspace root respecting `.gitignore` and `.nxignore`
2. For each file, the walker produces an `NxFile { full_path, normalized_path, mod_time }`
3. `get_files()` receives a `project_root_map: HashMap<String, String>` (root -> project_name)
4. For each file, it walks up parent directories looking for a match in `project_root_map`
5. If found: file goes into `project_file_map[project_name]`
6. If not found: file goes into `global_files`

**Critical:** The walker (`packages/nx/src/native/walker.rs`, `create_walker()`)
uses `ignore::WalkBuilder` with `.gitignore` support enabled (`use_ignores: true`).
Since `.repos/` is in `.gitignore`, **all files under `.repos/` are excluded from
the walk**. This means projects whose roots are under `.repos/<alias>/` will NEVER
have any files in the projectFileMap, regardless of whether the directory exists
and contains files.

### Can a Plugin Contribute to the FileMap?

**No.** The fileMap is built entirely by the native workspace file scanner BEFORE
any plugin runs. The pipeline is:

1. Native scanner walks workspace -> produces `NxWorkspaceFiles`
2. `buildProjectGraphUsingProjectFileMap()` receives it as input
3. Plugins (`createNodesV2`, `createDependencies`) run AFTER the fileMap is frozen
4. The `CreateDependenciesContext` passed to plugins has `fileMap` as read-only

There is no plugin hook to contribute additional files to the fileMap.

### Can We Register Empty/Minimal FileMap Entries?

**Not through any public API.** The `ProjectFiles` map is an `Arc<HashMap<>>` that
is created once by the native workspace scanner and passed as an `External<>` NAPI
reference to the Rust TaskHasher. There is no mechanism for plugins or TypeScript
code to inject entries into this Rust-owned data structure after it's created.

---

## 3. How `externalNodes` Works in the Project Graph

### Definition

**TypeScript:** `packages/nx/src/config/project-graph.ts`, lines 122-130

```typescript
interface ProjectGraphExternalNode {
    type: string;  // NOT 'app', 'e2e', or 'lib' -- typically 'npm'
    name: string;  // e.g., "npm:lodash" or "npm:lodash@4.17.21"
    data: {
        version: string;
        packageName: string;
        hash?: string;
    };
}
```

**Rust:** `packages/nx/src/native/project_graph/types.rs`, lines 5-9

```rust
pub struct ExternalNode {
    pub package_name: Option<String>,
    pub version: String,
    pub hash: Option<String>,
}
```

### How External Nodes Are Hashed

External nodes are hashed ONLY by version or by their pre-computed hash:

```rust
// hash_external.rs, line 22-26
let hash = if let Some(external_hash) = &external.hash {
    hash(external_hash.as_bytes())
} else {
    hash(external.version.as_bytes())
};
```

**No file lookup occurs.** External nodes live in `project_graph.external_nodes`,
which is a completely separate map from `project_graph.nodes`. The hash planner
checks which map a dependency belongs to:

```rust
// hash_planner.rs, gather_dependency_inputs(), line 326
if self.project_graph.nodes.contains_key(dep) {
    // It's a project node -> generate ProjectFileSet instructions (NEEDS fileMap)
} else {
    // It's an external node -> generate External instructions (NO fileMap needed)
    if let Some(external_deps) = external_deps_mapped.get(dep) {
        deps_inputs.push(HashInstruction::External(dep.to_string()));
    }
}
```

### Can Dependency Edges Target externalNodes?

**Yes.** The `ProjectGraphBuilder.addDependency()` validates both `projects` and
`externalNodes` as valid targets:

```typescript
// project-graph-builder.ts, validateCommonDependencyRules()
if (!projects[d.target] && !externalNodes[d.target] && !('sourceFile' in d && d.sourceFile)) {
    throw new Error(`Target project does not exist: ${d.target}`);
}
```

And edges from project nodes to external nodes are the standard way npm
dependencies appear in the graph. The graph builder iterates only `graph.nodes`
keys (not `externalNodes`) when building the dependency list in
`getUpdatedProjectGraph()`.

### Does `nx graph --print` Include externalNodes?

**Yes.** The `ProjectGraph` type has `externalNodes?: Record<string, ProjectGraphExternalNode>`
and `nx graph --print` serializes the full graph including external nodes. However,
our plugin's `createNodesV2` registers external repo projects as **project nodes**
(in `graph.nodes`), NOT as external nodes.

### The Key Distinction

| Aspect | `graph.nodes` (project nodes) | `graph.externalNodes` |
|--------|-------------------------------|----------------------|
| Who creates them | `createNodesV2` plugins | Package manager plugin (JS plugin) |
| Stored in | `project_graph.nodes` HashMap | `project_graph.external_nodes` HashMap |
| Hash planner behavior | Generates `ProjectFileSet` (needs fileMap) | Generates `External` (uses version/hash) |
| File requirements | MUST have fileMap entry | NO file requirements |
| Task execution | Can have targets, run tasks | No targets, no task execution |
| Type field | `'app' \| 'e2e' \| 'lib'` | `'npm'` (or any non-project type) |

---

## 4. Is There a "Virtual Project" or "Placeholder" Pattern?

### How npm Packages Appear in the Graph

npm packages are registered as `externalNodes`, not `nodes`. The JS plugin
(`packages/nx/src/native/plugins/js.rs`) discovers them from `package.json` and
lock files. They have:

- A `version` string (used for hashing instead of files)
- An optional `hash` field (pre-computed by the package manager)
- No filesystem root, no targets, no file map entries

This is the only existing pattern in Nx for "projects without real workspace files."

### No Existing "Virtual Project Node" Pattern

There is no Nx code that registers a project node (in `graph.nodes`) without
corresponding workspace files. The assumption throughout the codebase is:

1. If it's in `graph.nodes`, it has a filesystem root inside the workspace
2. The workspace scanner will find its files and map them to `projectFileMap`
3. The task hasher can look up `projectFileMap[projectName]` and get a result

This assumption is hardcoded in the Rust code with no escape hatch.

---

## 5. What Triggers the Hasher to Scan All Projects?

### The trigger is dependency edge traversal, not a full graph scan

The hash planner (`HashPlanner::get_plans_internal`) only processes tasks that are
in the `TaskGraph`. For each task:

1. `get_inputs()` looks up the task's project in `project_graph.nodes`
2. `gather_self_inputs()` generates `ProjectFileSet` for the task's own project
3. `gather_dependency_inputs()` walks `project_graph.dependencies[project_name]`
4. For each dependency in `nodes` -> recursive `self_and_deps_inputs()` -> more `ProjectFileSet`
5. For each dependency in `external_nodes` -> `External` instructions only

**The crash happens at step 4** when a dependency is registered as a project node
(because `createNodesV2` put it there) but has no fileMap entry.

### Can Edges Be Typed to Skip Validation?

**No.** The dependency type (`static`, `dynamic`, `implicit`) has no effect on
whether the hash planner generates file-hashing instructions. All dependency types
are traversed equally in `gather_dependency_inputs()`. The only thing that matters
is whether the target is in `nodes` vs `external_nodes`.

---

## 6. Viable Solutions (Ranked by Feasibility)

### Solution A: Register External Projects as `externalNodes` Instead of `nodes`

**Approach:** Change `createNodesV2` to NOT register external repo projects as
project nodes. Instead, register them as external nodes in the project graph.

**Problem:** External nodes cannot have targets, so task execution would not work.
`externalNodes` is designed for npm packages, not runnable projects. We would lose
the ability to `nx run repo/project:build`.

**Verdict:** NOT VIABLE for our use case.

### Solution B: Filter Dependency Edges in `createDependencies` (Current Approach)

**Approach:** The current fileMap guard in `createDependencies`:

```typescript
const fileMap = context.fileMap?.projectFileMap ?? {};
for (const dep of crossRepoDeps) {
    if (fileMap[dep.source] && fileMap[dep.target]) {
        dependencies.push(dep);
    }
}
```

**Effect:** Cross-repo edges are dropped when either endpoint lacks fileMap entries.
This means the graph shows 463 edges in `nx graph --print` (which doesn't hash),
but task-running commands won't see those edges because `createDependencies` filters
them out based on fileMap availability.

**Problem:** This works as a safety valve but means cross-repo dependency ordering
during task execution is lost. Host projects won't wait for external project builds.

**Verdict:** This is the current working solution. Safe but feature-limited.

### Solution C: Inject Empty FileMap Entries via Monkey-Patching

**Approach:** Before the task hasher runs, intercept the `NxWorkspaceFilesExternals`
and inject empty arrays for external projects.

**Problem:** The fileMap is an `Arc<HashMap<>>` passed as an NAPI `External<>`. It
is created in Rust, wrapped in `Arc`, and shared between the JS and Rust runtimes.
TypeScript code cannot modify it. The Rust code receives it as `&External<Arc<ProjectFiles>>`
which is immutable. There is no public API to mutate it.

**Verdict:** NOT VIABLE without forking Nx.

### Solution D: Set `inputs: []` on All External Project Targets

**Approach:** When `createNodesV2` registers external projects, set `inputs: []` on
every target. This would make the hash planner generate NO `ProjectFileSet`
instructions for those projects.

Let's trace the code path:

1. `get_inputs()` in `inputs.rs` reads `target_data.inputs` from the project config
2. If `inputs` is explicitly `[]` (empty), `split_inputs_into_self_and_deps()` receives `Some(vec![])`
3. With empty self_inputs and empty deps_inputs, `gather_self_inputs()` gets empty `self_inputs`
4. In `gather_self_inputs()` line 377: `project_file_sets.is_empty()` is TRUE (no filesets)
5. But it STILL generates `ProjectConfiguration` and `TsConfiguration` instructions!

```rust
let project_inputs = if project_file_sets.is_empty() {
    vec![
        HashInstruction::ProjectConfiguration(project_name.to_string()),
        HashInstruction::TsConfiguration(project_name.to_string()),
    ]
} else { /* ... */ };
```

`ProjectConfiguration` looks up `project_graph.nodes[project_name]` -- this
SUCCEEDS (the project IS in nodes). But `TsConfiguration` tries to read tsconfig
paths resolved against the project, and it reads from `project_graph.external_nodes`
for the typescript package -- neither of these does a fileMap lookup.

**Wait -- let's re-trace the gather_dependency_inputs path.** When the HOST project
(e.g., `@op-nx/polyrepo`) is being hashed, its dependencies include external
projects. For each external project dependency that is in `project_graph.nodes`,
`gather_dependency_inputs` recursively calls `self_and_deps_inputs`. If the external
project's inputs resolve to an empty set, `gather_self_inputs` for that project
generates only `ProjectConfiguration` + `TsConfiguration` -- no `ProjectFileSet`.

`hash_project_config` does `projects.get(project_name)` -- this works (project is
in `project_graph.nodes`). `TsConfiguration` also works (it reads tsconfig, not
fileMap).

**BUT** -- there's the default input behavior. When no explicit `inputs` are
configured on a target, `split_inputs_into_self_and_deps` applies DEFAULT_INPUTS:

```rust
let inputs = inputs.unwrap_or_else(|| vec![
    Input::FileSet { fileset: "{projectRoot}/**/*", dependencies: false },
    Input::Inputs { input: "default", dependencies: true },
]);
```

So even though we set `inputs: []` on our proxy targets, when the hash planner
processes the HOST project's dependency on the external project, it calls
`get_inputs_for_dependency()` which expands the dependency input (usually "default")
into `{projectRoot}/**/*` for the dependency project. This generates a
`ProjectFileSet` instruction for the external project.

**Let's verify:** `get_inputs_for_dependency` (inputs.rs:45-93) takes a `named_input`
argument. For `Input::Inputs { input: "default", .. }`, it expands "default" using
the DEPENDENCY project's named inputs. The dependency project (external) has no
custom namedInputs, so the default applies: `{projectRoot}/**/*`. This produces
a `ProjectFileSet` instruction that hits the fileMap.

**Verdict:** Setting `inputs: []` on external targets is NOT sufficient by itself
because the HOST project's default dependency inputs (`^default`) still generate
fileSet instructions for the dependency project.

### Solution E: Override `namedInputs.default` on External Projects

**Approach:** When `createNodesV2` registers external projects, set:
```typescript
namedInputs: { default: [] }
```

This overrides the built-in `default` named input (which normally expands to
`{projectRoot}/**/*`). When the host project's dependency hashing expands `^default`
for the external project, it would get an empty fileset.

Let's trace:

1. Host project target has default inputs: `["{projectRoot}/**/*", { input: "default", dependencies: true }]`
2. Hash planner walks to external project dependency
3. `get_inputs_for_dependency()` gets `Input::Inputs { input: "default", dependencies: true }`
4. `get_named_inputs()` for the external project:
   ```rust
   collected_named_inputs.insert("default", vec![Input::FileSet { fileset: "{projectRoot}/**/*", ... }]);
   // Then project-level namedInputs override:
   // If project.named_inputs has "default": [], it overrides to empty
   ```
5. With `default: []`, `expand_named_input("default", &inputs)` returns empty vec
6. `self_and_deps_inputs` for the external project has empty self_inputs
7. `gather_self_inputs` gets no file_sets -> generates only `ProjectConfiguration` + `TsConfiguration`
8. `ProjectConfiguration` succeeds (project is in `project_graph.nodes`)
9. NO `ProjectFileSet` instruction -> NO fileMap lookup -> NO crash

**ALSO need to verify:** The external project itself, when being hashed as a
dependency, still generates `TsConfiguration`. `hash_tsconfig_selectively` in
`task_hasher.rs` line 382-403 uses `project_root_mappings` (built from
`project_graph.nodes`) and `project_graph.external_nodes` for typescript. It does
NOT touch the fileMap. This is safe.

**But wait: `gather_self_inputs` still generates `ProjectConfiguration` +
`TsConfiguration` even with zero filesets:**

```rust
let project_inputs = if project_file_sets.is_empty() {
    vec![
        HashInstruction::ProjectConfiguration(project_name.to_string()),
        HashInstruction::TsConfiguration(project_name.to_string()),
    ]
} else { /* includes ProjectFileSet + ProjectConfiguration + TsConfiguration */ };
```

`hash_project_config` does `projects.get(project_name)` on `project_graph.nodes`.
Our external projects ARE in `project_graph.nodes` (createNodesV2 put them there).
So this succeeds.

**Verdict:** THIS IS VIABLE. Setting `namedInputs: { default: [] }` on external
projects prevents fileMap lookups entirely while still allowing them to exist as
project nodes with targets.

### Solution F: Combined Approach (Recommended)

Set BOTH `inputs: []` on all external project targets AND `namedInputs: { default: [] }`
on external project nodes. This provides defense in depth:

1. `inputs: []` on targets -> direct hashing of the external project generates no fileSet
2. `namedInputs: { default: [] }` -> when hashing a HOST project that depends on this,
   the dependency expansion generates no fileSet for the external project

The `cache: false` already set on proxy targets means Nx won't try to cache or
restore outputs for external projects (their real caching happens in the child repo).

---

## 7. Additional Considerations

### The Walker and .gitignore

**File:** `packages/nx/src/native/walker.rs`, `create_walker()`, lines 168-206

The walker uses `ignore::WalkBuilder` with `.gitignore` support. The
`HARDCODED_IGNORE_PATTERNS` array only contains `node_modules`, `.git`,
`.nx/cache`, `.nx/workspace-data`, and `.yarn/cache`. The `.repos/` exclusion
comes from `.gitignore`, not from hardcoded patterns.

If `.repos/` were REMOVED from `.gitignore`, the walker would pick up files under
`.repos/` and the fileMap would be populated. However, this is undesirable because:
- It would make git track external repo files (merge conflicts, bloat)
- It would make `nx affected` calculate against external repo file changes
- The external repo's files would be hashed as part of the host workspace

### Using `.nxignore` vs `.gitignore`

The walker reads BOTH `.gitignore` and `.nxignore`. Adding `.repos/` to `.nxignore`
instead of (or in addition to) `.gitignore` would also exclude those files from the
walker. However, the walker already excludes them via `.gitignore`, and `.nxignore`
is the Nx-specific escape hatch for files you want git-tracked but Nx-ignored.

### Workspace-Level namedInputs Interaction

If the host workspace's `nx.json` defines custom `namedInputs`, those apply to ALL
projects including external ones UNLESS the project overrides them. Our
`namedInputs: { default: [] }` override is project-level and takes precedence over
workspace-level definitions for the "default" input only.

Other named inputs like "production" or "sharedGlobals" that the workspace defines
would still be visible to external projects, but they would only matter if something
explicitly references them. The key insight is that only "default" is used
implicitly (as the fallback when no inputs are configured and when `^default` is
expanded for dependency hashing).

---

## 8. Recommendation

### Primary Approach: Solution F (Combined)

In `createNodesV2`, when registering external repo projects:

```typescript
projects[node.root] = {
    name: node.name,
    // ...existing fields...
    targets: proxyTargets,  // already have inputs: [], cache: false
    namedInputs: { default: [] },  // <-- ADD THIS
};
```

This ensures:
1. No `ProjectFileSet` instructions generated for external projects
2. `ProjectConfiguration` + `TsConfiguration` still work (they don't use fileMap)
3. Cross-repo dependency edges can be safely added without crashing the hasher
4. The fileMap guard in `createDependencies` can be RELAXED to allow more edges

### Secondary: Relax the fileMap Guard

Once `namedInputs: { default: [] }` is set, the fileMap guard in
`createDependencies` can be simplified:

```typescript
// Before (defensive):
if (fileMap[dep.source] && fileMap[dep.target]) { ... }

// After (only check source, since target's namedInputs prevents fileMap lookup):
if (context.projects[dep.source] && context.projects[dep.target]) { ... }
```

### Risk Assessment

**LOW risk.** The `namedInputs` override uses a fully-supported Nx API. It doesn't
patch internals or rely on undocumented behavior. The hash planner explicitly reads
`project.named_inputs` and uses it to override the default `{projectRoot}/**/*`
expansion. This is the same mechanism any regular Nx project uses when it configures
custom named inputs.

The only subtle risk: if a future Nx version adds a required named input other than
"default" that is expanded during dependency hashing. Currently (Nx 22.x), "default"
is the only implicitly-used named input. Monitor Nx changelogs for changes to
`DEFAULT_INPUTS` in `inputs.rs`.

---

## Source Files Referenced

| File | Lines | What |
|------|-------|------|
| `packages/nx/src/native/tasks/hashers/hash_project_files.rs` | 53-54 | THE ERROR: `project {} not found` |
| `packages/nx/src/native/tasks/hashers/hash_project_config.rs` | 14-16 | Secondary error: `Could not find project '{}'` |
| `packages/nx/src/native/tasks/task_hasher.rs` | 143-466 | TaskHasher struct + hash_plans + hash_instruction |
| `packages/nx/src/native/tasks/hash_planner.rs` | 23-515 | HashPlanner: plan generation, dependency traversal |
| `packages/nx/src/native/tasks/inputs.rs` | 14-289 | Input expansion: get_inputs, get_named_inputs, defaults |
| `packages/nx/src/native/tasks/types.rs` | 52-64 | HashInstruction enum definition |
| `packages/nx/src/native/project_graph/types.rs` | 1-36 | ProjectGraph, Project, ExternalNode Rust types |
| `packages/nx/src/native/workspace/workspace_files.rs` | 12-83 | FileMap construction from walker output |
| `packages/nx/src/native/workspace/types.rs` | 1-41 | NxWorkspaceFiles, ProjectFiles type definitions |
| `packages/nx/src/native/walker.rs` | 97-206 | Workspace file walker (respects .gitignore) |
| `packages/nx/src/hasher/native-task-hasher-impl.ts` | 19-91 | TS bridge to Rust TaskHasher |
| `packages/nx/src/hasher/task-hasher.ts` | 137-218 | InProcessTaskHasher wrapping NativeTaskHasherImpl |
| `packages/nx/src/hasher/create-task-hasher.ts` | 1-27 | Factory: daemon vs in-process hasher |
| `packages/nx/src/native/transform-objects.ts` | 1-63 | JS ProjectGraph -> Rust ProjectGraph transform |
| `packages/nx/src/project-graph/build-project-graph.ts` | 50-85 | FileMap storage + hydration |
| `packages/nx/src/project-graph/project-graph-builder.ts` | 25-631 | Graph builder: addNode, addExternalNode, addDependency |
| `packages/nx/src/config/project-graph.ts` | 67-72 | ProjectGraph TS interface (nodes + externalNodes) |
