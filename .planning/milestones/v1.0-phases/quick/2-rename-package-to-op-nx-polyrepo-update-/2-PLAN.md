---
phase: quick-2
plan: 1
type: execute
wave: 1
depends_on: []
files_modified:
  # Task 1: Nx move generator renames directories + updates tsconfig paths
  - packages/op-nx-polyrepo/package.json
  - packages/op-nx-polyrepo/README.md
  - packages/op-nx-polyrepo/tsconfig.lib.json
  - packages/op-nx-polyrepo/vitest.config.mts
  - packages/op-nx-polyrepo-e2e/package.json
  - packages/op-nx-polyrepo-e2e/vitest.config.mts
  - packages/op-nx-polyrepo-e2e/src/op-nx-polyrepo.spec.ts
  - tsconfig.json
  - tsconfig.base.json
  # Task 2: String replacements in source, config, and root files
  - package.json
  - nx.json
  - packages/op-nx-polyrepo/src/index.ts
  - packages/op-nx-polyrepo/src/index.spec.ts
  - packages/op-nx-polyrepo/src/lib/config/validate.ts
  - packages/op-nx-polyrepo/src/lib/executors/status/executor.ts
  - packages/op-nx-polyrepo/src/lib/executors/status/executor.spec.ts
  - packages/op-nx-polyrepo/src/lib/executors/sync/executor.ts
  - packages/op-nx-polyrepo/src/lib/executors/sync/executor.spec.ts
  - tools/scripts/start-local-registry.ts
  - README.md
  - package-lock.json
autonomous: true
requirements: []
must_haves:
  truths:
    - "Package publishes as @op-nx/polyrepo (npm name)"
    - "Plugin registers in nx.json as @op-nx/polyrepo"
    - "Executor references use @op-nx/polyrepo:sync and @op-nx/polyrepo:status"
    - "Root package.json name is @op-nx/source"
    - "README title is OpNx Polyrepo"
    - "All tests pass after rename"
    - "Build succeeds after rename"
  artifacts:
    - path: "packages/op-nx-polyrepo/package.json"
      provides: "Plugin package with name @op-nx/polyrepo"
      contains: '"name": "@op-nx/polyrepo"'
    - path: "packages/op-nx-polyrepo-e2e/package.json"
      provides: "E2E test package"
      contains: "op-nx-polyrepo-e2e"
    - path: "nx.json"
      provides: "Plugin registration"
      contains: '"plugin": "@op-nx/polyrepo"'
  key_links:
    - from: "packages/op-nx-polyrepo/src/index.ts"
      to: "packages/op-nx-polyrepo/executors.json"
      via: "executor string references"
      pattern: "@op-nx/polyrepo:(sync|status)"
    - from: "nx.json"
      to: "packages/op-nx-polyrepo"
      via: "plugin registration"
      pattern: '"plugin": "@op-nx/polyrepo"'
---

<objective>
Rename the package from `nx-openpolyrepo` to `@op-nx/polyrepo` across the entire workspace. This includes moving project directories, updating all string references in source code, configurations, tests, and documentation. Update the README title to "OpNx Polyrepo".

Purpose: Rebrand the package to the `@op-nx` npm scope with a cleaner name.
Output: Fully renamed workspace where build and all tests pass.
</objective>

<execution_context>
@C:/Users/LarsGyrupBrinkNielse/.claude/get-shit-done/workflows/execute-plan.md
@C:/Users/LarsGyrupBrinkNielse/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md

## Rename mapping

The following renames apply throughout the codebase:

| Old value | New value | Where |
|-----------|-----------|-------|
| `nx-openpolyrepo` (npm package name) | `@op-nx/polyrepo` | plugin package.json `name`, all executor strings, nx.json plugin registration, e2e install commands, npm ls checks |
| `@nx-openpolyrepo/source` (root package name) | `@op-nx/source` | root package.json `name`, `tools/scripts/start-local-registry.ts` target |
| `@nx-openpolyrepo/source` (custom condition) | `@op-nx/source` | `tsconfig.base.json` customConditions, plugin package.json exports condition |
| `nx-openpolyrepo-e2e` (e2e package name) | `op-nx-polyrepo-e2e` | e2e package.json `name` |
| `packages/nx-openpolyrepo` (directory) | `packages/op-nx-polyrepo` | all path references |
| `packages/nx-openpolyrepo-e2e` (directory) | `packages/op-nx-polyrepo-e2e` | all path references |
| `Nx OpenPolyrepo` (README title) | `OpNx Polyrepo` | root README.md |

**Important:** The Nx `@nx/workspace:move` generator handles directory moves and updates tsconfig references, but it does NOT update string literals inside source code. Task 2 handles all remaining string replacements after the move.

## Files requiring string replacement (post-move)

These files contain hardcoded `nx-openpolyrepo` string literals that the Nx move generator will NOT update:

