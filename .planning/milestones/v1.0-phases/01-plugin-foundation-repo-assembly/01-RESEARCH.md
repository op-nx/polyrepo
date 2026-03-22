# Phase 1: Plugin Foundation + Repo Assembly - Research

**Researched:** 2026-03-10
**Domain:** Nx plugin development (createNodesV2, executors), git operations from Node.js, config validation with zod
**Confidence:** HIGH

## Summary

Phase 1 builds an Nx plugin that reads repo configuration from `nx.json` plugin options, validates it with zod, and provides two executors (`polyrepo-sync` and `polyrepo-status`) that clone/pull git repos and report their state. The plugin also uses `createNodesV2` to register these executors as targets on the root workspace project and to warn about unsynced repos during graph computation.

The Nx 22.x plugin API is well-documented and stable. The `NxPluginV2` type supports `createNodesV2` (tuple of glob pattern + async function), `createDependencies`, `createMetadata`, and lifecycle hooks. Executors are simple `PromiseExecutor<T>` functions returning `{ success: boolean }`. Git operations should use `node:child_process/execFile` (promisified) directly -- `git.exe` is a proper executable that works cross-platform without a shell. Zod v4 is the standard for config validation with TypeScript type inference.

**Primary recommendation:** Scaffold the plugin with `@nx/plugin:plugin`, add zod as a runtime dependency, implement git operations via `execFile('git', [...])` with promisify, and structure the codebase as config schema + git utilities + two executors + plugin entry point with `createNodesV2`.

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions

- **Config shape**: Named map for repo entries. Key is local alias, value is string (auto-detect URL vs path) or object (`{ url, path, ref, depth }`). Full URLs only, no GitHub shorthand. SSH, HTTPS, and `file://` supported. Local path repos referenced in-place. Fixed `.repos/` directory at workspace root.
- **Assembly trigger**: Explicit commands only -- two executors: `polyrepo-sync` (clone + pull) and `polyrepo-status` (show state). Registered as targets on host workspace root project. Unsynced repos at graph time: warn and skip (not error).
- **Git clone/pull behavior**: Shallow clone by default (`--depth=1`), configurable per repo. Default branch follows remote HEAD, override via `ref`. Branches get pulled, tags get re-fetched. Pull strategy configurable per sync invocation (`fetch`/`pull`/`rebase`/`ff-only`). Dirty working tree: let git handle it. Local path repos: pull if git repo.
- **Error handling**: Config validation fails at plugin load with zod errors. Sync failures: continue all repos, report summary. Unsynced repos at graph time: warn + skip + suggest `nx polyrepo-sync`. Invalid repo content (no nx.json/package.json): warn + skip. Exit codes: simple 0/1.
- **`.gitignore` management**: Warn at plugin load if `.repos/` not gitignored. Auto-adding deferred.

### Claude's Discretion

None explicitly stated -- all major decisions are locked.

### Deferred Ideas (OUT OF SCOPE)

- `.gitignore` auto-management via `nx add` / init generator
- `core.longpaths=true` git config offering during `nx add`
- Sync generator for `.gitignore` via `nx sync`
- Non-Nx repo support (warned and skipped; full support deferred)
  </user_constraints>

<phase_requirements>

## Phase Requirements

| ID      | Description                                                                           | Research Support                                                                                              |
| ------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| ASSM-01 | User can configure repos (URL + optional local path alias) in nx.json plugin options  | Zod schema validates config at plugin load; `createNodesV2` reads options from `NxJsonConfiguration`          |
| ASSM-02 | Plugin clones configured repos into `.repos/` directory on first run                  | `polyrepo-sync` executor uses `execFile('git', ['clone', ...])` with shallow clone defaults                   |
| ASSM-03 | Plugin pulls latest changes for already-cloned repos when assembly is triggered       | `polyrepo-sync` executor detects existing `.repos/<alias>/` and runs `git pull` / `git fetch` based on config |
| ASSM-04 | Config is validated at plugin load time with clear error messages for invalid entries | Zod v4 schema with `.safeParse()` produces structured errors; plugin throws at load time on invalid config    |

