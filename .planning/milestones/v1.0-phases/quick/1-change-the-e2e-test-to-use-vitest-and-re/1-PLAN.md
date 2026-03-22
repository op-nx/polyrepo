---
phase: quick
plan: 1
type: execute
wave: 1
depends_on: []
files_modified:
  - packages/nx-openpolyrepo-e2e/vitest.config.mts
  - packages/nx-openpolyrepo-e2e/package.json
  - packages/nx-openpolyrepo-e2e/tsconfig.spec.json
  - packages/nx-openpolyrepo-e2e/src/nx-openpolyrepo.spec.ts
  - tools/scripts/start-local-registry.ts
  - tools/scripts/stop-local-registry.ts
  - tools/scripts/registry.d.ts
  - nx.json
  - package.json
autonomous: true
requirements: []

must_haves:
  truths:
    - 'E2e tests run via Vitest and pass'
    - 'No Jest configuration, dependencies, or tooling remains in the workspace'
    - 'Local registry setup/teardown works with Vitest globalSetup'
  artifacts:
    - path: 'packages/nx-openpolyrepo-e2e/vitest.config.mts'
      provides: 'Vitest config for e2e with globalSetup/globalTeardown'
    - path: 'packages/nx-openpolyrepo-e2e/package.json'
      provides: 'e2e target using Vitest executor'
  key_links:
    - from: 'packages/nx-openpolyrepo-e2e/vitest.config.mts'
      to: 'tools/scripts/start-local-registry.ts'
      via: 'globalSetup'
      pattern: 'globalSetup.*start-local-registry'
---

<objective>
Migrate the e2e test project from Jest to Vitest and remove all Jest tooling from the workspace.

Purpose: The workspace already uses Vitest for unit tests. The e2e project is the sole remaining Jest consumer. Unifying on Vitest eliminates dual test-runner complexity, removes unused dependencies, and simplifies configuration.
Output: E2e tests running on Vitest, all Jest artifacts deleted.
</objective>

<execution_context>
@C:/Users/LarsGyrupBrinkNielse/.claude/get-shit-done/workflows/execute-plan.md
@C:/Users/LarsGyrupBrinkNielse/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@packages/nx-openpolyrepo/vitest.config.mts (reference Vitest config pattern)
@packages/nx-openpolyrepo-e2e/jest.config.cts (current Jest config to replace)
@packages/nx-openpolyrepo-e2e/package.json (e2e target definition)
@packages/nx-openpolyrepo-e2e/src/nx-openpolyrepo.spec.ts (e2e test file)
@tools/scripts/start-local-registry.ts (globalSetup script)
@tools/scripts/stop-local-registry.ts (globalTeardown script)
@nx.json (plugins array)
@package.json (root devDependencies)
</context>

<tasks>

<task type="auto">
  <name>Task 1: Create Vitest config and update e2e project target</name>
  <files>
    packages/nx-openpolyrepo-e2e/vitest.config.mts,
    packages/nx-openpolyrepo-e2e/package.json,
    packages/nx-openpolyrepo-e2e/tsconfig.spec.json,
    packages/nx-openpolyrepo-e2e/src/nx-openpolyrepo.spec.ts,
    tools/scripts/start-local-registry.ts,
    tools/scripts/stop-local-registry.ts,
    tools/scripts/registry.d.ts
  </files>
  <action>