**Source code:**
- `packages/op-nx-polyrepo/src/index.ts` — executor strings `nx-openpolyrepo:sync`, `nx-openpolyrepo:status`
- `packages/op-nx-polyrepo/src/index.spec.ts` — same executor strings in test assertions
- `packages/op-nx-polyrepo/src/lib/config/validate.ts` — error message string
- `packages/op-nx-polyrepo/src/lib/executors/status/executor.ts` — plugin lookup `p.plugin === 'nx-openpolyrepo'`
- `packages/op-nx-polyrepo/src/lib/executors/status/executor.spec.ts` — plugin lookup in test fixtures
- `packages/op-nx-polyrepo/src/lib/executors/sync/executor.ts` — plugin lookup `p.plugin === 'nx-openpolyrepo'`
- `packages/op-nx-polyrepo/src/lib/executors/sync/executor.spec.ts` — plugin lookup in test fixtures

**Config and root files:**
- `nx.json` — `"plugin": "nx-openpolyrepo"` registration
- `package.json` — root package name `@nx-openpolyrepo/source`
- `tsconfig.base.json` — customConditions `@nx-openpolyrepo/source`
- `tools/scripts/start-local-registry.ts` — target string `@nx-openpolyrepo/source:local-registry`
- `README.md` — title

**E2E test:**
- `packages/op-nx-polyrepo-e2e/src/op-nx-polyrepo.spec.ts` (renamed by generator) — install commands, npm ls, describe block, plugin lookups, temp dir prefix
</context>

<tasks>

<task type="auto">
  <name>Task 1: Move projects using Nx move generator</name>
  <files>
    packages/op-nx-polyrepo/package.json,
    packages/op-nx-polyrepo-e2e/package.json,
    tsconfig.json
  </files>
  <action>
    Use the Nx `@nx/workspace:move` generator to rename both projects. Check `npx nx g @nx/workspace:move --help` first to confirm exact flags.

    1. Move the plugin project:
       ```
       npx nx g @nx/workspace:move --project=nx-openpolyrepo --destination=op-nx-polyrepo --import-path=@op-nx/polyrepo --no-interactive
       ```
       This should move `packages/nx-openpolyrepo` to `packages/op-nx-polyrepo` and update tsconfig references.

    2. Move the e2e project:
       ```
       npx nx g @nx/workspace:move --project=nx-openpolyrepo-e2e --destination=op-nx-polyrepo-e2e --import-path=op-nx-polyrepo-e2e --no-interactive
       ```

    3. After both moves, verify the old directories no longer exist and the new directories do exist.

    4. If the generator does NOT handle the e2e spec file rename (from `nx-openpolyrepo.spec.ts` to `op-nx-polyrepo.spec.ts`), rename it manually with `git mv`.

    5. Inspect the generated changes. The move generator may or may not update all path references correctly. Check:
       - `tsconfig.json` project references point to new paths
       - New `package.json` files have correct names
       - `vitest.config.mts` files have updated cache/name values
       - `tsconfig.lib.json` has updated outDir/tsBuildInfoFile paths

    If the generator leaves stale references, fix them manually. The generator is a starting point, not the final word.
  </action>
  <verify>
    <automated>ls packages/op-nx-polyrepo/package.json packages/op-nx-polyrepo-e2e/package.json 2>&1 && echo "--- old dirs ---" && ls packages/nx-openpolyrepo/package.json packages/nx-openpolyrepo-e2e/package.json 2>&1 || echo "[OK] Old directories removed"</automated>
  </verify>
  <done>Projects moved to packages/op-nx-polyrepo and packages/op-nx-polyrepo-e2e. Old directories gone. tsconfig references updated.</done>
</task>