</phase_requirements>

## Standard Stack

### Core

| Library      | Version | Purpose                                    | Why Standard                                                                        |
| ------------ | ------- | ------------------------------------------ | ----------------------------------------------------------------------------------- |
| `nx`         | 22.5.4  | Nx core (already installed)                | Workspace runtime, plugin host                                                      |
| `@nx/devkit` | 22.5.4  | Plugin development kit (already installed) | `createNodesFromFiles`, `logger`, `workspaceRoot`, executor types                   |
| `@nx/plugin` | 22.5.4  | Plugin scaffolding (already installed)     | Generators for plugin project, executors, generators                                |
| `zod`        | ^4.3    | Config schema validation                   | TypeScript-first, static type inference, 14x faster than v3, 2kb gzipped, zero deps |
| `typescript` | ~5.9.2  | Type system (already installed)            | Zod v4 requires TS >=5.5                                                            |

### Supporting

| Library              | Version  | Purpose                          | When to Use                                                      |
| -------------------- | -------- | -------------------------------- | ---------------------------------------------------------------- |
| `vitest`             | ^4.0.0   | Unit testing (already installed) | Test config validation, git command construction, executor logic |
| `node:child_process` | built-in | Git command execution            | `execFile` (promisified) for all git operations                  |
| `node:path`          | built-in | Cross-platform path handling     | Join workspace root with `.repos/` and alias                     |
| `node:fs/promises`   | built-in | Filesystem checks                | Check if `.repos/<alias>` exists, read `.gitignore`              |

### Alternatives Considered

| Instead of                 | Could Use                | Tradeoff                                                                                                                                                                                                                                                                                         |
| -------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Raw `execFile('git', ...)` | `simple-git` npm package | simple-git adds ~12M weekly downloads of trust, task queue, progress events, structured output parsing. But it's an extra dependency (wraps child_process internally), and our git operations are simple (clone, pull, fetch, status). Raw `execFile` keeps deps minimal and gives full control. |
| `zod`                      | `ajv` (JSON Schema)      | ajv is JSON-Schema-based, no TypeScript type inference. Zod infers TS types from schemas, eliminating duplicate type definitions. Nx ecosystem increasingly uses zod.                                                                                                                            |

**Installation:**

```bash
npm install zod
```

## Architecture Patterns

### Recommended Project Structure

```
packages/nx-openpolyrepo/
  src/
    index.ts                    # Plugin entry: createNodesV2 export
    lib/
      config/
        schema.ts               # Zod schema + inferred types
        validate.ts             # Validation + normalization logic
      git/
        commands.ts             # execFile wrappers: clone, pull, fetch, status
        detect.ts               # URL vs path detection, repo state detection
      executors/
        sync/
          executor.ts           # polyrepo-sync implementation
          schema.json           # Executor options schema (Nx JSON Schema)
          schema.d.ts           # Generated types from schema.json
        status/
          executor.ts           # polyrepo-status implementation
          schema.json           # Executor options schema
          schema.d.ts           # Generated types
  executors.json                # Registers sync + status executors
  package.json                  # Plugin package metadata
  tsconfig.json                 # Project TS config
  tsconfig.lib.json             # Build config
  tsconfig.spec.json            # Test config
  vite.config.ts                # Vite/Vitest config
```

### Pattern 1: Plugin Entry with createNodesV2

**What:** The plugin exports a `createNodesV2` tuple that triggers on `nx.json` (the one file guaranteed to exist in any Nx workspace). In the callback, it validates config, checks repo sync state, and registers executor targets on the root project.
**When to use:** Always -- this is the Nx-standard way for plugins to register targets.
**Example:**

