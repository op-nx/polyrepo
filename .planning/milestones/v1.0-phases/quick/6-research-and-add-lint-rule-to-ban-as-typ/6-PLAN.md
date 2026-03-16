---
phase: quick-6
plan: 1
type: execute
wave: 1
depends_on: []
files_modified:
  - eslint.config.mjs
  - packages/op-nx-polyrepo/src/lib/graph/extract.ts
  - packages/op-nx-polyrepo/src/lib/executors/status/executor.ts
autonomous: true
requirements: [LINT-ASSERTIONS]
must_haves:
  truths:
    - 'All `as` type assertions are banned by lint rule'
    - 'Existing production code compiles and lints clean with zero warnings'
    - 'Test files use eslint-disable for legitimate test mocking patterns'
  artifacts:
    - path: 'eslint.config.mjs'
      provides: 'consistent-type-assertions rule with assertionStyle never'
      contains: 'consistent-type-assertions'
    - path: 'packages/op-nx-polyrepo/src/lib/graph/extract.ts'
      provides: 'Production code free of as assertions'
    - path: 'packages/op-nx-polyrepo/src/lib/executors/status/executor.ts'
      provides: 'Production code free of as const assertions'
  key_links:
    - from: 'eslint.config.mjs'
      to: 'all .ts files'
      via: 'eslint flat config TypeScript rules block'
      pattern: 'consistent-type-assertions.*never'
---

<objective>
Add `@typescript-eslint/consistent-type-assertions` with `assertionStyle: 'never'` to ban all `as` type assertions. Fix production violations and add eslint-disable annotations to test files where assertions are used for legitimate mocking.

Purpose: Enforce type-safe patterns (type annotations, `satisfies`, narrowing) over unsafe `as` casts.
Output: Updated eslint config, cleaned production code, annotated test files.
</objective>

<execution_context>
@C:/Users/LarsGyrupBrinkNielse/.claude/get-shit-done/workflows/execute-plan.md
@C:/Users/LarsGyrupBrinkNielse/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@eslint.config.mjs
@packages/op-nx-polyrepo/src/lib/graph/extract.ts
@packages/op-nx-polyrepo/src/lib/executors/status/executor.ts
</context>

<tasks>

<task type="auto">
  <name>Task 1: Fix production code violations</name>
  <files>
    packages/op-nx-polyrepo/src/lib/graph/extract.ts
    packages/op-nx-polyrepo/src/lib/executors/status/executor.ts
  </files>
  <action>
Fix two production files to eliminate `as` assertions:

**extract.ts (2 violations):**

- Line 64: `JSON.parse(jsonPayload) as ExternalGraphJson` -- replace with type annotation on the variable: `const parsed: ExternalGraphJson = JSON.parse(jsonPayload);`
- Line 69: `(parseError as Error).message` -- this is a catch clause error narrowing, a legitimate pattern. Add `// eslint-disable-next-line @typescript-eslint/consistent-type-assertions` above the line containing it.

**status/executor.ts (6 violations, all `as const`):**

- Lines 270-275: `align: 'left' as const` and `align: 'right' as const` -- these are unnecessary because the variable is already typed as `ColumnDef[][]` where `align` is `'left' | 'right'`. Simply remove `as const` from all six occurrences, leaving just `align: 'left'` and `align: 'right'`.
  </action>
  <verify>
  <automated>npm exec nx typecheck @op-nx/polyrepo</automated>
  </verify>
  <done>Both production files have zero `as` assertions (except one with eslint-disable annotation for catch clause narrowing). Typecheck passes.</done>
  </task>

<task type="auto">
  <name>Task 2: Add lint rule and annotate test files</name>
  <files>
    eslint.config.mjs
    packages/op-nx-polyrepo/src/index.spec.ts
    packages/op-nx-polyrepo/src/lib/executors/run/executor.spec.ts
    packages/op-nx-polyrepo/src/lib/executors/status/executor.spec.ts
    packages/op-nx-polyrepo/src/lib/executors/sync/executor.spec.ts
    packages/op-nx-polyrepo/src/lib/git/commands.spec.ts
    packages/op-nx-polyrepo/src/lib/git/detect.spec.ts
    packages/op-nx-polyrepo/src/lib/graph/cache.spec.ts
    packages/op-nx-polyrepo/src/lib/graph/extract.spec.ts
    packages/op-nx-polyrepo-e2e/src/op-nx-polyrepo.spec.ts
  </files>
  <action>
**Step 1: Add rule to eslint.config.mjs.**
In the TypeScript rules block (the one containing `@typescript-eslint/no-unused-vars`), add:

```js
'@typescript-eslint/consistent-type-assertions': [
  'error',
  { assertionStyle: 'never' },
],
```

**Step 2: Add eslint-disable-next-line annotations to all test file `as` assertions.**

All test file `as` casts are legitimate mocking patterns (partial test fixtures, mock child processes, error type narrowing). Add `// eslint-disable-next-line @typescript-eslint/consistent-type-assertions` above each line containing an `as` assertion in these test files:

- `index.spec.ts`: 1 violation (`{} as never`)
- `run/executor.spec.ts`: 3 violations (`as ExecutorContext`, `as string` x2)
- `status/executor.spec.ts`: 13 violations (`as ExecutorContext`, `{} as never` x12)
- `sync/executor.spec.ts`: 4 violations (`as ReturnType<...>`, `as typeof child.stdout`, `as typeof child.stderr`, `null as unknown as ...`, `as ExecutorContext`)
- `commands.spec.ts`: 2 violations (`as typeof execFile` x2)
- `detect.spec.ts`: ~12 violations (`as typeof execFile`, `as ExecFileException` patterns)
- `cache.spec.ts`: 4 violations (`as unknown as string`)
- `extract.spec.ts`: 2 violations (`as typeof exec`, `as ExecException`)
- `op-nx-polyrepo.spec.ts` (e2e): 2 violations (`as { ... }`, `as { plugin: string }`)

For lines with MULTIPLE `as` assertions on the same line (e.g., sync/executor.spec.ts lines 88-90 each have one), a single eslint-disable-next-line above each line is sufficient.

**Step 3: Run lint to verify zero errors.**
</action>
<verify>
<automated>npm exec nx lint @op-nx/polyrepo -- --max-warnings=0 && npm exec nx lint op-nx-polyrepo-e2e -- --max-warnings=0</automated>
</verify>
<done>Lint passes with zero errors and zero warnings for both plugin and e2e projects. The `consistent-type-assertions` rule is active and enforced.</done>
</task>

</tasks>

<verification>
- `npm exec nx lint @op-nx/polyrepo -- --max-warnings=0` passes
- `npm exec nx lint op-nx-polyrepo-e2e -- --max-warnings=0` passes
- `npm exec nx test @op-nx/polyrepo` passes (no behavioral changes)
- `npm exec nx typecheck @op-nx/polyrepo` passes
</verification>

<success_criteria>

- @typescript-eslint/consistent-type-assertions rule is configured with assertionStyle: 'never'
- Production code has zero `as` assertions (one annotated exception in extract.ts for catch clause)
- All test file assertions have eslint-disable annotations
- Lint passes with zero warnings on both projects
- All tests still pass
  </success_criteria>

<output>
After completion, create `.planning/quick/6-research-and-add-lint-rule-to-ban-as-typ/6-SUMMARY.md`
</output>
