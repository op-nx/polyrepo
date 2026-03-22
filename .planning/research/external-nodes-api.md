# Research: Nx externalNodes API for Cross-Repo Registration

**Researched:** 2026-03-19
**Source:** Nx 22.x source code at `D:/projects/github/nrwl/nx` (local clone)
**Confidence:** HIGH -- all findings verified against primary source code

---

## 1. How does CreateNodesResult support externalNodes?

### Type Definitions

**File:** `packages/nx/src/project-graph/plugins/public-api.ts` (lines 33-43)

```typescript
export interface CreateNodesResult {
  /**
   * A map of project root -> project configuration
   */
  projects?: Record<string, Optional<ProjectConfiguration, 'root'>>;

  /**
   * A map of external node name -> external node.
   * External nodes do not have a root, so the key is their name.
   */
  externalNodes?: Record<string, ProjectGraphExternalNode>;
}
```

**File:** `packages/nx/src/config/project-graph.ts` (lines 122-130)

```typescript
export interface ProjectGraphExternalNode {
  type: string; // not 'app', 'e2e', or 'lib' -- typically 'npm'
  name: string;
  data: {
    version: string;
    packageName: string;
    hash?: string;
  };
}
```

**File:** `packages/nx/src/project-graph/plugins/public-api.ts` (lines 21-23)

```typescript
export type CreateNodesResultV2 = Array<
  readonly [configFileSource: string, result: CreateNodesResult]
>;
```

### Answer: YES -- a single CreateNodesResult can return BOTH `projects` AND `externalNodes`

The `CreateNodesResult` interface has both fields as optional. A plugin can populate both simultaneously. The merge logic in `mergeCreateNodesResults` (line 545-599 of `project-configuration-utils.ts`) processes them independently:

```typescript
// Line 545
const { projects: projectNodes, externalNodes: pluginExternalNodes } = nodes;
// ...processes projectNodes into projectRootMap via mergeProjectConfigurationIntoRootMap...
// Line 599
Object.assign(externalNodes, pluginExternalNodes);
```

Key observation: projects are merged with conflict resolution (name collisions, source maps), but externalNodes are merged via simple `Object.assign` -- **last writer wins** with no conflict detection for duplicate external node names.

---

## 2. How are npm external nodes registered?

### Which plugin creates them?

**File:** `packages/nx/src/plugins/js/project-graph/build-nodes/build-npm-package-nodes.ts`

This is called from the `@nx/js` internal plugin, NOT via `CreateNodesResult.externalNodes`. It uses the **legacy `ProjectGraphBuilder` API** directly:

```typescript
export function buildNpmPackageNodes(builder: ProjectGraphBuilder) {
  const packageJsonPath = join(workspaceRoot, 'package.json');
  const packageJson: Partial<PackageJson> = existsSync(packageJsonPath)
    ? readJsonFile(packageJsonPath)
    : {};
  const deps = {
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
  };
  Object.keys(deps).forEach((d) => {
    if (!builder.graph.externalNodes[`npm:${d}`]) {
      builder.addExternalNode({
        type: 'npm',
        name: `npm:${d}`,
        data: {
          version: deps[d],
          packageName: d,
          hash: hashArray([d, deps[d]]),
        },
      });
    }
  });
}
```

### npm externalNode properties

| Property           | Value                          | Example        |
| ------------------ | ------------------------------ | -------------- |
| `type`             | `'npm'`                        | `'npm'`        |
| `name`             | `'npm:<packageName>'`          | `'npm:lodash'` |
| `data.version`     | semver range from package.json | `'^4.17.21'`   |
| `data.packageName` | npm package name               | `'lodash'`     |
| `data.hash`        | `hashArray([name, version])`   | `'12345678'`   |

### Naming convention

- Root dependencies: `npm:packageName` (e.g., `npm:lodash`)
- Nested transitive: `npm:packageName@version` (e.g., `npm:lodash@4.17.21`)

This convention is documented in the `ProjectGraphExternalNode` JSDoc (project-graph.ts lines 113-120).

---

## 3. How does the project graph merge externalNodes?

### Merge flow

