# Phase 1: Plugin Foundation + Repo Assembly - Context

**Gathered:** 2026-03-10
**Status:** Ready for planning

<domain>
## Phase Boundary

Users can configure external repos in nx.json plugin options and have them cloned/updated to disk via explicit Nx commands. The plugin validates config at load time, warns about unsynced repos during graph operations, and provides `polyrepo-sync` and `polyrepo-status` executors. Graph integration (project discovery via `nx show projects` in each repo workspace, project namespacing) is Phase 2 scope.

</domain>

<decisions>
## Implementation Decisions

### Config shape
- **Named map** for repo entries in nx.json plugin options. Key is the local alias, value is either a string (URL or path) or an object with explicit fields
- **String values**: auto-detect type. Matches git URL pattern (`git@`, `https://`, `ssh://`, `file://`) -> remote repo (cloned to `.repos/`). Doesn't match URL pattern -> try as local filesystem path (referenced in-place)
- **Object values**: use `{ url: "..." }` for remote repos, `{ path: "..." }` for local path references. Supports additional per-repo options (`ref`, `depth`)
- **Full URLs only** -- no GitHub shorthand (`org/repo`). Users paste what they'd use with `git clone`
- **Both SSH and HTTPS URLs** supported equally, plus `file://` protocol
- **Local path repos** are referenced in-place (no copy, no symlink). Avoids Windows symlink issues (requires Dev Mode)
- **Fixed `.repos/` directory** at workspace root for cloned remote repos. Not configurable
- **`.gitignore` management**: warn at plugin load if `.repos/` is not gitignored. Auto-adding deferred to `nx add` / init generator
- **Per-repo options** (object form): `ref` (branch/tag, default: remote HEAD), `depth` (clone depth, default: 1 for shallow, 0 for full)

Config example:
```json
{
  "plugins": [{
    "plugin": "nx-openpolyrepo",
    "options": {
      "repos": {
        "repo-a": "git@github.com:org/repo-a.git",
        "repo-b": "D:/projects/repo-b",
        "repo-c": { "url": "https://github.com/org/repo-c.git", "ref": "develop" },
        "repo-d": { "path": "D:/projects/repo-d" },
        "repo-e": { "url": "git@github.com:org/repo-e.git", "ref": "v2.1.0", "depth": 0 }
      }
    }
  }]
}
```

### Assembly trigger
- **Explicit commands only** -- no git operations on every Nx command
- **Two separate executors**: `polyrepo-sync` (clone missing + pull existing) and `polyrepo-status` (show repo state)
- Registered as targets on the host workspace root project
- **`polyrepo-sync`**: clones missing remote repos to `.repos/`, pulls already-cloned repos and local path repos in **parallel**
- **`polyrepo-status`**: shows per-repo state including source type (cloned/referenced/not synced), current branch/ref/tag, configured ref, and drift detection
- **Unsynced repos at graph time**: warn and skip (not error). Graph is partial but Nx commands still work. Vocabulary: "synced"/"unsynced" (not "assembled"/"unassembled")

### Git clone/pull behavior
- **Shallow clone by default** (`--depth=1`), configurable per repo via `depth` option (0 = full clone)
- **Default branch**: clone whatever the remote HEAD points to. Override per repo via `ref` option (branch name or tag)
- **Ref maintenance**: sync maintains the configured ref. Branches get pulled. Tags get re-fetched (`git fetch --tags && git checkout <tag>`) since tags can move (e.g., `v2.1.x`)
- **Pull strategy**: default to `git pull`, configurable per sync invocation via executor option (`fetch` / `pull` / `rebase` / `ff-only`)
- **Dirty working tree**: let git handle it. Git already refuses if local changes conflict with incoming changes. `.repos/` directories are live Nx workspaces -- users may run `nx sync`, `nx generate`, `nx run` inside them, so local modifications are expected and must be respected
- **Local path repos during sync**: pull if it's a git repo (same behavior as remote repos)
- **No automatic git config changes** (e.g., `core.longpaths`). May offer during `nx add` generator (deferred)

