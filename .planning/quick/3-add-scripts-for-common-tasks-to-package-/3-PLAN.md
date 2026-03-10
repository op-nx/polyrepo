---
phase: quick-3
plan: 01
type: execute
wave: 1
depends_on: []
files_modified: [package.json]
autonomous: true
requirements: [QUICK-3]

must_haves:
  truths:
    - "npm run build executes Nx build for all projects"
    - "npm test executes Nx test for all projects"
    - "npm run lint executes Nx lint for all projects"
    - "npm run typecheck executes Nx typecheck for all projects"
    - "npm run e2e executes Nx e2e for the e2e project"
  artifacts:
    - path: "package.json"
      provides: "npm scripts for common Nx tasks"
      contains: "\"scripts\""
  key_links:
    - from: "package.json scripts"
      to: "nx run-many / nx run"
      via: "npm run <script>"
      pattern: "nx run-many|nx run|nx e2e"
---

<objective>
Add npm scripts to the root package.json for common Nx workspace tasks.

Purpose: The root package.json currently has an empty `"scripts": {}` block. Developers expect `npm test`, `npm run build`, `npm run lint`, etc. to work from the repo root. These scripts should delegate to Nx so the workspace is the single source of truth for task configuration.

Output: Updated package.json with scripts for build, test, lint, typecheck, e2e, and graph.
</objective>

<execution_context>
@C:/Users/LarsGyrupBrinkNielse/.claude/get-shit-done/workflows/execute-plan.md
@C:/Users/LarsGyrupBrinkNielse/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@package.json

Available Nx targets by project:
- @op-nx/polyrepo: typecheck, build, build-deps, watch-deps, test, lint, nx-release-publish
- op-nx-polyrepo-e2e: typecheck, test, build-deps, watch-deps, lint, e2e
- @op-nx/source: polyrepo-sync, polyrepo-status, local-registry

Note: `"nx": { "includedScripts": [] }` in package.json means no npm scripts are exposed as Nx targets. This is correct -- we want npm scripts to CALL Nx, not the other way around (which would cause circular invocation).
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add npm scripts for common Nx tasks to root package.json</name>
  <files>package.json</files>
  <action>
Update the `"scripts"` field in root package.json with the following scripts:

```json
"scripts": {
  "build": "nx run-many -t build",
  "test": "nx run-many -t test",
  "lint": "nx run-many -t lint",
  "typecheck": "nx run-many -t typecheck",
  "e2e": "nx e2e op-nx-polyrepo-e2e",
  "graph": "nx graph",
  "format": "nx format",
  "format:check": "nx format:check"
}
```

Rationale for each script:
- `build`, `test`, `lint`, `typecheck`: Use `nx run-many -t <target>` to run across all projects that have that target. No `--all` flag needed -- `run-many` defaults to all projects.
- `e2e`: Targets the specific e2e project directly since only one project has the e2e target.
- `graph`: Opens the Nx project graph visualization.
- `format`: Runs Prettier formatting via Nx's built-in format command.
- `format:check`: CI-friendly format check.

Do NOT use `npx nx` in scripts -- npm scripts resolve node_modules/.bin automatically, so bare `nx` works and is idiomatic.

Do NOT change `"nx": { "includedScripts": [] }` -- keeping it empty prevents circular invocation where Nx would try to run npm scripts as Nx targets.
  </action>
  <verify>
    <automated>node -e "const p=require('./package.json'); const s=p.scripts; const expected=['build','test','lint','typecheck','e2e','graph','format','format:check']; const missing=expected.filter(k=>!s[k]); if(missing.length){console.error('Missing scripts:',missing);process.exit(1)}; console.log('All scripts present'); if(p.nx.includedScripts.length>0){console.error('includedScripts must be empty');process.exit(1)}; console.log('includedScripts correctly empty')"</automated>
  </verify>
  <done>Root package.json contains scripts for build, test, lint, typecheck, e2e, graph, format, and format:check. All delegate to Nx. includedScripts remains empty.</done>
</task>

</tasks>

<verification>
- `node -e "console.log(JSON.stringify(require('./package.json').scripts, null, 2))"` shows all expected scripts
- `npm run build -- --help` invokes Nx (confirms delegation works)
</verification>

<success_criteria>
- Root package.json has 8 npm scripts covering build, test, lint, typecheck, e2e, graph, format, and format:check
- All scripts delegate to Nx commands
- `includedScripts` remains empty to prevent circular invocation
</success_criteria>

<output>
After completion, create `.planning/quick/3-add-scripts-for-common-tasks-to-package-/3-SUMMARY.md`
</output>
