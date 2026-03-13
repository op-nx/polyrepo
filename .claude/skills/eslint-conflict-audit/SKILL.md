# Skill: ESLint conflict audit

## Trigger
User asks to check for conflicting ESLint rules, audit ESLint config, or find rule conflicts.

## Prompt

Read the project's ESLint flat config file(s) and produce a conflict report. A "conflict" is any pair of enabled rules where both being active causes incorrect, circular, or destructive behavior.

### Step 1: Extract the effective rule set

Read every ESLint config file in the project (root + per-project overrides). For each file-glob scope, resolve the final severity and options for every rule after all spreads and overrides are applied. Ignore rules set to `'off'` or `0`.

### Step 2: Identify conflicts

Check every enabled rule against every other enabled rule in the same file-glob scope for these conflict types:

**Type A — Mutually exclusive advice**
Two rules that demand opposite code patterns. Enabling both means every file violates at least one.

Detection: Look for rule name pairs that share a stem but have opposing prefixes/suffixes:
- `prefer-X` vs `no-X` (e.g. `prefer-importing-vitest-globals` vs `no-importing-vitest-globals`)
- `prefer-X` vs `prefer-Y` where X and Y are alternative spellings of the same assertion (e.g. `prefer-to-be-truthy` vs `prefer-strict-boolean-matchers` — both govern `.toBe(true)` vs `.toBeTruthy()`)
- `prefer-called-once` vs `prefer-called-times` (`.toHaveBeenCalledOnce()` vs `.toHaveBeenCalledTimes(1)`)
- `require-X` vs `no-X`

Also check the rule metadata if available: load the plugin and inspect `rule.meta.fixable`. If two rules are both fixable and their fixes produce code that violates the other rule, that is a circular fix conflict (Type B).

**Type B — Circular auto-fix**
Rule A's `--fix` output triggers Rule B, and vice versa. Running `eslint --fix` repeatedly never converges.

Detection: Run `eslint --fix` twice on the same file set. If the second run produces different output than the first (i.e. fix count > 0 on the second pass), there is likely a circular fix. Diff the two outputs to identify which rule pairs are cycling.

**Type C — Superseded rules**
A stricter rule makes a weaker rule redundant. Not a hard conflict, but enabling both adds noise (the weaker rule's violations are a subset of the stricter rule's).

Detection: Check plugin documentation or rule descriptions for phrases like "stricter version of", "supersedes", or "extends". Common patterns:
- `prefer-strict-equal` supersedes `prefer-to-be` for object comparisons
- `prefer-strict-boolean-matchers` supersedes `prefer-to-be-truthy` / `prefer-to-be-falsy`
- `consistent-type-assertions` with `assertionStyle: 'never'` supersedes `no-non-null-assertion`

**Type D — Config-level impossibility**
A rule's options make it impossible to satisfy another rule. For example:
- `consistent-type-assertions` with `assertionStyle: 'never'` + `consistent-type-assertions` with `assertionStyle: 'as'` in overlapping scopes
- `valid-title` without `allowArguments: true` + `prefer-describe-function-title` (one demands strings, the other demands function references)

### Step 3: Check `*.configs.all` spreads specifically

When a config spreads a plugin's `all` preset (e.g. `vitest.configs.all`, `@typescript-eslint/all`), flag it as high-risk for conflicts. These presets enable every rule the plugin offers, including mutually exclusive pairs the plugin intentionally separates into different recommended/strict/stylistic presets.

For each `all` preset found:
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

Sort conflicts by type (A first, then B, C, D), then alphabetically by rule name.

End with a summary:
```
## Summary

| Type | Count | Action needed |
|------|-------|---------------|
| A — Mutually exclusive | N | Must disable one side |
| B — Circular fix | N | Must disable one side |
| C — Superseded | N | Optional cleanup |
| D — Config impossibility | N | Must fix options |
```
