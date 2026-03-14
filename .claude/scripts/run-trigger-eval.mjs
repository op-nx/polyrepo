#!/usr/bin/env node
/**
 * Trigger eval for any skill description.
 * Runs each query via `claude -p` and checks if the skill was triggered.
 *
 * Usage:
 *   node .claude/scripts/run-trigger-eval.mjs <skill-name> [--model <model>] [--max-turns <n>]
 *
 * Expects:
 *   .claude/skills/<skill-name>-workspace/eval_set.json
 * Writes:
 *   .claude/skills/<skill-name>-workspace/trigger-results.json
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// --- Parse CLI args ---
const args = process.argv.slice(2);
const skillName = args.find(a => !a.startsWith('--'));

if (!skillName) {
  console.error('Usage: run-trigger-eval.mjs <skill-name> [--model <id>] [--max-turns <n>]');
  process.exit(1);
}

function getFlag(name, fallback) {
  const idx = args.indexOf(`--${name}`);

  if (idx === -1 || idx + 1 >= args.length) {
    return fallback;
  }

  return args[idx + 1];
}

const model = getFlag('model', 'claude-haiku-4-5-20251001');
const maxTurns = parseInt(getFlag('max-turns', '3'), 10);
const timeoutMs = parseInt(getFlag('timeout', '120000'), 10);

// --- Resolve paths ---
const workspace = `.claude/skills/${skillName}-workspace`;
const evalSetPath = resolve(workspace, 'eval_set.json');
const resultsPath = resolve(workspace, 'trigger-results.json');

if (!existsSync(evalSetPath)) {
  console.error(`[ERROR] Eval set not found: ${evalSetPath}`);
  console.error(`Create ${evalSetPath} with [{query, should_trigger}] entries.`);
  process.exit(1);
}

// --- Run eval ---
const evalSet = JSON.parse(readFileSync(evalSetPath, 'utf8'));
console.log(`[INFO] Skill: ${skillName}`);
console.log(`[INFO] Running trigger eval: ${evalSet.length} queries, model=${model}, max-turns=${maxTurns}`);

const results = [];
let passCount = 0;
let failCount = 0;

for (let i = 0; i < evalSet.length; i++) {
  const { query, should_trigger: shouldTrigger } = evalSet[i];
  const displayQuery = query.slice(0, 80);

  let rawOutput = '';

  try {
    const escapedQuery = query
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/`/g, '\\`')
      .replace(/\$/g, '\\$');
    const cmd = `claude -p "${escapedQuery}" --output-format stream-json --verbose --max-turns ${maxTurns} --model ${model}`;

    // Strip CLAUDECODE from env to allow nested claude -p sessions
    const env = { ...process.env };
    delete env.CLAUDECODE;

    rawOutput = execSync(cmd, {
      timeout: timeoutMs,
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

    if (event.type !== 'assistant') continue;

    const contentItems = event.message?.content;

    if (!Array.isArray(contentItems)) continue;

    for (const item of contentItems) {
      if (item.type !== 'tool_use') continue;

      // Detect Skill tool invocation with our skill name
      if (
        item.name === 'Skill' &&
        typeof item.input?.skill === 'string' &&
        item.input.skill.includes(skillName)
      ) {
        triggered = true;
        break;
      }

      // Detect Read tool invocation targeting our skill's SKILL.md
      if (
        item.name === 'Read' &&
        typeof item.input?.file_path === 'string' &&
        item.input.file_path.includes(skillName) &&
        item.input.file_path.includes('SKILL.md')
      ) {
        triggered = true;
        break;
      }
    }

    if (triggered) break;
  }

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

const failures = results.filter(r => !r.pass);

for (const f of failures) {
  console.log(`  FAIL: expected=${f.should_trigger} triggered=${f.triggered}: ${f.query.slice(0, 80)}...`);
}

writeFileSync(resultsPath, JSON.stringify(results, null, 2));
console.log(`\nFull results saved to ${resultsPath}`);

const summary = { passCount, failCount, total: evalSet.length, failures };
console.log('\n' + JSON.stringify(summary));