```typescript
// Source: Nx plugin public API (node_modules/nx/src/project-graph/plugins/public-api.d.ts)
import {
  CreateNodesV2,
  CreateNodesContextV2,
  CreateNodesResult,
  logger,
} from '@nx/devkit';
import { validateConfig, type PolyrepoConfig } from './lib/config/schema';

export const createNodesV2: CreateNodesV2<PolyrepoConfig> = [
  'nx.json', // glob pattern -- triggers on nx.json
  async (configFiles, options, context) => {
    const results: [string, CreateNodesResult][] = [];

    for (const configFile of configFiles) {
      // Validate config -- throws on invalid
      const config = validateConfig(options);

      // Warn about unsynced repos
      warnUnsyncedRepos(config, context.workspaceRoot);

      // Register executor targets on root project
      results.push([
        configFile,
        {
          projects: {
            '.': {
              targets: {
                'polyrepo-sync': {
                  executor: 'nx-openpolyrepo:sync',
                  options: {},
                },
                'polyrepo-status': {
                  executor: 'nx-openpolyrepo:status',
                  options: {},
                },
              },
            },
          },
        },
      ]);
    }

    return results;
  },
];
```

### Pattern 2: PromiseExecutor for Sync/Status

**What:** Each executor is a simple async function receiving typed options and `ExecutorContext`, returning `{ success: boolean }`.
**When to use:** For both `polyrepo-sync` and `polyrepo-status` executors.
**Example:**

```typescript
// Source: Nx executor types (node_modules/nx/src/config/misc-interfaces.d.ts)
import type { PromiseExecutor } from '@nx/devkit';

interface SyncExecutorOptions {
  strategy?: 'fetch' | 'pull' | 'rebase' | 'ff-only';
}

const syncExecutor: PromiseExecutor<SyncExecutorOptions> = async (
  options,
  context,
) => {
  const config = readAndValidateConfig(context);
  const repos = normalizeRepos(config);
  const results = await Promise.allSettled(
    repos.map((repo) => syncRepo(repo, options, context.root)),
  );

  reportResults(results, repos);

  const hasFailures = results.some((r) => r.status === 'rejected');

  return { success: !hasFailures };
};

export default syncExecutor;
```

### Pattern 3: Git Operations via execFile

**What:** Thin async wrappers around `execFile('git', [...args], { cwd })` for clone, pull, fetch, and status operations.
**When to use:** All git interactions in the sync and status executors.
**Example:**

```typescript
// Source: Node.js child_process docs (https://nodejs.org/api/child_process.html)
import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';

const execFile = promisify(execFileCb);

export async function gitClone(
  url: string,
  targetDir: string,
  options: { depth?: number; ref?: string } = {},
): Promise<{ stdout: string; stderr: string }> {
  const args = ['clone'];

  if (options.depth && options.depth > 0) {
    args.push('--depth', String(options.depth));
  }

  if (options.ref) {
    args.push('--branch', options.ref);
  }

  args.push(url, targetDir);

  return execFile('git', args);
}
```

### Pattern 4: Zod Config Schema with Auto-Detection

**What:** Zod discriminated union schema that handles both string shorthand and object forms, with auto-detection of URL vs local path.
**When to use:** Config validation at plugin load time.
**Example:**

```typescript
import { z } from 'zod';

const gitUrlPattern = /^(git@|https?:\/\/|ssh:\/\/|file:\/\/)/;

const repoEntryString = z.string().min(1);

const remoteRepoObject = z.object({
  url: z.string().regex(gitUrlPattern, 'Must be a valid git URL'),
  ref: z.string().optional(),
  depth: z.number().int().min(0).optional(),
});

const localRepoObject = z.object({
  path: z.string().min(1),
});

const repoEntryObject = z.union([remoteRepoObject, localRepoObject]);

const repoEntry = z.union([repoEntryString, repoEntryObject]);

export const polyrepoConfigSchema = z.object({
  repos: z.record(z.string().min(1), repoEntry),
});

export type PolyrepoConfig = z.infer<typeof polyrepoConfigSchema>;
```

### Anti-Patterns to Avoid

- **Spawning a shell for git:** Never use `exec('git clone ...')` with string interpolation. Use `execFile('git', [...args])` with args as an array to prevent command injection and avoid shell overhead.
- **Blocking the plugin load with git operations:** `createNodesV2` runs during graph computation (every Nx command). Never do git clone/pull here -- only validate config and check filesystem state. Git operations belong in executors only.
- **Using `createNodes` (v1 API):** Nx 22 has removed the v1 types. Use `createNodesV2` exclusively.
- **Hardcoding platform-specific paths:** Always use `path.join()` for combining workspace root, `.repos/`, and alias. Never construct paths with string concatenation.

