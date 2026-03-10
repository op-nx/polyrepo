---
phase: quick-4
plan: 01
type: execute
wave: 1
depends_on: []
files_modified: []
autonomous: true
requirements: [QUICK-4]
must_haves:
  truths:
    - 'All npm scripts in package.json run without errors'
    - 'Build, test, lint, typecheck, format, and format:check complete successfully'
    - 'E2e tests pass'
  artifacts: []
  key_links: []
---

<objective>
Run every npm script defined in the workspace root package.json and fix any errors encountered.

Purpose: Validate the workspace is healthy after prior quick tasks (vitest migration, package rename, script additions).
Output: All scripts passing, any fixes committed.
</objective>

<execution_context>
@C:/Users/LarsGyrupBrinkNielse/.claude/get-shit-done/workflows/execute-plan.md
@C:/Users/LarsGyrupBrinkNielse/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@package.json
</context>

<tasks>

<task type="auto">
  <name>Task 1: Run non-interactive scripts and collect results</name>
  <files></files>
  <action>
Run each of the following npm scripts one at a time, capturing exit codes and output. Run them in this order (fastest feedback first):

1. `npm run format:check` -- checks formatting without modifying files
2. `npm run lint` -- runs ESLint across all projects
3. `npm run typecheck` -- runs TypeScript type checking across all projects
4. `npm run build` -- builds all projects
5. `npm run test` -- runs unit tests across all projects
6. `npm run format` -- applies formatting (run after format:check to see if fixes are needed)
7. `npm run e2e` -- runs e2e tests (may take longer, run last)

Skip `npm run graph` -- it launches an interactive browser UI and is not suitable for CI-style validation. Just verify it does not immediately error by checking `npm exec nx graph --help` exits cleanly.

For each script, record: pass/fail, error output if any. Collect all failures before moving to Task 2.

IMPORTANT: Use `npm run <script>` which resolves nx from node_modules/.bin. Do NOT use `npm exec nx` for these -- the scripts are already defined in package.json.
</action>
<verify>
<automated>npm run format:check && npm run lint && npm run typecheck && npm run build && npm run test</automated>
</verify>
<done>All 7 non-interactive scripts have been attempted and results recorded. Failures (if any) are documented with error output.</done>
</task>

<task type="auto">
  <name>Task 2: Fix any errors found in Task 1</name>
  <files></files>
  <action>
For each failing script from Task 1, diagnose and fix the root cause:

- **format:check failures**: Run `npm run format` to auto-fix, then verify with `npm run format:check`.
- **lint failures**: Read the ESLint error output, fix the source files. Common issues: unused imports, missing types, rule violations.
- **typecheck failures**: Read the TypeScript errors, fix type issues in the flagged files.
- **build failures**: Check compilation errors, missing dependencies, misconfigured esbuild/vite settings.
- **test failures**: Read test output, fix broken assertions or test setup issues.
- **e2e failures**: Check the e2e test configuration and test files. The e2e project was recently migrated to Vitest (quick task 1).

If no errors were found in Task 1, this task is a no-op -- just confirm all scripts passed.

After fixes, re-run ALL scripts to confirm nothing regressed:

```
npm run format:check && npm run lint && npm run typecheck && npm run build && npm run test && npm run e2e
```

  </action>
  <verify>
    <automated>npm run format:check && npm run lint && npm run typecheck && npm run build && npm run test && npm run e2e</automated>
  </verify>
  <done>All npm scripts in package.json execute successfully with exit code 0. Any fixes are committed with a descriptive message.</done>
</task>

</tasks>

<verification>
Run the full validation suite:
```bash
npm run format:check && npm run lint && npm run typecheck && npm run build && npm run test && npm run e2e
```
All commands must exit with code 0.
</verification>

<success_criteria>

- Every non-interactive script in package.json (`build`, `test`, `lint`, `typecheck`, `e2e`, `format`, `format:check`) runs without errors
- `npm run graph` confirmed to have a working --help (interactive UI not tested)
- Any source fixes are committed
  </success_criteria>

<output>
After completion, create `.planning/quick/4-run-all-scripts-in-package-json-and-reso/4-SUMMARY.md`
</output>
