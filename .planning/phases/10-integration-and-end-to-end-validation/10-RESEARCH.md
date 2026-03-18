# Phase 10: Integration and End-to-End Validation - Research

**Researched:** 2026-03-18
**Domain:** Nx plugin integration wiring (`createDependencies`) + testcontainers e2e validation
**Confidence:** HIGH

## Summary

Phase 10 has two distinct work items: (1) wire the existing `detectCrossRepoDependencies` pure function into `createDependencies` in `index.ts`, and (2) write container-based e2e tests that verify cross-repo edges appear in the Nx project graph output. The wiring is mechanically simple -- a single function call insertion plus a spread into the return array. The e2e work is more substantial and involves extending the existing testcontainers test suite with three new test scenarios covering auto-detection, explicit overrides, and negation suppression.

The implementation is well-constrained by prior work. The `detectCrossRepoDependencies` function in `graph/detect.ts` is fully unit-tested (Phase 9) and returns `RawProjectGraphDependency[]`. The `createDependencies` hook in `index.ts` already has the `report`, `config`, and `context` objects available. The e2e infrastructure (Docker image, Verdaccio, snapshot image, testcontainers) is battle-tested from v1.0 with clear patterns for container setup, `nx.json` reconfiguration between tests, and assertion against Nx CLI output.

DETECT-07 (`nx affected` cross-repo) is explicitly deferred per user decision. The `.gitignore` filter in Nx core's `calculateFileChanges()` blocks `.repos/` paths from reaching the affected computation -- no plugin API exists to bypass this. Phase 10 only implements DETECT-06 (graph visualization).

**Primary recommendation:** One plan with two waves -- Wave 1 wires `detectCrossRepoDependencies` into `createDependencies` and adds a minimal integration test in `index.spec.ts`; Wave 2 adds three e2e test scenarios (auto-detection, overrides, negation) to the existing e2e spec file.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**E2e Fixture Topology**
- Reuse the existing nx monorepo as the external repo for cross-repo dep testing -- no new fixture repo needed
- The host workspace's root `package.json` already contains `@nx/*` dependencies/devDependencies -- these are the cross-repo dep targets. No manual dependency injection needed in test setup.
- The root workspace project (e.g., `@workspace/source`) is the dependency source; namespaced nx projects (e.g., `nx/devkit`) are the targets
- E2e coverage includes auto-detection, overrides, AND negation suppression -- three separate test scenarios with different `nx.json` plugin configurations
- Override test: configure `implicitDependencies` with an explicit edge between two projects, assert it appears in the graph
- Negation test: configure `implicitDependencies` with a `!` negation on an auto-detected edge, assert it is absent from the graph

**Graph Verification Method**
- Use `nx graph --print` to dump the full project graph as JSON to stdout inside the container
- Parse the JSON and assert specific edge objects: check `dependencies[sourceProject]` contains an entry with the expected `target` project name AND the correct `type` (`static` for auto-detected, `implicit` for overrides)
- Always pass `NX_DAEMON=false` when running graph commands in the container to avoid flaky daemon-not-ready failures on cold starts

**DETECT-07 Scoping**
- DETECT-07 (`nx affected` cross-repo) is deferred to a future milestone
- Root cause: Nx's `calculateFileChanges()` filters files through `.gitignore` before any file-to-project mapping -- `.repos/` is gitignored, so both `--files` and `--base/--head` are blind to synced repo changes
- What works: Cross-repo edge traversal is correct -- if Nx knows a project changed, it follows the edges. The gap is in the initial "which files changed" step.
- Future solution: A `polyrepo-affected` executor that runs `git -C .repos/<alias> diff --name-only`, maps changed files to namespaced projects, and delegates to `nx run-many --projects=<list>`

**Error Handling in createDependencies**
- Separate error paths for extraction vs. detection:
  - `populateGraphReport` failures: caught, return empty array (existing silent degradation pattern)
  - `detectCrossRepoDependencies` errors: not caught -- let validation errors (OVRD-03: unknown projects in overrides) propagate to Nx so users see a clear error message