## Don't Hand-Roll

| Problem                      | Don't Build                           | Use Instead                                                                      | Why                                                                                                                                 |
| ---------------------------- | ------------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Config validation            | Custom validation with if/else chains | `zod` schema + `.safeParse()`                                                    | Type inference, structured error messages with exact field paths, handles union types cleanly                                       |
| Plugin scaffolding           | Manual file creation                  | `@nx/plugin:plugin` + `@nx/plugin:executor` generators                           | Creates correct tsconfig, build config, executor registration, test setup                                                           |
| Git URL detection            | Complex regex from scratch            | Simple pattern match on known prefixes (`git@`, `https://`, `ssh://`, `file://`) | Only 4 prefixes to match; anything else is a local path. The decision doc explicitly says "full URLs only, no shorthand"            |
| Parallel repo processing     | Custom concurrency limiter            | `Promise.allSettled()`                                                           | Built-in, handles mixed success/failure, collects all results. The decision says "parallel" with "collect failures, report summary" |
| Executor target registration | Manual `project.json` edits           | `createNodesV2` returning targets on project root `'.'`                          | Nx-native pattern, targets are inferred dynamically, no files to maintain                                                           |

**Key insight:** The Nx plugin API handles all the complex parts (target registration, graph integration, workspace detection). Our plugin's unique logic is: (1) zod schema for config, (2) thin git command wrappers, (3) two simple executors. Everything else is wiring.

## Common Pitfalls

### Pitfall 1: Running git operations in createNodesV2

**What goes wrong:** Plugin becomes extremely slow because clone/pull runs on every `nx` command (graph computation).
**Why it happens:** It feels natural to "ensure repos are ready" during graph build.
**How to avoid:** `createNodesV2` should ONLY validate config and check filesystem state (does `.repos/<alias>/` exist?). Git operations happen exclusively in the `polyrepo-sync` executor.
**Warning signs:** Any `execFile('git', ...)` call inside the `createNodesV2` callback.

### Pitfall 2: Not handling git stderr output correctly

**What goes wrong:** Operations appear to fail when they actually succeeded.
**Why it happens:** Git writes progress info, warnings, and branch tracking messages to stderr even on success. `execFile` rejects if stderr is non-empty (depending on error handling).
**How to avoid:** Check the exit code (rejection = non-zero exit), not stderr content. Log stderr as informational output.
**Warning signs:** "Clone failed" errors when the directory actually exists and is valid.

### Pitfall 3: Shallow clone + branch switching incompatibility

**What goes wrong:** `git checkout <branch>` fails after `--depth=1` clone because the branch is not in the shallow history.
**Why it happens:** Shallow clone only fetches the tip of the default branch (or the specified `--branch`).
**How to avoid:** Always pass `--branch <ref>` at clone time when a `ref` is configured. For tag re-fetch, use `git fetch --depth=1 origin tag <tag> && git checkout <tag>`.
**Warning signs:** "pathspec '<branch>' did not match any file(s) known to git" after clone.

### Pitfall 4: Path separator issues on Windows