**File:** `packages/nx/src/project-graph/build-project-graph.ts` (lines 87-194)

The entry point `buildProjectGraphUsingProjectFileMap` receives `externalNodes` as a pre-built parameter:

```
createProjectConfigurationsWithPlugins()
  -> mergeCreateNodesResults()
    -> collects externalNodes from all plugins via Object.assign
  -> returns ConfigurationResult { projects, externalNodes, ... }

buildProjectGraphUsingProjectFileMap(projectRootMap, externalNodes, ...)
  -> buildProjectGraphUsingContext()
    -> creates ProjectGraphBuilder
    -> adds all externalNodes via builder.addExternalNode()
    -> normalizeProjectNodes() adds project nodes
    -> updateProjectGraphWithPlugins() runs createDependencies
```

### Are externalNodes included in `nx graph --print` output?

**YES.** The `createJsonOutput` function (graph.ts line 1476) serializes `prunedGraph` which is a `ProjectGraph`. The `ProjectGraph` interface has `externalNodes` as a field (project-graph.ts line 69):

```typescript
export interface ProjectGraph {
  nodes: Record<string, ProjectGraphProjectNode>;
  externalNodes?: Record<string, ProjectGraphExternalNode>;
  dependencies: Record<string, ProjectGraphDependency[]>;
  version?: string;
}
```

### Are externalNodes in `context.projects` passed to createDependencies?

**NO -- they are in a SEPARATE field.** The `CreateDependenciesContext` (public-api.ts lines 57-84) has:

```typescript
export interface CreateDependenciesContext {
  readonly externalNodes: ProjectGraph['externalNodes']; // <-- separate field
  readonly projects: Record<string, ProjectConfiguration>; // <-- project nodes only
  readonly nxJsonConfiguration: NxJsonConfiguration;
  readonly fileMap: FileMap;
  readonly filesToProcess: FileMap;
  readonly workspaceRoot: string;
}
```

`context.projects` contains only project nodes (keyed by name). External nodes are in `context.externalNodes` (keyed by name like `npm:lodash`).

---

## 4. Can createDependencies create edges TO externalNodes?

### Dependency validation code

**File:** `packages/nx/src/project-graph/project-graph-builder.ts` (lines 506-588)

The `validateDependency` function calls `validateCommonDependencyRules` (lines 521-553):

