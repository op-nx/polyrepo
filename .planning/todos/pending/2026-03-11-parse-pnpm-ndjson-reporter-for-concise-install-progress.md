---
created: 2026-03-11T20:07:15.095Z
title: Parse pnpm ndjson reporter for concise install progress
area: sync
files:
  - packages/op-nx-polyrepo/src/lib/executors/sync/executor.ts:68-131
---

## Problem

When `--verbose` is not set, `installDeps` currently uses `--reporter=silent` for pnpm, which suppresses all output. Users get no feedback during long installs (e.g., 3000+ packages for the Nx repo). The `append-only` reporter is too noisy (one `Progress:` line per tick), and the `default` reporter requires a TTY that Nx doesn't provide.

pnpm's `--reporter=ndjson` outputs structured JSON per line with `name`, `level`, and payload fields. This can be parsed to produce concise, npm-style install feedback.

## Solution

Use `--reporter=ndjson` for pnpm instead of `--reporter=silent` (when not `--verbose`). Parse the JSON stream to:

1. **Progress dots**: Write a `.` to stdout for each `pnpm:progress` event (all on one line, like `Progress: .......................`).
2. **Summary line**: After install completes, emit an npm-style summary from the final progress event:
   `"resolved 3272 packages, reused 2794 packages, downloaded 459 packages, and added 694 packages in 9s"`

Key ndjson fields observed:

- `{"name":"pnpm:progress","status":{"done":3272,"total":3917}}` — progress ticks
- `{"name":"pnpm:stage","stage":"resolution_started|importing_started|..."}` — phase changes
- `{"name":"pnpm:stats","added":694,"removed":0}` — final stats
- `{"level":"error",...}` — errors to forward to stderr

Considerations:

- Only applies to pnpm; npm and yarn keep their current quiet flags
- Must handle partial JSON lines (chunks may split across `data` events)
- Timer for duration display (`in Xs`)
- Fall back to silent if JSON parsing fails
