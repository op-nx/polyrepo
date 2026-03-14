#!/usr/bin/env node
/**
 * Trigger eval for eslint-conflict-audit skill description.
 * Runs each query via `claude -p` and checks if the skill was triggered.
 *
 * Usage: node .claude/skills/eslint-conflict-audit-workspace/run-trigger-eval.mjs
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const EVAL_SET_PATH = '.claude/skills/eslint-conflict-audit-workspace/eval_set.json';
const RESULTS_PATH = '.claude/skills/eslint-conflict-audit-workspace/trigger-results.json';
const SKILL_NAME = 'eslint-conflict-audit';
const MAX_TURNS = 3;
const MODEL = 'claude-haiku-4-5-20251001';
const TIMEOUT_MS = 120_000;

const evalSet = JSON.parse(readFileSync(EVAL_SET_PATH, 'utf8'));
console.log(`[INFO] Running trigger eval: ${evalSet.length} queries, model=${MODEL}, max-turns=${MAX_TURNS}`);

const results = [];
let passCount = 0;
let failCount = 0;

for (let i = 0; i < evalSet.length; i++) {
  const { query, should_trigger: shouldTrigger } = evalSet[i];
  const displayQuery = query.slice(0, 80);

  let rawOutput = '';

  try {
    // Escape double quotes and backticks in query for shell
    const escapedQuery = query.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/`/g, '\\`').replace(/\$/g, '\\$');
    const cmd = `claude -p "${escapedQuery}" --output-format stream-json --verbose --max-turns ${MAX_TURNS} --model ${MODEL}`;

    // Strip CLAUDECODE from env to allow nested claude -p sessions
    const env = { ...process.env };
    delete env.CLAUDECODE;

    rawOutput = execSync(cmd, {
      timeout: TIMEOUT_MS,
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
      windowsHide: true,
      env,
      stdio: ['pipe', 'pipe', 'ignore'],
    });
  } catch (e) {
    // claude -p exits non-zero on max-turns reached, but still produces output
    if (e.stdout) {
      rawOutput = e.stdout;
    }
  }

  // Parse stream-json lines to detect actual skill invocation.
  // Stream-json events from claude -p --verbose have this structure:
  //   {"type":"assistant","message":{"content":[{"type":"tool_use","name":"Skill","input":{"skill":"..."}}]}}
  // We must NOT use naive string matching because --verbose output includes
  // the available skills list in the init event, so the skill name appears
  // in every response regardless of whether it was triggered.
  let triggered = false;

  for (const line of rawOutput.split('\n')) {
    let event;

    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }

    // Only inspect assistant messages with tool_use content
    if (event.type !== 'assistant') continue;

    const contentItems = event.message?.content;

    if (!Array.isArray(contentItems)) continue;

    for (const item of contentItems) {
      if (item.type !== 'tool_use') continue;

      // Detect Skill tool invocation with our skill name
      if (
        item.name === 'Skill' &&
        typeof item.input?.skill === 'string' &&
        item.input.skill.includes(SKILL_NAME)
      ) {
        triggered = true;
        break;
      }

      // Detect Read tool invocation targeting our skill's SKILL.md
      if (
        item.name === 'Read' &&
        typeof item.input?.file_path === 'string' &&
        item.input.file_path.includes(SKILL_NAME) &&
        item.input.file_path.includes('SKILL.md')
      ) {
        triggered = true;
        break;
      }
    }

    if (triggered) break;
  }

  // Determine pass/fail
  const pass = shouldTrigger === triggered;

  if (pass) {
    passCount++;
  } else {
    failCount++;
  }

  const status = pass ? 'PASS' : 'FAIL';
  console.log(`  [${status}] expected=${shouldTrigger} triggered=${triggered}: ${displayQuery}...`);

  results.push({ query, should_trigger: shouldTrigger, triggered, pass });
}

console.log('');
console.log('============================================================');
console.log(`Results: ${passCount}/${evalSet.length} passed, ${failCount} failed`);
console.log('============================================================');
console.log('');

// Show failures
const failures = results.filter(r => !r.pass);

for (const f of failures) {
  console.log(`  FAIL: expected=${f.should_trigger} triggered=${f.triggered}: ${f.query.slice(0, 80)}...`);
}

writeFileSync(RESULTS_PATH, JSON.stringify(results, null, 2));
console.log(`\nFull results saved to ${RESULTS_PATH}`);

// Output summary as JSON for downstream use
const summary = { passCount, failCount, total: evalSet.length, failures };
console.log('\n' + JSON.stringify(summary));