```typescript
function validateCommonDependencyRules(
  d: RawProjectGraphDependency,
  { externalNodes, projects, fileMap }: CreateDependenciesContext,
) {
  // Source must exist as either project or external node
  if (!projects[d.source] && !externalNodes[d.source]) {
    throw new Error(`Source project does not exist: ${d.source}`);
  }
  // Target must exist as project, external node, OR have a sourceFile
  if (
    !projects[d.target] &&
    !externalNodes[d.target] &&
    !('sourceFile' in d && d.sourceFile)
  ) {
    throw new Error(`Target project does not exist: ${d.target}`);
  }
  // External nodes CANNOT depend on internal projects
  if (externalNodes[d.source] && projects[d.target]) {
    throw new Error(`External projects can't depend on internal projects`);
  }
  // sourceFile validation...
}
```

### Allowed edge directions

| Source        | Target        | Allowed? | Notes                                                        |
| ------------- | ------------- | -------- | ------------------------------------------------------------ |
| project node  | project node  | YES      | Standard case                                                |
| project node  | external node | YES      | e.g., project -> npm:lodash                                  |
| external node | external node | YES      | e.g., npm:react -> npm:react-dom                             |
| external node | project node  | **NO**   | Throws "External projects can't depend on internal projects" |

### Additional constraints by dependency type

**Static dependencies (lines 579-588):**

```typescript
function validateStaticDependency(d, { projects }) {
  // internal nodes must provide sourceProjectFile
  // externalNodes do not have sourceProjectFile
  if (projects[d.source] && !d.sourceFile) {
    throw new Error(`Source project file is required`);
  }
}
```

**Implicit dependencies (lines 555-561):**

```typescript
function validateImplicitDependency(d, { externalNodes }) {
  if (externalNodes[d.source]) {
    throw new Error(`External projects can't have "implicit" dependencies`);
  }
}
```

**Dynamic dependencies (lines 564-577):**

```typescript
function validateDynamicDependency(d, { externalNodes }) {
  if (externalNodes[d.source]) {
    throw new Error(`External projects can't have "dynamic" dependencies`);
  }
}
```

### Summary of dependency constraints on external nodes

| Direction            | Static                     | Dynamic                | Implicit |
| -------------------- | -------------------------- | ---------------------- | -------- |
| project -> external  | YES (needs sourceFile)     | YES (needs sourceFile) | YES      |
| external -> external | YES (no sourceFile needed) | NO                     | NO       |
| external -> project  | NO (unconditional)         | NO                     | NO       |

### Answer for our use case

**YES -- createDependencies can create edges FROM a project node TO an externalNode.** The validation explicitly checks `externalNodes[d.target]` as a valid target. However:

- For static deps from a project, a `sourceFile` is required
- Implicit deps are the simplest: just source (project) and target (externalNode)

---

## 5. Does the task hasher process externalNodes?

This is the critical question for the crash investigation.

### How tasks are created

Tasks are only created for **project nodes** (type `app`, `lib`, `e2e`), never for external nodes. External nodes have no targets, so the `createTaskGraph` function never produces tasks referencing them.

### How the hash planner handles dependencies

**File:** `packages/nx/src/native/tasks/hash_planner.rs` (lines 306-358)

The `gather_dependency_inputs` method iterates over a project's dependencies:

```rust
fn gather_dependency_inputs(...) {
    for dep in project_deps {
        if self.project_graph.nodes.contains_key(dep) {
            // Internal project: recurse into its inputs
            deps_inputs.extend(self.self_and_deps_inputs(...));
        } else {
            // External node: add HashInstruction::External
            if let Some(external_deps) = external_deps_mapped.get(dep) {
                deps_inputs.push(HashInstruction::External(dep.to_string()));
                deps_inputs.extend(external_deps.iter()
                    .map(|s| HashInstruction::External(s.to_string())));
            }
        }
    }
}
```

This means when the planner encounters a dependency that is NOT in `project_graph.nodes`, it checks `external_deps_mapped` (which is built from `project_graph.external_nodes`).

### How the hasher executes external hash instructions

**File:** `packages/nx/src/native/tasks/task_hasher.rs` (lines 445-453)

```rust
HashInstruction::External(external) => {
    let hashed_external = hash_external(
        external,
        &self.project_graph.external_nodes,
        Arc::clone(&self.external_cache),
    )?;
}
```

**File:** `packages/nx/src/native/tasks/hashers/hash_external.rs` (lines 9-31)

```rust
pub fn hash_external(
    external_name: &str,
    externals: &HashMap<String, ExternalNode>,
    cache: Arc<DashMap<String, String>>,
) -> Result<String> {
    let external = externals
        .get(external_name)
        .ok_or_else(|| anyhow!("Could not find external {}", external_name))?;

    let hash = if let Some(external_hash) = &external.hash {
        hash(external_hash.as_bytes())
    } else {
        hash(external.version.as_bytes())
    };

    cache.insert(external_name.to_string(), hash.clone());
    Ok(hash)
}
```

### The crash path for project nodes WITHOUT file map entries

**File:** `packages/nx/src/native/tasks/hashers/hash_project_files.rs` (lines 44-66)

```rust
pub fn collect_project_files<'a>(
    project_name: &str,
    file_sets: &[String],
    project_file_map: &'a HashMap<String, Vec<FileData>>,
) -> Result<Vec<&'a FileData>> {
    project_file_map.get(project_name).map_or_else(
        || Err(anyhow!("project {} not found", project_name)),  // <-- THIS IS THE CRASH
        |files| { ... }
    )
}
```

When a regular project node has targets with file-based inputs (the default), the hash planner generates `HashInstruction::ProjectFileSet(project_name, ...)` which calls `hash_project_files_with_inputs`, which calls `collect_project_files`. If `project_name` is not in `project_file_map` (because `.repos/` is gitignored), this returns an error that propagates up as a crash.

### Answer: externalNodes COMPLETELY BYPASS the file map crash

External nodes are hashed via `HashInstruction::External` which calls `hash_external`. This function:

1. Looks up the node in `project_graph.external_nodes` (NOT project_file_map)
2. Hashes using `node.hash` (if present) or `node.version` (fallback)
3. Never touches the file map at all

**No file map lookup. No project root lookup. No filesystem access.** The hash is purely based on the version/hash string stored in the external node data.

---

## 6. Real-world examples

### npm external nodes (the only built-in producer)

The only code in Nx core that creates external nodes is `buildNpmPackageNodes` (shown in section 2). It uses `ProjectGraphBuilder.addExternalNode()`, not the `CreateNodesResult.externalNodes` path.

### Can plugins create custom (non-npm) external nodes?

**YES.** The `type` field on `ProjectGraphExternalNode` is `string`, not a union type:

```typescript
export interface ProjectGraphExternalNode {
  type: string; // not app, e2e, or lib -- but ANY string is valid
  name: string;
  data: { version: string; packageName: string; hash?: string };
}
```

The only constraint is the `isProjectGraphExternalNode` guard (project-graph.ts lines 132-136):

```typescript
export function isProjectGraphExternalNode(node) {
  return isProjectGraphProjectNode(node) === false;
}
// Where isProjectGraphProjectNode checks: node.type === 'app' || 'e2e' || 'lib'
```

So any `type` value OTHER than `app`, `e2e`, or `lib` is treated as an external node.

### No known Nx plugins creating both projects AND custom externalNodes

I searched the Nx monorepo (`@nx/*` packages) and found no plugin that returns `externalNodes` from `CreateNodesResult`. The npm nodes are created via the legacy builder API. The `CreateNodesResult.externalNodes` field appears to exist for plugin authors but has no first-party usage via the v2 API.

**Confidence: MEDIUM** -- searched Nx repo only, not the broader ecosystem. Third-party plugins may exist.

---

## 7. Analysis: externalNodes vs. regular projects for cross-repo registration

### Current approach (regular project nodes)

Our plugin registers synced repo projects as regular `ProjectGraphProjectNode` entries via `CreateNodesResult.projects`. This means:

- They appear in `context.projects` in `createDependencies`
- They get targets, can be run via `nx run`
- **Problem:** The native task hasher generates `HashInstruction::ProjectFileSet` for them, which calls `collect_project_files`, which crashes because `.repos/` is gitignored and has no file map entries

### Current workaround

We set `inputs: []` and `cache: false` on proxy targets. But this only prevents the hasher from generating file set instructions for the TARGET project's own task. The crash actually happens when the hasher walks **dependency edges** -- if project A depends on project B, and B has no file map entry, the hasher crashes when computing B's file set for A's dependency inputs.

The code in `createDependencies` (our index.ts lines 161-172) works around this by checking `fileMap[dep.source] && fileMap[dep.target]` before adding cross-repo edges. This effectively **drops all cross-repo edges** since external projects never have file map entries.

### Would externalNodes solve the problem?

**Partially, but with significant tradeoffs.**

#### What externalNodes would solve

1. **No file map crash** -- external nodes are hashed by version string, never touching file maps
2. **Valid dependency targets** -- `createDependencies` can create `project -> externalNode` edges
3. **Visible in `nx graph --print`** -- they appear in the graph output
4. **Cheap hashing** -- just version string, no file I/O

#### What externalNodes would NOT solve

1. **No targets** -- external nodes have no targets, so `nx run alias/project:build` would not work. External nodes cannot be task targets.
2. **No `ProjectConfiguration`** -- external nodes have `{ version, packageName, hash }`, not `{ root, targets, tags, ... }`. All project-level metadata is lost.
3. **No task graph participation** -- external nodes never become tasks. They are purely dependency markers.
4. **Confusing naming** -- external nodes use `npm:` prefix convention. Using `repo:` or similar would need careful design to avoid conflicts.
5. **No `nx show project`** -- external nodes don't appear in project listings the same way project nodes do.

### Comparison matrix

| Capability                    | Regular Project Node           | External Node                        |
| ----------------------------- | ------------------------------ | ------------------------------------ |
| Has targets (runnable)        | YES                            | NO                                   |
| Visible in `nx show projects` | YES                            | YES (with --type flag)               |
| Visible in `nx graph` UI      | YES                            | YES (different rendering)            |
| Can be dependency target      | YES                            | YES                                  |
| Can be dependency source      | YES                            | YES (only static to other externals) |
| Participates in task graph    | YES                            | NO                                   |
| Needs file map entries        | YES (for hashing)              | NO                                   |
| Has project root              | YES                            | NO                                   |
| Has tags                      | YES (via ProjectConfiguration) | NO                                   |
| Has metadata                  | YES                            | NO (only version, packageName, hash) |
| Hash computation              | File-based (expensive)         | Version string (cheap)               |
| Cross-repo edge target        | CRASHES (no file map)          | WORKS                                |

### Hybrid approach (recommended)

Register external projects as **both** regular project nodes AND external nodes:

1. **Regular project nodes** -- for discoverability, targets, tags, metadata, `nx run`, `nx show project`
2. **External nodes** -- as dependency targets for cross-repo edges, bypassing the hasher crash

The `CreateNodesResult` already supports returning both simultaneously. The approach:

```typescript
// In createNodesV2:
const result: CreateNodesResult = {
  projects: {
    // Regular nodes for discoverability and targets
    [hostRoot]: { name: namespacedName, targets: proxyTargets, tags, ... }
  },
  externalNodes: {
    // External nodes as edge targets for cross-repo deps
    [`repo:${namespacedName}`]: {
      type: 'repo',
      name: `repo:${namespacedName}`,
      data: {
        version: repoReport.commitHash || '0.0.0',
        packageName: namespacedName,
        hash: repoReport.contentHash,
      }
    }
  }
};
```

Then in `createDependencies`, cross-repo edges would target `repo:alias/project` instead of `alias/project`:

```typescript
// Instead of:
dependencies.push({ source: 'my-app', target: 'alias/lib', type: 'implicit' });
// Use:
dependencies.push({
  source: 'my-app',
  target: 'repo:alias/lib',
  type: 'implicit',
});
```

#### Pros of hybrid approach

- Cross-repo edges actually work (target the external node, not the project node)
- External projects remain runnable via `nx run alias/project:build`
- Tags, metadata, and project configuration preserved
- No file map crash -- edges point to external nodes, not project nodes
- Hash is based on commit/content hash of the synced repo (semantically correct)

#### Cons of hybrid approach

- Two representations per external project (duplication)
- `nx graph` shows both the project node and external node
- Edge semantics change: "my-app depends on repo:alias/lib" vs "my-app depends on alias/lib"
- Need to coordinate naming between project nodes and external nodes
- Users cannot use `implicitDependencies` in project.json to reference cross-repo projects by their project name (must use external node name)

### Alternative: Fix the root cause (empty file map entries)

Instead of using external nodes, inject empty file map entries for external projects. This would require:

1. Ensuring `.repos/` files are tracked by Nx's workspace file watcher (difficult -- .gitignore controls this)
2. Or patching the native hasher to treat missing file map entries as empty rather than erroring

This is the cleanest solution architecturally but requires either Nx upstream changes or unsafe monkey-patching.

### Alternative: Skip hashing via `inputs: []` on ALL transitive targets

The current `inputs: []` on proxy targets prevents hashing of the target's own files. But the crash happens when a host project's dependency inputs walk into the external project. If we could ensure NO dependency input traversal reaches external projects, the crash would not occur.

The `dependsOn` omission in proxy targets (transform.ts line 17-20) already prevents cascading task dependencies. The remaining issue is the implicit dependency edges from `createDependencies` which the hash planner traverses.

**Key insight from hash_planner.rs line 326:** The planner checks `self.project_graph.nodes.contains_key(dep)` first. If the dep is NOT in nodes, it falls into the external node path. But our external projects ARE in nodes (they are regular project nodes), so the planner takes the internal path, which leads to `ProjectFileSet` instructions, which crash.

**If external projects were ONLY external nodes** (not in `project_graph.nodes`), the planner would take the external path automatically. This confirms that the hybrid approach or the pure-external approach would avoid the crash path entirely.

---

## 8. Conclusions and Recommendation

### For the cross-repo dependency edge problem specifically

**Use the hybrid approach:** Register each synced repo project as BOTH a regular project node (for runnability) AND an external node (as the cross-repo edge target). Cross-repo dependency edges should target the external node name (e.g., `repo:nx/project`) rather than the project node name (e.g., `nx/project`).

### Naming convention for custom external nodes

Use `repo:` prefix to distinguish from `npm:` nodes:

- `repo:alias/project-name` for cross-repo dependency targets
- Matches the existing `npm:package-name` convention

### Hash strategy for external nodes

Use the external repo's content hash (from our graph report) as the `hash` field. This gives semantically correct cache invalidation: when the synced repo content changes, all dependent tasks get rehashed.

```typescript
{
  type: 'repo',
  name: `repo:${namespacedName}`,
  data: {
    version: repoReport.commitHash || '0.0.0',
    packageName: namespacedName,
    hash: repoReport.contentHash, // from graph extraction cache
  }
}
```

### Implementation complexity

**LOW.** The change is entirely within our plugin:

1. Add `externalNodes` to `CreateNodesResult` alongside existing `projects` (index.ts)
2. Change cross-repo edge targets in `createDependencies` from project names to external node names
3. Remove the `fileMap` guard that currently drops all cross-repo edges
4. No changes to Nx core needed

### Risk assessment

| Risk                                                 | Severity | Mitigation                                                              |
| ---------------------------------------------------- | -------- | ----------------------------------------------------------------------- |
| Nx graph UI shows duplicate entries                  | LOW      | External nodes render differently; acceptable UX                        |
| Edge semantics confuse users                         | LOW      | Document that cross-repo deps use `repo:` prefix                        |
| Future Nx versions change external node handling     | MEDIUM   | Pin to Nx 22.x behavior; monitor changelogs                             |
| `externalNodes` in CreateNodesResult is under-tested | MEDIUM   | It's a public API with types but few first-party users; test thoroughly |
| External node name collisions with npm nodes         | LOW      | `repo:` prefix avoids `npm:` collision                                  |

---

## Source Files Referenced

| File                                                                              | Lines            | What                                         |
| --------------------------------------------------------------------------------- | ---------------- | -------------------------------------------- |
| `packages/nx/src/project-graph/plugins/public-api.ts`                             | 33-43, 57-84     | CreateNodesResult, CreateDependenciesContext |
| `packages/nx/src/config/project-graph.ts`                                         | 67-72, 95-136    | ProjectGraph, ProjectGraphExternalNode       |
| `packages/nx/src/project-graph/project-graph-builder.ts`                          | 111-123, 506-588 | addExternalNode, validateDependency          |
| `packages/nx/src/project-graph/utils/project-configuration-utils.ts`              | 516-634          | mergeCreateNodesResults                      |
| `packages/nx/src/project-graph/build-project-graph.ts`                            | 87-194, 220-283  | buildProjectGraphUsingProjectFileMap         |
| `packages/nx/src/plugins/js/project-graph/build-nodes/build-npm-package-nodes.ts` | 10-32            | npm external node creation                   |
| `packages/nx/src/native/tasks/hash_planner.rs`                                    | 149-358          | Hash plan generation, dependency traversal   |
| `packages/nx/src/native/tasks/task_hasher.rs`                                     | 309-466          | Hash plan execution                          |
| `packages/nx/src/native/tasks/hashers/hash_external.rs`                           | 9-31             | External node hashing (no file map)          |
| `packages/nx/src/native/tasks/hashers/hash_project_files.rs`                      | 44-66            | Project file hashing (CRASH SITE)            |
| `packages/nx/src/native/project_graph/types.rs`                                   | 1-36             | Rust ProjectGraph, ExternalNode types        |
| `packages/nx/src/native/transform-objects.ts`                                     | 9-63             | JS -> Rust graph transformation              |
| `packages/nx/src/command-line/graph/graph.ts`                                     | 1470-1501        | nx graph --print JSON output                 |