1. Create `packages/nx-openpolyrepo-e2e/vitest.config.mts` modeled after `packages/nx-openpolyrepo/vitest.config.mts`:
   - `root: __dirname`
   - `cacheDir: '../../node_modules/.vite/packages/nx-openpolyrepo-e2e'`
   - `test.name: 'nx-openpolyrepo-e2e'`
   - `test.watch: false`
   - `test.globals: true`
   - `test.environment: 'node'`
   - `test.include: ['{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}']`
   - `test.reporters: ['default']`
   - `test.testTimeout: 300_000` (e2e tests are slow -- creating Nx workspaces, publishing to Verdaccio)
   - `test.globalSetup: ['../../tools/scripts/start-local-registry.ts']`
   - `test.globalTeardown: ['../../tools/scripts/stop-local-registry.ts']`
   - `test.coverage.reportsDirectory: './test-output/vitest/coverage'`
   - `test.coverage.provider: 'v8'`
   - `test.pool: 'forks'` and `test.poolOptions.forks.singleFork: true` (equivalent to Jest's `runInBand` -- e2e tests must run serially since they share a single Verdaccio registry)

2. Update `packages/nx-openpolyrepo-e2e/package.json`:
   - Change `targets.e2e.executor` from `"@nx/jest:jest"` to `"@nx/vite:test"`
   - Change `targets.e2e.outputs` from `["{projectRoot}/test-output/jest/coverage"]` to `["{projectRoot}/test-output/vitest/coverage"]`
   - Change `targets.e2e.options` to `{ "configFile": "packages/nx-openpolyrepo-e2e/vitest.config.mts" }` (remove `jestConfig` and `runInBand`)
   - Keep `dependsOn: ["^build"]`

3. Update `packages/nx-openpolyrepo-e2e/tsconfig.spec.json`:
   - Change `compilerOptions.outDir` from `"./out-tsc/jest"` to `"./out-tsc/vitest"`
   - Remove `"module": "commonjs"` and `"moduleResolution": "node10"` (Vitest uses native ESM)
   - Change `"types"` from `["jest", "node"]` to `["vitest/globals", "node"]`
   - Update `include` array: remove `"jest.config.ts"` and `"jest.config.cts"`, add `"vitest.config.mts"`

4. Update `packages/nx-openpolyrepo-e2e/src/nx-openpolyrepo.spec.ts`:
   - Replace the `require.resolve('create-nx-workspace/package.json')` block with a dynamic `import()` or ESM-compatible approach. Since Vitest runs ESM, use `import { createRequire } from 'module'` then `const require = createRequire(import.meta.url)` to keep `require.resolve` working.
   - Add `import { describe, it, expect, beforeAll, afterAll } from 'vitest'` at the top (even though globals are enabled, explicit imports are cleaner and make the file self-documenting).

5. Update `tools/scripts/start-local-registry.ts`:
   - Change the import from `'@nx/js/plugins/jest/local-registry'` to a direct require using `createRequire` from `'module'`, OR keep the import as-is since the function itself has no Jest dependency (it just forks nx and sets npm registry env vars). The path `@nx/js/plugins/jest/local-registry` is stable and works regardless of test runner.
   - Actually, keep the import path unchanged -- it works and is the official API. Just update the JSDoc comment from "jest's globalSetup" to "Vitest globalSetup".
   - The `global.stopLocalRegistry` pattern works in Vitest globalSetup/globalTeardown because Vitest shares the global scope between them when using the same file or when globalSetup returns a teardown function. PREFERRED approach: change to Vitest's idiomatic pattern where globalSetup exports a default function that RETURNS a teardown function (instead of setting `global.stopLocalRegistry`). This way `stop-local-registry.ts` is no longer needed as a separate file.
   - Refactor: Make the default export return the `stopLocalRegistry` function directly:
     ```typescript
     export default async () => {
       // ... existing setup code ...
       global.stopLocalRegistry = await startLocalRegistry({...});
       // ... release version/publish ...
       return () => { global.stopLocalRegistry(); };
     };
     ```
   - This works with Vitest's globalSetup: when the returned function exists, Vitest calls it as teardown.

6. Update `tools/scripts/stop-local-registry.ts`:
   - Update the JSDoc comment from "jest's globalTeardown" to "Vitest globalTeardown".
   - Keep this file as a fallback, but it can be removed from vitest.config.mts `globalTeardown` if start-local-registry.ts returns a teardown function. Decision: keep `globalTeardown` pointing to this file for now -- it is a safety net and the dual-teardown (return value + globalTeardown) is harmless (stopLocalRegistry is idempotent after process is killed).

7. Delete Jest-specific files from the e2e project:
   - Delete `packages/nx-openpolyrepo-e2e/jest.config.cts`
   - Delete `packages/nx-openpolyrepo-e2e/.spec.swcrc`
     </action>
     <verify>
     <automated>npx nx run nx-openpolyrepo-e2e:e2e --verbose</automated>
     </verify>
     <done>E2e tests pass using Vitest. Jest config files deleted from e2e project. The e2e target uses @nx/vite:test executor.</done>
     </task>

<task type="auto">
  <name>Task 2: Remove all Jest tooling from the workspace</name>
  <files>
    nx.json,
    package.json,
    jest.config.ts,
    jest.preset.js
  </files>
  <action>
1. Delete root Jest configuration files:
   - Delete `jest.config.ts` (root multi-project Jest config -- no longer needed)
   - Delete `jest.preset.js` (Jest preset using @nx/jest -- no longer needed)

2. Update `nx.json`:
   - Remove the `@nx/jest/plugin` entry from the `plugins` array (the entry at index 4 with `"plugin": "@nx/jest/plugin"`)
   - Remove Jest-related entries from `namedInputs.production`: remove `"!{projectRoot}/jest.config.[jt]s"` (line containing `jest.config`)
   - Keep all other plugins and config unchanged

3. Update root `package.json` -- remove these Jest-related devDependencies:
   - `@swc/jest`
   - `@types/jest`
   - `jest`
   - `jest-environment-jsdom`
   - `jest-util`
   - `ts-jest`
   - `@nx/jest`
     Also remove `ts-node` -- it was only needed for Jest's TypeScript config loading (jest.config.cts). Vitest handles TypeScript natively. Verify no other config references ts-node before removing.

4. Run `npm install` to update the lockfile after removing dependencies.

NOTE: Keep `@swc-node/register`, `@swc/cli`, `@swc/core`, `@swc/helpers` -- these are used by the build toolchain (esbuild plugin or other non-Jest purposes), not exclusively by Jest. Verify by checking if they appear in non-Jest configs before removing. They are used by `@nx/js` for TypeScript registration.
</action>
<verify>
<automated>npx nx run nx-openpolyrepo-e2e:e2e --verbose && git grep -l "jest" -- "_.config._" "_.preset._" && echo "FAIL: Jest config files still exist" || echo "OK: No Jest config files remain"</automated>
</verify>
<done>No Jest dependencies in package.json. No Jest config files in workspace root. No @nx/jest/plugin in nx.json. E2e tests still pass after cleanup. npm install completes without errors.</done>
</task>

</tasks>

<verification>
1. `npx nx run nx-openpolyrepo-e2e:e2e` passes
2. `npx nx run nx-openpolyrepo:test` still passes (unit tests unaffected)
3. No files named `jest.config.*`, `jest.preset.*`, or `.spec.swcrc` exist in the workspace
4. `git grep -c "@nx/jest" -- nx.json` returns 0 matches
5. `git grep -c "\"jest\"" -- package.json` returns 0 matches (no jest in root devDependencies)
</verification>

<success_criteria>

- E2e tests run and pass using Vitest via `npx nx run nx-openpolyrepo-e2e:e2e`
- Unit tests still pass via `npx nx run nx-openpolyrepo:test`
- Zero Jest-related devDependencies remain in root package.json
- Zero Jest configuration files remain anywhere in workspace
- @nx/jest/plugin removed from nx.json plugins array
  </success_criteria>

<output>
After completion, create `.planning/quick/1-change-the-e2e-test-to-use-vitest-and-re/1-SUMMARY.md`
</output>
