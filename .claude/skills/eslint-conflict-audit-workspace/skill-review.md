# Skill Review: eslint-conflict-audit

## Summary
Strong procedural skill with clear conflict taxonomy and output format. Two areas need attention: (1) trigger description too narrow, (2) flat config semantics ambiguity.

## Major Issues

### 1. Trigger description too narrow
Current trigger covers only 3 phrasings. Misses: "are any rules redundant", "circular fix loop", "eslint rules fighting each other", "which rules overlap".

### 2. Flat config spread semantics ambiguity (Step 1, item 2)
"explicit `rules` completely replaces the spread's `rules`" conflates:
- **Object spread** (`{ ...preset, rules: {...} }`): JS semantics, rules key replaced entirely
- **Array spread** (`[...presetConfigs, { rules: {...} }]`): separate config objects, ESLint merges per-rule with later winning

### 3. Sort order inconsistency
Line 92 says "A first, then B, C, D" but severity hierarchy is "B > A > D > C". Should match.

## Minor Issues

1. No output path convention specified
2. Type B empirical testing (`eslint --fix` on test files) is aspirational for LLM agents
3. Missing `eslint --print-config` as verification step
4. Known conflict pairs could move to `references/known-conflicts.md`

## Positive Aspects
- Conflict taxonomy is excellent (4 types, clear definitions)
- False positive prevention is strong ("only from what the config actually enables")
- Output format precisely specified with template
- Hybrid type resolution rule clear (B > A > D > C)
- Consistently imperative writing style

## Priority Recommendations
1. Expand trigger to 6-8 phrases covering all conflict types
2. Clarify object-spread vs array-spread semantics
3. Add `eslint --print-config` as verification step
4. Fix sort order to match severity hierarchy
5. Extract known conflict pairs to reference file