- No additional defensive catch around `detectCrossRepoDependencies`
- The only throw path is OVRD-03 validation (`detect.ts:337`), which is intentionally loud per Phase 9 success criteria #5

### Claude's Discretion

- Graph verification method specifics (which `nx graph` subcommand/flags to use for JSON output)
- Test file organization (new spec file vs. extending existing `op-nx-polyrepo.spec.ts`)
- Which specific `@nx/*` packages to use as assertion targets in auto-detection tests
- Exact container setup sequence for override/negation test scenarios (how to reconfigure `nx.json` between tests)
- Edge deduplication strategy when intra-repo edges overlap with cross-repo edges

### Deferred Ideas (OUT OF SCOPE)

- Cross-repo `nx affected` support (DETECT-07) -- requires `polyrepo-affected` executor, deferred to future milestone
- Consumer-side tsconfig path resolution for cross-repo detection -- deferred to v1.2+
- Dependency edge type control on overrides -- default `implicit` for overrides, `static` for auto-detected
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| DETECT-06 | Cross-repo edges appear in `nx graph` visualization | Wire `detectCrossRepoDependencies` into `createDependencies`; verify via `nx graph --print` JSON output in e2e container |
| DETECT-07 | `nx affected` correctly traces changes across repo boundaries via cross-repo edges | **DEFERRED** to future milestone per CONTEXT.md. `.gitignore` filter in Nx core blocks `.repos/` paths. Graph edges are correct; gap is in initial touched-file detection. See `research-detect-07.md` for full analysis. |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@nx/devkit` | >=20.0.0 | `CreateDependencies`, `DependencyType`, `RawProjectGraphDependency` types | Nx plugin API surface for dependency registration |
| `vitest` | (workspace) | Unit + e2e test runner | Already in use for all project tests |
| `testcontainers` | (workspace) | Docker container lifecycle for e2e tests | Already established e2e infrastructure |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `minimatch` | ^10.0.0 | Glob matching for override patterns | Already a production dependency of `@op-nx/polyrepo` |
| `zod` | ^4.0.0 | Schema validation for JSON parsing | Already a production dependency |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `nx graph --print` for e2e | `nx show projects --json` | `--print` gives full graph with edges; `show projects` only gives project list, no dependency edges |
| Testcontainers snapshot | Fresh container per test | Snapshot avoids 2+ minute setup per test; already proven in v1.0 |

**Installation:**
No new dependencies needed. All libraries already in the workspace.

## Architecture Patterns

### Integration Wiring Point

The `createDependencies` hook in `index.ts` (lines 97-134) is the sole integration point. Currently it:
1. Validates config and populates graph report (lines 106-118)
2. Iterates `repoReport.dependencies` for intra-repo edges (lines 120-131)
3. Returns the collected dependencies array

Phase 10 inserts a step between 2 and 3:
```typescript
// After existing intra-repo edge collection...

// Phase 10: Detect cross-repo dependency edges
const crossRepoDeps = detectCrossRepoDependencies(report, config, context);
dependencies.push(...crossRepoDeps);