<task type="auto">
  <name>Task 2: Replace all remaining string references and update documentation</name>
  <files>
    packages/op-nx-polyrepo/src/index.ts,
    packages/op-nx-polyrepo/src/index.spec.ts,
    packages/op-nx-polyrepo/src/lib/config/validate.ts,
    packages/op-nx-polyrepo/src/lib/executors/status/executor.ts,
    packages/op-nx-polyrepo/src/lib/executors/status/executor.spec.ts,
    packages/op-nx-polyrepo/src/lib/executors/sync/executor.ts,
    packages/op-nx-polyrepo/src/lib/executors/sync/executor.spec.ts,
    packages/op-nx-polyrepo-e2e/src/op-nx-polyrepo.spec.ts,
    nx.json,
    package.json,
    tsconfig.base.json,
    tools/scripts/start-local-registry.ts,
    README.md
  </files>
  <action>
    Replace all remaining `nx-openpolyrepo` and `@nx-openpolyrepo` string references that the move generator did not handle. Work through each file systematically.

    **IMPORTANT:** Do NOT blindly find-and-replace. Each file has specific substitutions:

    1. **Root `package.json`**: Change `"name": "@nx-openpolyrepo/source"` to `"name": "@op-nx/source"`.

    2. **`nx.json`**: Change `"plugin": "nx-openpolyrepo"` to `"plugin": "@op-nx/polyrepo"`.

    3. **`tsconfig.base.json`**: Change `"@nx-openpolyrepo/source"` to `"@op-nx/source"` in customConditions.

    4. **`tools/scripts/start-local-registry.ts`**: Change `'@nx-openpolyrepo/source:local-registry'` to `'@op-nx/source:local-registry'`.

    5. **`README.md`**: Change title from `# Nx OpenPolyrepo` to `# OpNx Polyrepo`.

    6. **`packages/op-nx-polyrepo/src/index.ts`**: Change both executor strings:
       - `'nx-openpolyrepo:sync'` to `'@op-nx/polyrepo:sync'`
       - `'nx-openpolyrepo:status'` to `'@op-nx/polyrepo:status'`

    7. **`packages/op-nx-polyrepo/src/index.spec.ts`**: Same executor string changes in test assertions.

    8. **`packages/op-nx-polyrepo/src/lib/config/validate.ts`**: Change error message from `Invalid nx-openpolyrepo config` to `Invalid @op-nx/polyrepo config`.

    9. **`packages/op-nx-polyrepo/src/lib/executors/status/executor.ts`**: Change `p.plugin === 'nx-openpolyrepo'` to `p.plugin === '@op-nx/polyrepo'`.

    10. **`packages/op-nx-polyrepo/src/lib/executors/status/executor.spec.ts`**: Change plugin fixture string from `'nx-openpolyrepo'` to `'@op-nx/polyrepo'`.

    11. **`packages/op-nx-polyrepo/src/lib/executors/sync/executor.ts`**: Change `p.plugin === 'nx-openpolyrepo'` to `p.plugin === '@op-nx/polyrepo'`.

    12. **`packages/op-nx-polyrepo/src/lib/executors/sync/executor.spec.ts`**: Change plugin fixture string from `'nx-openpolyrepo'` to `'@op-nx/polyrepo'`.

    13. **`packages/op-nx-polyrepo-e2e/src/op-nx-polyrepo.spec.ts`**: Multiple changes:
        - describe block: `'nx-openpolyrepo'` to `'@op-nx/polyrepo'`
        - npm install: `npm install -D nx-openpolyrepo@e2e` to `npm install -D @op-nx/polyrepo@e2e`
        - npm ls: `npm ls nx-openpolyrepo` to `npm ls @op-nx/polyrepo`
        - executor assertion: `'nx-openpolyrepo:status'` to `'@op-nx/polyrepo:status'`
        - plugin filter: `.plugin === 'nx-openpolyrepo'` to `.plugin === '@op-nx/polyrepo'`
        - plugin push: `plugin: 'nx-openpolyrepo'` to `plugin: '@op-nx/polyrepo'`
        - mkdtempSync prefix: `'nx-openpolyrepo-e2e-'` to `'op-nx-polyrepo-e2e-'`

    14. **`packages/op-nx-polyrepo/package.json`**: If the move generator set the name to something other than `@op-nx/polyrepo`, fix it. Also update the exports condition from `@nx-openpolyrepo/source` to `@op-nx/source`. Verify all path references in build options point to `packages/op-nx-polyrepo`.

    15. **`packages/op-nx-polyrepo-e2e/package.json`**: Verify implicitDependencies changed from `nx-openpolyrepo` to `@op-nx/polyrepo` (the Nx project name, which after move should be `op-nx-polyrepo`). Check sourceRoot path.

    16. After all changes, run `npm install` to regenerate `package-lock.json` with the new package names.

    17. Verify no remaining references: run `git grep "nx-openpolyrepo"` and confirm ONLY `.planning/` files match (those are historical and should NOT be changed).
  </action>
  <verify>
    <automated>npx nx run-many -t build,test --projects=op-nx-polyrepo 2>&1 | tail -20</automated>
  </verify>
  <done>Zero occurrences of "nx-openpolyrepo" outside .planning/ directory. Build and unit tests pass. README title is "OpNx Polyrepo".</done>
</task>

</tasks>

<verification>
1. `git grep "nx-openpolyrepo" -- ':!.planning/'` returns zero results
2. `npx nx run-many -t build,test --projects=op-nx-polyrepo` passes
3. `npx nx show project op-nx-polyrepo --json` shows the project exists
4. `npx nx show project op-nx-polyrepo-e2e --json` shows the e2e project exists
5. README.md title is "# OpNx Polyrepo"
</verification>

<success_criteria>
- All references to `nx-openpolyrepo` replaced with `@op-nx/polyrepo` (package name) or `op-nx-polyrepo` (directory/project name) or `@op-nx/source` (root package/condition)
- Project directories are `packages/op-nx-polyrepo` and `packages/op-nx-polyrepo-e2e`
- `npx nx run-many -t build,test` passes for the renamed project
- README title reads "OpNx Polyrepo"
- No stale references outside .planning/ directory
</success_criteria>

<output>
After completion, create `.planning/quick/2-rename-package-to-op-nx-polyrepo-update-/2-SUMMARY.md`
</output>