### Error handling
- **Config validation**: fail at plugin load with zod error messages pointing to the exact invalid field. Blocks Nx commands until config is fixed
- **Sync failures**: continue processing all repos in parallel, collect failures, report summary at end. Exit code 1 if any failed, 0 if all succeeded
- **Unsynced repos at graph time**: warn and skip. List unsynced repos and suggest `nx polyrepo-sync`
- **Invalid repo content**: if a synced repo has neither `nx.json` nor `package.json#nx`, warn and skip during graph operations. Don't treat as a sync error
- **Exit codes**: simple 0/1. Nx executors return `{ success: boolean }`

</decisions>

<specifics>
## Specific Ideas

- `polyrepo-status` output format should show source type, path, branch, configured ref, and drift:
  ```
  $ nx polyrepo-status
    repo-a: cloned (.repos/repo-a/)
      branch: main (configured: default)
    repo-b: referenced (D:/projects/repo-b)
      branch: develop
    repo-c: cloned (.repos/repo-c/)
      branch: feature-x (configured: develop) [DRIFT]
    repo-d: not synced
      url: git@github.com:org/repo-d.git
  ```
- `polyrepo-sync` output shows parallel progress with per-repo results:
  ```
  $ nx polyrepo-sync
    repo-a: cloning... done
    repo-b: pulling... done (3 new commits)
    repo-c: pulling... failed (auth denied)

    Summary: 2 synced, 1 failed
    [ERROR] repo-c: authentication failed
  ```
- Architecture validated by official Nx plugins (`@nx/gradle`, `@nx/maven`, `@nx/dotnet`) -- all use "external tool + cached JSON + createNodesV2" pattern. Source code available from a local clone of the `nrwl/nx` repo
- **Phase 2 graph integration**: shell out to `nx show projects --json` and `nx graph --file=output.json` inside each `.repos/<alias>/` workspace to get the fully resolved project graph (including all inferred targets from each repo's own plugins). Do NOT manually walk `project.json` files -- that would miss plugin-inferred targets and require reimplementing Nx's graph engine. The "external tool" in the established pattern is Nx itself, run inside each repo

</specifics>

<code_context>
## Existing Code Insights

### Reusable Assets
- Fresh Nx 22.x workspace with `@nx/plugin`, `@nx/devkit`, `@nx/js`, Vite, Vitest already configured
- `packages/` directory is empty -- plugin will be scaffolded here
- `tsconfig.base.json` and `nx.json` ready for plugin registration

### Established Patterns
- `@nx/gradle` (`packages/gradle/src/plugin/`): triggers `createNodesV2` on build files, shells out to Gradle for project discovery, caches JSON report with hash-based invalidation, shares data between `createNodes` and `createDependencies` via module-level variables
- `@nx/maven` (`packages/maven/src/plugins/`): same pattern with Maven analyzer subprocess + `PluginCache`
- `@nx/dotnet` (`packages/dotnet/src/plugins/`): same pattern with C# MSBuild analyzer, maps cross-project references via `referencesByRoot`
- Key architectural insight: plugin triggers on a non-gitignored file (e.g., `nx.json`), reads `.repos/` explicitly in the callback. Gitignored `.repos/` prevents other Nx plugins from detecting external projects
- **Graph discovery pattern (Phase 2)**: the "external tool" in the established pattern is Nx itself -- shell out to `nx show projects --json` / `nx graph --file=output.json` inside each repo workspace to get fully resolved graphs including inferred targets. This parallels how `@nx/gradle` shells out to `gradle` rather than parsing `build.gradle` files directly

### Integration Points
- Plugin registers in `nx.json` under `plugins` array
- Executors register via `executors.json` in the plugin package
- `.repos/` directory at workspace root (gitignored) for cloned remote repos
- Local path repos referenced in-place (no `.repos/` involvement)

</code_context>

<deferred>
## Deferred Ideas

- **`.gitignore` auto-management via `nx add` / init generator** -- add `.repos/` to `.gitignore` during initial setup
- **`core.longpaths=true` git config** -- offer as an option during `nx add` generator for Windows users
- **Sync generator for `.gitignore`** -- manage `.repos/` entry via `nx sync` (Nx-native pattern)
- **Non-Nx repo support** -- repos without `nx.json` or `package.json#nx` are warned and skipped; full support deferred to future milestone

</deferred>

---

*Phase: 01-plugin-foundation-repo-assembly*
*Context gathered: 2026-03-10*