**What goes wrong:** Git commands fail or paths break when mixing `/` and `\`.
**Why it happens:** `path.join()` on Windows produces backslashes, but git generally expects forward slashes.
**How to avoid:** Use `path.join()` for filesystem operations, but normalize to forward slashes when passing paths as git arguments. Or use `path.posix.join()` for git-facing paths.
**Warning signs:** "fatal: could not create work tree dir" or path-related errors only on Windows.

### Pitfall 5: Plugin import path mismatch

**What goes wrong:** Nx can't find the plugin when registered in `nx.json`.
**Why it happens:** The `plugin` field in `nx.json` must match the package name in the plugin's `package.json`, and the package must be resolvable from the workspace root.
**How to avoid:** Use the correct import path in `nx.json` (e.g., `nx-openpolyrepo` if that's the package name). For a local plugin in `packages/`, ensure `tsconfig.base.json` has a path mapping or the workspace `package.json` has the workspace link.
**Warning signs:** "Could not find plugin 'nx-openpolyrepo'" errors.

### Pitfall 6: createNodesV2 glob pattern for nx.json

**What goes wrong:** Plugin callback never fires or fires for wrong files.
**Why it happens:** Glob pattern `nx.json` only matches the root `nx.json`. If the pattern is too specific or uses wrong syntax, Nx won't find matches.
**How to avoid:** Use exactly `'nx.json'` as the glob pattern (not `'**/nx.json'` which would also match inside `.repos/`). Files in `.gitignore`d directories like `.repos/` are not included in Nx's file scanning, so the glob naturally only matches the root `nx.json`.
**Warning signs:** Plugin targets not appearing in `nx show project`.

### Pitfall 7: Zod v4 import changes

**What goes wrong:** Import `from 'zod'` breaks or types don't work.
**Why it happens:** Zod v4 restructured exports compared to v3.
**How to avoid:** Use standard import `import { z } from 'zod'` which works in both v3 and v4.
**Warning signs:** TypeScript errors on zod imports.

## Code Examples

Verified patterns from official sources:

### Executor JSON Registration

```json
// executors.json in plugin package root
// Source: Nx executor docs (https://nx.dev/docs/reference/nx/executors)
{
  "executors": {
    "sync": {
      "implementation": "./src/lib/executors/sync/executor",
      "schema": "./src/lib/executors/sync/schema.json",
      "description": "Clone missing repos and pull existing repos to sync workspace"
    },
    "status": {
      "implementation": "./src/lib/executors/status/executor",
      "schema": "./src/lib/executors/status/schema.json",
      "description": "Show the sync state of all configured repos"
    }
  }
}
```

### Executor Schema JSON (for polyrepo-sync)

```json
// src/lib/executors/sync/schema.json
{
  "$schema": "https://json-schema.org/schema",
  "type": "object",
  "properties": {
    "strategy": {
      "type": "string",
      "enum": ["fetch", "pull", "rebase", "ff-only"],
      "default": "pull",
      "description": "Git update strategy for existing repos"
    }
  },
  "additionalProperties": false
}
```

### Reading Plugin Options from ExecutorContext

```typescript
// Inside an executor, read the plugin config from nx.json
import { readNxJson } from '@nx/devkit';
import { polyrepoConfigSchema } from '../config/schema';

function readPluginConfig(workspaceRoot: string): PolyrepoConfig {
  const nxJson = readNxJson(workspaceRoot);
  const pluginEntry = nxJson?.plugins?.find(
    (p) => typeof p === 'object' && p.plugin === 'nx-openpolyrepo',
  );

  if (!pluginEntry || typeof pluginEntry === 'string') {
    throw new Error('nx-openpolyrepo plugin not found in nx.json');
  }

  const result = polyrepoConfigSchema.safeParse(pluginEntry.options);

  if (!result.success) {
    throw new Error(`Invalid nx-openpolyrepo config:\n${result.error.message}`);
  }

  return result.data;
}
```

### Checking .gitignore for .repos/ Entry

```typescript
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { logger } from '@nx/devkit';

async function warnIfReposNotGitignored(workspaceRoot: string): Promise<void> {
  try {
    const gitignore = await readFile(
      join(workspaceRoot, '.gitignore'),
      'utf-8',
    );
    const lines = gitignore.split('\n').map((l) => l.trim());

    if (
      !lines.some(
        (l) =>
          l === '.repos' ||
          l === '.repos/' ||
          l === '/.repos' ||
          l === '/.repos/',
      )
    ) {
      logger.warn(
        'The .repos/ directory is not in .gitignore. ' +
          'Add ".repos/" to .gitignore to avoid committing cloned repos.',
      );
    }
  } catch {
    // No .gitignore file -- warn
    logger.warn(
      'No .gitignore file found. ' +
        'Create one and add ".repos/" to avoid committing cloned repos.',
    );
  }
}
```

### Detecting Repo State for polyrepo-status

```typescript
import { stat } from 'node:fs/promises';
import { join } from 'node:path';