return dependencies;
```

Key design constraints:
- `detectCrossRepoDependencies` is called **outside** the extraction try/catch, so OVRD-03 validation errors propagate
- The function receives the already-validated `config` (from `validateConfig(options)`)
- The `context` parameter provides `context.projects` (merged graph) and `context.workspaceRoot`

### E2e Test Architecture

The existing e2e test in `op-nx-polyrepo.spec.ts` follows this pattern:
1. `globalSetup` builds Docker image, publishes plugin to Verdaccio, creates snapshot image
2. Each `describe` block starts a container from the snapshot image
3. Tests configure `nx.json` inside the container using `container.exec(['sh', '-c', 'cat > ...'])`
4. Tests run Nx commands via `container.exec(['npx', 'nx', ...])` and assert on stdout

Phase 10 adds a new `describe` block (or nested describe blocks) that:
1. Configures plugin with the `nx` repo (already prebaked as `/repos/nx` in Docker image)
2. Runs `polyrepo-sync` to clone the repo into `.repos/nx/`
3. Runs `npx nx graph --print` to get full graph JSON
4. Parses JSON and asserts cross-repo edges

For override/negation scenarios, the test modifies `nx.json` between assertions using the established `container.exec` pattern.

### Anti-Patterns to Avoid
- **Catching `detectCrossRepoDependencies` errors in `createDependencies`:** OVRD-03 errors must propagate. The extraction try/catch should NOT wrap detection.
- **Running `nx graph` with daemon in container:** Always `NX_DAEMON=false` (already set as ENV in Dockerfile, but good to verify).
- **Creating a new fixture repo for e2e:** The existing nrwl/nx repo prebaked in Docker provides all needed cross-repo targets.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| JSON output from `nx graph` | Custom graph serialization | `nx graph --print` | Standard Nx CLI output; tested and maintained by Nx team |
| Container setup/teardown | Manual Docker commands | testcontainers API + global-setup.ts | Existing infrastructure handles lifecycle, port mapping, cleanup |
| Edge type constants | String literals `"static"`, `"implicit"` | `DependencyType.static`, `DependencyType.implicit` | Type-safe enum from `@nx/devkit`; matches unit test expectations |
| JSON parsing in e2e assertions | Manual string matching on stdout | `JSON.parse()` on sanitized stdout | Robust; follows existing pattern from `op-nx-polyrepo.spec.ts` line 98 |

**Key insight:** The entire detection function is already built and tested. Phase 10 is pure integration glue and end-to-end validation -- no new algorithms or data structures needed.

## Common Pitfalls

### Pitfall 1: nx graph --print JSON extraction from stdout
**What goes wrong:** Nx prints warnings, version banners, or debug messages before/after the JSON output. Naive `JSON.parse(stdout)` fails.
**Why it happens:** Various Nx subsystems (daemon, plugin load, migration warnings) can write to stdout before the graph JSON.
**How to avoid:** Use the established pattern from `extract.ts`: find the first `{` character and parse from there. In e2e, use `const jsonStart = stdout.indexOf('{')` then `JSON.parse(stdout.substring(jsonStart))`.
**Warning signs:** `SyntaxError: Unexpected token` in JSON.parse during e2e tests.

### Pitfall 2: NX_DAEMON=false inside container
**What goes wrong:** First `nx graph --print` call times out or returns stale data because daemon is starting up.
**Why it happens:** Container may not have daemon disabled despite ENV setting; some Nx commands start daemon regardless.
**How to avoid:** The Dockerfile already sets `ENV NX_DAEMON=false`. Verify in test that the env var is set. If needed, pass it explicitly: `['sh', '-c', 'NX_DAEMON=false npx nx graph --print']`.
**Warning signs:** Flaky timeout failures on first graph command in a fresh container.

### Pitfall 3: Edge deduplication between intra-repo and cross-repo
**What goes wrong:** The same edge appears twice in the returned array -- once from `repoReport.dependencies` (intra-repo) and once from `detectCrossRepoDependencies` (cross-repo).
**Why it happens:** An edge between `nx/devkit` and `nx/jest` would appear in BOTH the intra-repo dependencies (from the nrwl/nx graph extraction) AND the cross-repo detection (if package.json deps match).
**How to avoid:** This is NOT a problem. The cross-repo detection function has a cross-repo guard (`sourceRepo === targetRepo` check at line 367) that prevents it from emitting intra-repo edges. The intra-repo edges come from `repoReport.dependencies` only. The two sets are disjoint by construction.
**Warning signs:** None -- this is handled by design.

### Pitfall 4: E2e test timeout on polyrepo-sync
**What goes wrong:** `polyrepo-sync` takes too long because pnpm install in the container downloads packages.
**Why it happens:** The Docker image prebakes `/repos/nx` with `pnpm install --frozen-lockfile`, warming the pnpm store. When sync clones to `/workspace/.repos/nx/`, `pnpm install` should resolve from cache. But if the store is not shared or the clone happens to a tmpfs mount, the store may not be accessible.
**How to avoid:** The existing e2e test at line 22 uses `.withTmpFs({ '/workspace/.repos': 'rw,exec,size=4g' })`. The pnpm store at `/repos/nx/node_modules/.pnpm` is separate from `/workspace/.repos/nx/`. The warm store is at the pnpm content-addressable location (typically `~/.local/share/pnpm/store`). Verify this works by checking the existing sync test (line 106-126) which already succeeds in ~120s.
**Warning signs:** pnpm install taking >60s in the container; `ENOENT` errors for packages.

### Pitfall 5: Asserting on specific namespaced project names
**What goes wrong:** Test expects `nx/devkit` but the project is named `nx/packages/devkit` or `nx/@nrwl/devkit`.
**Why it happens:** The namespacing uses `<alias>/<original-project-name>`. The original project name comes from the nrwl/nx workspace's project graph, which may not be `devkit` but rather the full package name.
**How to avoid:** After sync, first dump all project names with `nx show projects` (or from `nx graph --print` nodes) and identify the correct namespaced names before writing assertions. The existing status test (line 106-126) shows the pattern: sync first, then query.
**Warning signs:** Assertions failing with "expected array to contain object" but the project name is slightly different.

## Code Examples

### Wiring detectCrossRepoDependencies into createDependencies

Source: `packages/op-nx-polyrepo/src/index.ts` (current lines 97-134)

```typescript
import { detectCrossRepoDependencies } from './lib/graph/detect';

export const createDependencies: CreateDependencies<PolyrepoConfig> = async (
  options,
  context,
) => {
  const dependencies: RawProjectGraphDependency[] = [];

  // Defensive: re-populate in case createNodesV2 hasn't run yet
  let report: PolyrepoGraphReport | undefined;

  try {
    const config = validateConfig(options);
    const optionsHash = hashObject(options ?? {});

    report = await populateGraphReport(
      config,
      context.workspaceRoot,
      optionsHash,
    );

    // --- existing intra-repo edge collection ---
    for (const [, repoReport] of Object.entries(report.repos)) {
      for (const dep of repoReport.dependencies) {
        if (context.projects[dep.source] && context.projects[dep.target]) {
          dependencies.push({
            source: dep.source,
            target: dep.target,
            type: DependencyType.implicit,
          });
        }
      }
    }

    // --- Phase 10: cross-repo dependency detection ---
    // Called OUTSIDE the extraction try/catch so OVRD-03 validation errors propagate
    const crossRepoDeps = detectCrossRepoDependencies(report, config, context);
    dependencies.push(...crossRepoDeps);
  } catch {
    // If extraction fails, return no dependencies (degraded mode)
    return dependencies;
  }

  return dependencies;
};
```

**IMPORTANT:** The above example shows one approach where `detectCrossRepoDependencies` is INSIDE the existing try/catch. Per the user decision, OVRD-03 errors should propagate. The actual implementation must restructure the try/catch so that extraction errors are caught but detection errors propagate. The recommended pattern:

```typescript
export const createDependencies: CreateDependencies<PolyrepoConfig> = async (
  options,
  context,
) => {
  const dependencies: RawProjectGraphDependency[] = [];

  let report: PolyrepoGraphReport | undefined;
  let config: PolyrepoConfig;

  try {
    config = validateConfig(options);
    const optionsHash = hashObject(options ?? {});
    report = await populateGraphReport(config, context.workspaceRoot, optionsHash);
  } catch {
    return dependencies;
  }

  // Intra-repo edges (existing)
  for (const [, repoReport] of Object.entries(report.repos)) {
    for (const dep of repoReport.dependencies) {
      if (context.projects[dep.source] && context.projects[dep.target]) {
        dependencies.push({
          source: dep.source,
          target: dep.target,
          type: DependencyType.implicit,
        });
      }
    }
  }

  // Cross-repo edges (Phase 10) -- NOT wrapped in try/catch
  // OVRD-03 validation errors intentionally propagate to Nx
  const crossRepoDeps = detectCrossRepoDependencies(report, config, context);
  dependencies.push(...crossRepoDeps);

  return dependencies;
};
```

### E2e Pattern: Writing nx.json with plugin config inside container

Source: existing `op-nx-polyrepo.spec.ts` lines 45-73

```typescript
const nxJsonContent = JSON.stringify(
  {
    plugins: [
      {
        plugin: '@op-nx/polyrepo',
        options: {
          repos: {
            nx: { url: 'file:///repos/nx', depth: 1, ref: nxVersion },
          },
          // For override test:
          implicitDependencies: {
            '@workspace/source': ['nx/some-project'],
          },
        },
      },
    ],
  },
  null,
  2,
);

const { exitCode, output } = await container.exec(
  [
    'sh',
    '-c',
    `cat > /workspace/nx.json << 'NXJSONEOF'\n${nxJsonContent}\nNXJSONEOF`,
  ],
  { workingDir: '/workspace' },
);
```

### E2e Pattern: Running nx graph --print and parsing JSON

```typescript
const graphResult = await container.exec(
  ['npx', 'nx', 'graph', '--print'],
  { workingDir: '/workspace' },
);

expect(graphResult.exitCode).toBe(0);

const jsonStart = graphResult.stdout.indexOf('{');
const graphJson = JSON.parse(graphResult.stdout.substring(jsonStart));

// Assert cross-repo edge exists
const sourceDeps = graphJson.graph.dependencies['@workspace/source'] ?? [];
const crossRepoEdge = sourceDeps.find(
  (d: { target: string }) => d.target === 'nx/devkit',
);

expect(crossRepoEdge).toBeDefined();
expect(crossRepoEdge.type).toBe('static');
```

### Integration Test Pattern: index.spec.ts with detect wiring

```typescript
// Add vi.mock for detect module
vi.mock('./lib/graph/detect', () => ({
  detectCrossRepoDependencies: vi.fn(),
}));

import { detectCrossRepoDependencies } from './lib/graph/detect';

// In test:
const mockedDetect = vi.mocked(detectCrossRepoDependencies);
mockedDetect.mockReturnValue([
  { source: 'host-app', target: 'repo-a/lib', type: DependencyType.static },
]);

const deps = await createDependencies(options, depContext);

expect(mockedDetect).toHaveBeenCalledOnce();
expect(deps).toContainEqual(
  expect.objectContaining({ source: 'host-app', target: 'repo-a/lib' }),
);
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Intra-repo edges only | Intra-repo + cross-repo edges | Phase 10 (now) | `nx graph` shows full dependency picture across repo boundaries |
| Manual override only | Auto-detection + overrides + negation | Phase 9 | Users get edges automatically from package.json/tsconfig |

**Deprecated/outdated:**
- None relevant. The Nx plugin API (`createDependencies`, `RawProjectGraphDependency`, `DependencyType`) is stable across Nx 20-22.

## Open Questions

1. **Which specific nrwl/nx project names will be available in the container?**
   - What we know: nrwl/nx has 100+ projects. After sync, they appear as `nx/<original-name>` in the host graph.
   - What's unclear: The exact project names depend on the nrwl/nx project graph at the pinned ref (22.5.4). Common ones include projects like `nx/devkit`, `nx/nx`, etc.
   - Recommendation: After sync in the first e2e test, dump all project names with `nx show projects --json` and identify which ones are declared as dependencies in the host workspace's root `package.json`. Use those as assertion targets. Alternatively, just assert that at least N cross-repo edges exist from `@workspace/source` without hardcoding specific target names.

2. **Edge type in `nx graph --print` output: string literal or enum value?**
   - What we know: `DependencyType.static` is the string `"static"` at runtime. `DependencyType.implicit` is `"implicit"`.
   - What's unclear: Whether `nx graph --print` serializes the enum value or a different representation.
   - Recommendation: The Zod schema in `types.ts` validates type as `z.string()`. The `--print` output uses string literals (`"static"`, `"implicit"`, `"dynamic"`). Assertions should use string comparisons.

3. **Will the existing `polyrepo-sync` e2e test (line 106-126) have already synced the repo before cross-repo tests run?**
   - What we know: Vitest runs tests in file order within a file, and `describe` blocks run in order.
   - What's unclear: Whether to reuse the already-synced state or create a fresh container.
   - Recommendation: The existing tests use `beforeAll` at the describe level. The sync happens in the `polyrepo-status` describe block. Cross-repo tests could be in the same describe (reusing the synced state) or in a new describe with their own sync call. Using the same describe avoids a redundant 120s sync but couples tests. A new describe with its own container is cleaner for isolation. Decision is Claude's discretion per CONTEXT.md.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (workspace version) |
| Config file | `packages/op-nx-polyrepo-e2e/vitest.config.mts` (e2e) and `packages/op-nx-polyrepo/vitest.config.mts` (unit) |
| Quick run command | `npm exec nx test @op-nx/polyrepo --output-style=static` |
| Full suite command | `npm exec nx run-many -t test,e2e --output-style=static` |

### Phase Requirements -> Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DETECT-06 | Cross-repo edges from `createDependencies` wiring | unit | `npm exec nx test @op-nx/polyrepo --output-style=static -- --run -t "createDependencies"` | Partial -- `index.spec.ts` exists, needs new tests for detect wiring |
| DETECT-06 | Auto-detected cross-repo edges in `nx graph --print` | e2e | `npm exec nx e2e op-nx-polyrepo-e2e --output-style=static` | No -- new e2e tests needed |
| DETECT-06 | Override edges in `nx graph --print` | e2e | `npm exec nx e2e op-nx-polyrepo-e2e --output-style=static` | No -- new e2e tests needed |
| DETECT-06 | Negation suppression in `nx graph --print` | e2e | `npm exec nx e2e op-nx-polyrepo-e2e --output-style=static` | No -- new e2e tests needed |

### Sampling Rate
- **Per task commit:** `npm exec nx test @op-nx/polyrepo --output-style=static`
- **Per wave merge:** `npm exec nx run-many -t test,lint --output-style=static`
- **Phase gate:** `npm exec nx run-many -t test,lint,e2e --output-style=static` (full suite green before `/gsd:verify-work`)

### Wave 0 Gaps
- [ ] Integration tests in `index.spec.ts` for `detectCrossRepoDependencies` wiring -- 3+ new tests covering: happy path (detect returns edges), detect error propagation (OVRD-03), empty report (no edges)
- [ ] E2e tests in `op-nx-polyrepo.spec.ts` for cross-repo graph validation -- 3 new test scenarios for auto-detection, override, negation
- No framework install needed -- all test infrastructure exists

## Sources

### Primary (HIGH confidence)
- `packages/op-nx-polyrepo/src/index.ts` -- current `createDependencies` implementation (lines 97-134)
- `packages/op-nx-polyrepo/src/lib/graph/detect.ts` -- full `detectCrossRepoDependencies` function (514 lines)
- `packages/op-nx-polyrepo/src/index.spec.ts` -- existing `createDependencies` unit tests (490 lines)
- `packages/op-nx-polyrepo-e2e/src/op-nx-polyrepo.spec.ts` -- existing e2e test patterns (128 lines)
- `packages/op-nx-polyrepo-e2e/src/setup/global-setup.ts` -- testcontainers lifecycle (180 lines)
- `packages/op-nx-polyrepo-e2e/docker/Dockerfile` -- container image definition (41 lines)
- `.planning/phases/10-integration-and-end-to-end-validation/research-detect-07.md` -- DETECT-07 analysis

### Secondary (MEDIUM confidence)
- `nx graph --help` output -- verified `--print` flag for JSON stdout output
- `@nx/devkit` type exports -- `RawProjectGraphDependency`, `DependencyType`, `CreateDependencies`

### Tertiary (LOW confidence)
- None -- all findings verified against source code

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH -- no new libraries, all existing infrastructure
- Architecture: HIGH -- single function call insertion, established e2e patterns
- Pitfalls: HIGH -- patterns verified against existing codebase and prior phase execution

**Research date:** 2026-03-18
**Valid until:** 2026-04-18 (stable -- Nx plugin API and testcontainers are mature)
