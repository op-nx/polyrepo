---
created: 2026-03-21T20:23:55.000Z
title: Enable host-level caching for proxy targets using runtime inputs tied to child repo git HEAD
area: proxy
files: []
---

## Problem

The run executor proxies Nx targets into child repos under `.repos/<alias>/`. Nx's computation cache on the host workspace does not account for changes inside the child repo — it only sees the proxy target configuration, not the child repo's actual source state. This means cache hits can return stale results when the child repo has changed.

## Solution

Use Nx runtime hash inputs tied to the child repo's `git HEAD` (or tree hash) so the host-level cache invalidates whenever the child repo content changes:

1. In `createNodesV2`, attach `runtimeCacheInputs` (or equivalent `inputs` config) to each proxy target that shells out to `git rev-parse HEAD` (or `git write-tree`) inside `.repos/<alias>/`
2. This makes the host cache key depend on the child repo's current commit/tree, so a cache hit only occurs when the child repo is at the same state
3. Consider granularity: `HEAD` gives commit-level invalidation, `write-tree` gives working-tree-level (catches uncommitted changes)
4. Evaluate performance cost of the git call per target vs. benefit of caching
