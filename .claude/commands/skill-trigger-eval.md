---
description: 'Windows-compatible Description Optimization loop for /skill-creator'
argument-hint: <skill-name> [--model <id>] [--max-turns <n>]
allowed-tools: Bash, Read, Write, Edit, Glob
---

# Trigger Eval: $ARGUMENTS

This command implements the **Description Optimization** step of the `/skill-creator` workflow.
It replaces the Python-based `scripts.run_loop` / `scripts.run_eval` which fail on Windows
(select.select() incompatibility, missing claude.cmd, cp1252 encoding).

Measure how accurately the `$1` skill's description causes Claude to invoke (or skip) the
skill across a set of test queries. Use after the skill content is finalized and qualitative
evals pass — description optimization is the last step before packaging.

## Step 1: Validate prerequisites

Check that `.claude/skills/$1-workspace/eval_set.json` exists.

If it does NOT exist, create one by:

1. Reading `.claude/skills/$1/SKILL.md` to understand what the skill does
2. Generating 8-10 should-trigger queries (realistic user prompts that need this skill)
3. Generating 8-10 should-not-trigger queries (near-miss prompts that share keywords but need something different — avoid obviously irrelevant queries)
4. Writing the eval set as a JSON array of `{"query": "...", "should_trigger": true/false}` objects
5. Presenting the queries to the user for review before proceeding

## Step 2: Run the eval

Execute as a background task (takes ~2 min per query):

```bash
node .claude/scripts/run-trigger-eval.mjs $ARGUMENTS
```

Monitor progress by checking the background task output periodically.

## Step 3: Report results

After the run completes, read `.claude/skills/$1-workspace/trigger-results.json` and report:

| Metric         | Score                                         |
| -------------- | --------------------------------------------- |
| True positives | N/M (should-trigger that triggered)           |
| True negatives | N/M (should-not-trigger that did not trigger) |
| **Total**      | **N/M**                                       |

For each failure, show the query and explain whether it was a false positive (triggered when it shouldn't) or false negative (didn't trigger when it should).

## Step 4: Suggest improvements

If there are failures:

- **False negatives** (undertriggering): suggest adding symptom-oriented phrases to the description that match the missed queries
- **False positives** (overtriggering): suggest narrowing the description or removing ambiguous keywords

If the user wants to iterate, edit the skill's SKILL.md description (both frontmatter and Trigger section) and rerun from Step 2.