type RepoState = 'cloned' | 'referenced' | 'not-synced';

async function detectRepoState(
  alias: string,
  entry: NormalizedRepoEntry,
  workspaceRoot: string,
): Promise<{ state: RepoState; path: string }> {
  if (entry.type === 'local') {
    try {
      await stat(entry.path);

      return { state: 'referenced', path: entry.path };
    } catch {
      return { state: 'not-synced', path: entry.path };
    }
  }

  // Remote repo
  const repoPath = join(workspaceRoot, '.repos', alias);

  try {
    await stat(join(repoPath, '.git'));

    return { state: 'cloned', path: repoPath };
  } catch {
    return { state: 'not-synced', path: repoPath };
  }
}
```

## State of the Art

| Old Approach                       | Current Approach                      | When Changed                                    | Impact                                              |
| ---------------------------------- | ------------------------------------- | ----------------------------------------------- | --------------------------------------------------- |
| `createNodes` (v1 single-file)     | `createNodesV2` (batch all files)     | Nx 21 (createNodesV2), Nx 22 (v1 types removed) | Must use v2 tuple signature exclusively             |
| Zod v3 (slower, larger bundle)     | Zod v4 (14x faster strings, 2kb gzip) | July 2025                                       | Use `zod@^4.3`, import `{ z } from 'zod'` unchanged |
| `child_process.exec()` with string | `execFile()` with args array          | Best practice since Node 12+                    | Security (no shell injection), cross-platform       |

**Deprecated/outdated:**

- `CreateNodes` v1 API: Types removed in Nx 22. Only `createNodesV2` tuple signature works.
- `createNodes` export name: In Nx 22, both `createNodes` and `createNodesV2` exports accept the v2 signature. Use `createNodesV2` for clarity.

## Open Questions

1. **Plugin package name and import path**
   - What we know: The workspace is `@nx-openpolyrepo/source` with `packages/*` workspaces. The plugin will be in `packages/nx-openpolyrepo/`.
   - What's unclear: Should the published package name be `nx-openpolyrepo` (matching the repo) or `@nx-openpolyrepo/plugin` (scoped)?
   - Recommendation: Use `nx-openpolyrepo` as the import path (matches the repo name, simpler). The `@nx/plugin:plugin` generator will set this up via `--importPath`.

2. **Root project detection for executor targets**
   - What we know: `createNodesV2` can register targets on project root `'.'`. But the workspace currently has no root `project.json` and no `nx` field in `package.json`.
   - What's unclear: Whether Nx treats the root `package.json` as a project automatically in an npm workspace setup.
   - Recommendation: The root `package.json` with `"name": "@nx-openpolyrepo/source"` is likely already detected as a project by Nx. The `createNodesV2` callback returning targets for `'.'` should work. Verify during implementation.

3. **Executor path resolution in executors.json**
   - What we know: `executors.json` paths are relative to the plugin package root.
   - What's unclear: Whether the path should point to `.ts` source or compiled `.js` output.
   - Recommendation: With `@nx/js/typescript` plugin already configured for builds, the executors.json paths should reference the source `.ts` files during development (Nx handles transpilation). Verify against the `@nx/plugin:executor` generator output.

## Validation Architecture

### Test Framework

| Property           | Value                                                        |
| ------------------ | ------------------------------------------------------------ |
| Framework          | Vitest 4.x (already in devDependencies)                      |
| Config file        | None yet -- will be created by `@nx/plugin:plugin` generator |
| Quick run command  | `npx nx test nx-openpolyrepo`                                |
| Full suite command | `npx nx run-many -t test`                                    |

### Phase Requirements -> Test Map

| Req ID  | Behavior                                                                                                 | Test Type          | Automated Command                                           | File Exists? |
| ------- | -------------------------------------------------------------------------------------------------------- | ------------------ | ----------------------------------------------------------- | ------------ |
| ASSM-01 | Config schema accepts valid repo entries (string URL, string path, object URL, object path with options) | unit               | `npx nx test nx-openpolyrepo -- --testPathPattern=config`   | Wave 0       |
| ASSM-01 | Config schema rejects invalid entries (empty string, missing URL/path, bad depth)                        | unit               | `npx nx test nx-openpolyrepo -- --testPathPattern=config`   | Wave 0       |
| ASSM-02 | Sync executor clones missing remote repos to `.repos/`                                                   | unit + integration | `npx nx test nx-openpolyrepo -- --testPathPattern=sync`     | Wave 0       |
| ASSM-03 | Sync executor pulls already-cloned repos                                                                 | unit + integration | `npx nx test nx-openpolyrepo -- --testPathPattern=sync`     | Wave 0       |
| ASSM-04 | Plugin load fails with clear zod errors on invalid config                                                | unit               | `npx nx test nx-openpolyrepo -- --testPathPattern=validate` | Wave 0       |
| ASSM-04 | Plugin warns about unsynced repos during graph operations                                                | unit               | `npx nx test nx-openpolyrepo -- --testPathPattern=plugin`   | Wave 0       |

### Sampling Rate

- **Per task commit:** `npx nx test nx-openpolyrepo`
- **Per wave merge:** `npx nx run-many -t test`
- **Phase gate:** Full suite green before `/gsd:verify-work`

### Wave 0 Gaps

- [ ] Plugin project scaffolded via `@nx/plugin:plugin` -- creates vitest config, tsconfig, package.json
- [ ] `packages/nx-openpolyrepo/src/lib/config/__tests__/schema.spec.ts` -- covers ASSM-01, ASSM-04 (config validation)
- [ ] `packages/nx-openpolyrepo/src/lib/executors/sync/__tests__/executor.spec.ts` -- covers ASSM-02, ASSM-03
- [ ] `packages/nx-openpolyrepo/src/lib/executors/status/__tests__/executor.spec.ts` -- covers status executor
- [ ] `zod` package install: `npm install zod`

## Sources

### Primary (HIGH confidence)

- `node_modules/nx/src/project-graph/plugins/public-api.d.ts` -- CreateNodesV2, NxPluginV2, CreateNodesResult, ExecutorContext types (local source, v22.5.4)
- `node_modules/nx/src/config/misc-interfaces.d.ts` -- PromiseExecutor, ExecutorContext, ExecutorsJson types (local source, v22.5.4)
- `node_modules/nx/src/project-graph/plugins/utils.d.ts` -- createNodesFromFiles helper signature (local source, v22.5.4)
- [Node.js child_process docs](https://nodejs.org/api/child_process.html) -- execFile cross-platform behavior
- [Zod official docs](https://zod.dev/) -- v4 API, safeParse, union types, type inference

### Secondary (MEDIUM confidence)

- [Nx CreateNodes Compatibility](https://nx.dev/docs/extending-nx/createnodes-compatibility) -- v1 to v2 migration, Nx 22 changes
- [Nx Tooling Plugin Tutorial](https://nx.dev/docs/extending-nx/tooling-plugin) -- createNodesV2 tutorial
- [Nx Executors Reference](https://nx.dev/docs/reference/nx/executors) -- executor registration and schema
- [Zod v4 release (InfoQ)](https://www.infoq.com/news/2025/08/zod-v4-available/) -- v4 performance improvements, release date
- [simple-git npm](https://www.npmjs.com/package/simple-git) -- considered and rejected (raw execFile preferred)

### Tertiary (LOW confidence)

- [10 Tips for Nx Plugin Architecture](https://smartsdlc.dev/blog/10-tips-for-successful-nx-plugin-architecture/) -- community best practices
- [Inferred Config for Nx Monorepos](https://brianschiller.com/blog/2025/06/04/inferred-nx-config/) -- practical createNodesV2 example

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH -- all libraries verified from installed packages and official docs
- Architecture: HIGH -- Nx plugin API types read directly from node_modules, patterns confirmed by official docs
- Pitfalls: HIGH -- based on known Node.js/git/Nx behaviors and cross-platform issues
- Config validation: HIGH -- zod v4 API verified from official docs

**Research date:** 2026-03-10
**Valid until:** 2026-04-10 (stable domain, Nx 22.x is current)
