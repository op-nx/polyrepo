---
phase: quick-5
plan: 1
type: execute
wave: 1
depends_on: []
files_modified:
  - packages/op-nx-polyrepo/src/index.spec.ts
  - packages/op-nx-polyrepo/src/lib/graph/cache.spec.ts
  - packages/op-nx-polyrepo/src/lib/graph/transform.ts
  - nx.json
autonomous: true
requirements: [LINT-ZERO-WARNINGS]
must_haves:
  truths:
    - "npm run lint passes with zero warnings"
    - "All package.json scripts complete without errors"
  artifacts:
    - path: "nx.json"
      provides: "lint targetDefaults with --max-warnings=0"
      contains: "max-warnings"
  key_links:
    - from: "nx.json targetDefaults.lint"
      to: "@nx/eslint/plugin inferred lint target"
      via: "Nx target merging"
      pattern: "max-warnings"
---

<objective>
Add --max-warnings=0 enforcement to the lint pipeline and fix all 22 existing lint warnings so the check passes cleanly.

Purpose: Enforce zero-warning lint policy for CI readiness -- warnings that accumulate silently become tech debt.
Output: Zero-warning lint pass, all package.json scripts green.
</objective>

<execution_context>
@C:/Users/LarsGyrupBrinkNielse/.claude/get-shit-done/workflows/execute-plan.md
@C:/Users/LarsGyrupBrinkNielse/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@nx.json
@eslint.config.mjs
@packages/op-nx-polyrepo/src/index.spec.ts
@packages/op-nx-polyrepo/src/lib/graph/cache.spec.ts
@packages/op-nx-polyrepo/src/lib/graph/transform.ts
@package.json
</context>

<tasks>

<task type="auto">
  <name>Task 1: Fix all 22 lint warnings across 3 files</name>
  <files>packages/op-nx-polyrepo/src/index.spec.ts, packages/op-nx-polyrepo/src/lib/graph/cache.spec.ts, packages/op-nx-polyrepo/src/lib/graph/transform.ts</files>
  <action>
Fix 22 lint warnings in 3 files:

**src/index.spec.ts** (9 warnings -- @typescript-eslint/no-non-null-assertion):
- Lines 96, 98, 101, 105, 185, 189, 207, 227, 244: Replace non-null assertions (`foo!`) with proper null checks or type narrowing. For test assertions where the value is guaranteed to exist after prior assertions, use a local variable with a guard: `const val = result.thing; expect(val).toBeDefined(); // then use val directly`. Alternatively, if the test setup guarantees the value, cast or use `as` to satisfy the type system without `!`.

**src/lib/graph/cache.spec.ts** (12 warnings -- @typescript-eslint/no-unused-vars):
- Lines 40, 42-50: Mock variables (`mockExistsSync`, `mockExtract`, `mockTransform`, `mockGetHeadSha`, `mockGetDirtyFiles`, `mockNormalizeRepos`, `mockHashArray`, `mockReadJsonFile`, `mockWriteJsonFile`) and unused import (`PolyrepoGraphReport`) are declared but never used. These are vi.hoisted mock return values. If they are needed for mock control in tests, prefix with underscore AND configure eslint to allow underscore-prefixed unused vars. If they are truly unused (not referenced anywhere in the file), remove them.
- Lines 390, 416: `parts` destructured but never used -- prefix with underscore `_parts` or remove from destructuring.

**src/lib/graph/transform.ts** (1 warning -- @typescript-eslint/no-unused-vars):
- Line 52: `_workspaceRoot` parameter is unused. It is already underscore-prefixed but the default eslint config does not allow underscore-prefixed unused vars. Two options: (a) add `argsIgnorePattern: "^_"` to the no-unused-vars rule in eslint.config.mjs (PREFERRED -- this is a standard convention), or (b) remove the parameter if it is not part of a public API contract.

**Recommended approach for underscore pattern:** Add to eslint.config.mjs in the TypeScript files rules block:
```
'@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }]
```
This handles `_workspaceRoot` in transform.ts and allows prefixing unused mock variables with `_` in cache.spec.ts. This is the standard TypeScript convention.

After adding the eslint rule, prefix any remaining unused variables/params with `_` instead of deleting them (preserving intentional mock references and API signatures).

Run `npm exec nx lint @op-nx/polyrepo -- --max-warnings=0` after each file change to verify warnings are decreasing.
  </action>
  <verify>
    <automated>npm exec nx lint @op-nx/polyrepo -- --max-warnings=0</automated>
  </verify>
  <done>npm exec nx lint @op-nx/polyrepo -- --max-warnings=0 exits 0 with zero warnings</done>
</task>

<task type="auto">
  <name>Task 2: Add --max-warnings=0 to Nx lint configuration and verify all scripts</name>
  <files>nx.json</files>
  <action>
Add `--max-warnings=0` to the lint target so it applies workspace-wide without modifying each project individually.

In `nx.json`, add a `targetDefaults` entry for the `lint` target. Since the inferred target from @nx/eslint/plugin uses `nx:run-commands` with `command: "eslint ."`, override the command to append `--max-warnings=0`:

```json
"lint": {
  "command": "eslint . --max-warnings=0"
}
```

Add this inside the existing `targetDefaults` object in nx.json.

This means `npm run lint` (which runs `nx run-many -t lint`) will enforce zero warnings for all projects.

After configuring, run ALL package.json scripts to verify nothing is broken:
1. `npm run build` -- should pass
2. `npm run test` -- should pass
3. `npm run lint` -- should pass with zero warnings (NOTE: this runs against ALL projects including synced repos; if synced repos have warnings, scope to workspace projects only by updating the script to `nx run-many -t lint -p @op-nx/polyrepo` or accept that synced repo warnings are out of scope)
4. `npm run typecheck` -- should pass
5. `npm run format:check` -- should pass (format issues may need `npm run format` first)

If `npm run lint` fails because synced repo projects (nx/*) have warnings, that is expected and outside our control. In that case, verify that `npm exec nx lint @op-nx/polyrepo` passes with zero warnings, and note the synced repo situation.

Do NOT run `npm run e2e` (slow, requires build + verdaccio).
Do NOT run `npm run graph` (opens browser).
  </action>
  <verify>
    <automated>npm exec nx lint @op-nx/polyrepo -- --max-warnings=0 && npm run build && npm run test && npm run typecheck && npm run format:check</automated>
  </verify>
  <done>All package.json scripts pass. Lint enforces --max-warnings=0 via nx.json targetDefaults. Zero warnings for @op-nx/polyrepo.</done>
</task>

</tasks>

<verification>
- `npm exec nx lint @op-nx/polyrepo -- --max-warnings=0` exits 0
- `npm run build` exits 0
- `npm run test` exits 0
- `npm run typecheck` exits 0
- `npm run format:check` exits 0
- nx.json contains lint targetDefaults with --max-warnings=0
</verification>

<success_criteria>
- Zero lint warnings in @op-nx/polyrepo project
- --max-warnings=0 configured in nx.json targetDefaults for all lint targets
- All package.json scripts (build, test, lint, typecheck, format:check) pass without errors
</success_criteria>

<output>
After completion, create `.planning/quick/5-ci-check-add-max-warnings-0-to-the-lint-/5-SUMMARY.md`
</output>
