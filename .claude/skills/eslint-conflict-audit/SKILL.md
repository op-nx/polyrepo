# Skill: ESLint conflict audit

## Trigger
Check for conflicting, contradictory, or redundant ESLint rules. Audit ESLint flat config for rule conflicts, circular auto-fix loops, or superseded rules. Find mutually exclusive rules enabled by broad presets. Investigate why `eslint --fix` produces oscillating changes or why two rules demand opposite code patterns.

## Prompt

Read the project's ESLint flat config file(s) and produce a conflict report. A "conflict" is any pair of enabled rules where both being active causes incorrect, circular, or destructive behavior.

### Step 1: Extract the effective rule set

Build an explicit inventory of every active rule. A rule is active only if it appears as a key in the final resolved `rules` object for a given scope with a severity other than `'off'` or `0`. Do not infer active rules from comments, git history, plugin documentation, or rule name patterns -- only from what the config actually enables.

Read every ESLint config file in the project (root + per-project overrides). For each file, trace the config array in order and resolve rules using ESLint flat config semantics:

1. **Identify spreads**: For each spread (`...plugin.configs.recommended`, `...tseslint.configs.strictTypeCheckedOnly`, etc.), determine which rules it contributes. Read the preset's `rules` object from the plugin source or `node_modules` if needed.
2. **Apply overwrite order**: Two distinct spreading patterns exist:
   - **Object spread** (`{ ...preset, rules: { ... } }`): the explicit `rules` property replaces the spread's `rules` entirely (standard JS object semantics). If the explicit `rules` re-spreads the preset (`...vitest.configs.recommended.rules`), those rules are included.
   - **Array spread** (`[...presetConfigs, { rules: { ... } }]`): each config object is a separate entry in the flat config array. ESLint merges rules across all matching objects, with later objects winning per-rule.
3. **Named exports**: Check for named exports (e.g. `export const opNxE2e = [...]`) that downstream project configs import and spread. These create additional scopes.
4. **Scope overlap**: When globs overlap (e.g. `**/*.ts` and `**/*.spec.ts`), a file matching both scopes receives rules from both config objects, with later objects winning. Merge both scopes' rules to get the effective set for that file type.

Output: For each distinct effective scope, produce a flat list of `ruleName: severity/options` pairs. Only rules in this list are candidates for conflict checking. If a rule does not appear in any scope's list, it is not active and must not be reported as conflicting.

To verify your manual resolution, you can run `npx eslint --print-config <file>` on a representative file for each scope (e.g. a `.ts` source file and a `.spec.ts` test file). This gives the ground-truth effective config for that file path.

### Step 2: Identify conflicts

Using only the active rules from Step 1, check every enabled rule against every other enabled rule in the same effective scope for these conflict types:

**Type A -- Mutually exclusive advice**
Two rules that demand opposite code patterns. Enabling both means every file violates at least one.

Detection -- look for rule name pairs that share a stem but have opposing prefixes/suffixes:
- `prefer-X` vs `no-X` (e.g. `prefer-importing-vitest-globals` vs `no-importing-vitest-globals`)
- `prefer-X` vs `prefer-Y` where X and Y are alternative spellings of the same assertion (e.g. `prefer-to-be-truthy` vs `prefer-strict-boolean-matchers` -- both govern `.toBe(true)` vs `.toBeTruthy()`)
- `prefer-called-once` vs `prefer-called-times` (`.toHaveBeenCalledOnce()` vs `.toHaveBeenCalledTimes(1)`)
- `require-X` vs `no-X`

Also check cross-plugin pairs. Common patterns:
- ESLint core `no-unused-vars` vs `@typescript-eslint/no-unused-vars` (TS version extends core; enabling both double-reports)
- Prettier vs any stylistic/formatting ESLint rule (Prettier owns formatting; ESLint stylistic rules conflict)
- ESLint core `no-shadow` vs `@typescript-eslint/no-shadow` (TS version handles enums and type declarations)

**Type B -- Circular auto-fix**
Rule A's `--fix` output triggers Rule B, and vice versa. Running `eslint --fix` repeatedly never converges.

Detection -- static analysis: load the plugin and inspect `rule.meta.fixable` for each enabled rule. If two fixable rules in the same scope target the same AST node type or code pattern, check whether Rule A's fix output would violate Rule B and vice versa. Common signals:
- Both rules are fixable and target import declarations
- Both rules are fixable and target assertion/matcher expressions
- One rule adds code that the other rule removes

For known conflict pairs, describe the circular fix sequence from static analysis. For uncertain pairs, verify empirically if feasible: create a minimal file that violates Rule A, run `eslint --fix --rule '{"ruleB":"off"}'`, then check if the output violates Rule B (and vice versa).

A conflict can be both Type A and Type B (mutually exclusive rules that are also both auto-fixable). When this happens, classify as Type B -- the circular fix is the more severe symptom and the one that needs action. Note the mutual exclusivity in the Problem description.

**Type C -- Superseded rules**
A stricter rule makes a weaker rule redundant. Not a hard conflict, but enabling both adds noise (the weaker rule's violations are a subset of the stricter rule's).

Detection -- check plugin documentation or rule descriptions for phrases like "stricter version of", "supersedes", or "extends". Common patterns:
- `prefer-strict-equal` supersedes `prefer-to-be` for object comparisons
- `prefer-strict-boolean-matchers` supersedes `prefer-to-be-truthy` / `prefer-to-be-falsy`
- `consistent-type-assertions` with `assertionStyle: 'never'` supersedes `no-non-null-assertion`
- `@typescript-eslint/*` versions supersede their ESLint core equivalents (e.g. `no-unused-vars`, `no-shadow`, `no-redeclare`)

**Type D -- Config-level impossibility**
A rule's options make it impossible to satisfy another rule. For example:
- `consistent-type-assertions` with `assertionStyle: 'never'` + `consistent-type-assertions` with `assertionStyle: 'as'` in overlapping scopes
- `valid-title` without `allowArguments: true` + `prefer-describe-function-title` (one demands strings, the other demands function references)

### Step 3: Check broad presets

When a config spreads a plugin's `all`, `strict`, or `stylistic` preset, flag it for review. These presets enable large rule sets that may include mutually exclusive pairs the plugin intentionally separates into different presets.

For each broad preset found:
1. List which mutually exclusive pairs it enables
2. List which rules the plugin's `recommended` preset intentionally excludes (these were excluded for a reason)
3. Check if the config overrides disable one side of each conflict

### Step 4: Output the report

For each conflict found, output:

```
## [Type A/B/C/D] <conflict-name>

Rules: `<rule-1>` vs `<rule-2>`
Scope: <file glob where both are active>
Severity: <both severities>

**Problem**: <one sentence explaining what goes wrong>
**Evidence**: <the specific code pattern that violates both, or the circular fix sequence>
**Fix**: Disable `<rule-to-disable>` because <rationale>
```

Use exactly one type label per finding (A, B, C, or D). Do not combine types (no "A+B"). If a conflict has aspects of multiple types, classify by the most severe: B > A > D > C.

Sort conflicts by severity (B first, then A, D, C), then alphabetically by rule name within each type.

End with a summary:
```
## Summary

| Type | Count | Action needed |
|------|-------|---------------|
| B -- Circular fix | N | Must disable one side |
| A -- Mutually exclusive | N | Must disable one side |
| D -- Config impossibility | N | Must fix options |
| C -- Superseded | N | Optional cleanup |
```
