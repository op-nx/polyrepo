---
status: resolved
trigger: 'Investigate why external repo projects are not appearing in `nx show projects` despite the graph cache being populated and readable.'
created: 2026-03-12T00:00:00Z
updated: 2026-03-12T00:00:00Z
---

## Current Focus

hypothesis: CONFIRMED - NX_VERBOSE_LOGGING=true inherited by child `nx graph --print` process contaminates stdout
test: Ran NX_DAEMON=false NX_VERBOSE_LOGGING=true npm exec nx -- show projects and observed the error message
expecting: n/a - confirmed
next_action: Return diagnosis to caller

## Symptoms

expected: nx show projects returns 152 projects (3 host + 149 from .repos/nx)
actual: nx show projects returns only 3 host workspace projects
errors: "Failed to extract external project graphs: Failed to parse graph JSON from .repos/nx: Unexpected token 'i', \"[isolated-p\"... is not valid JSON"
reproduction: Start Nx daemon or run with NX_VERBOSE_LOGGING=true when disk cache hash is stale
started: When disk cache hash does not match current computeOuterHash result

## Eliminated

- hypothesis: createNodesV2 not yielding external project entries
  evidence: Code at index.ts:66-84 correctly iterates report.repos entries and builds projects map; logic is sound
  timestamp: 2026-03-12

- hypothesis: src/index.js missing causes plugin not to load at all
  evidence: node_modules/@op-nx/polyrepo is a symlink; package.json main is ./src/index.js which does not exist. However, Nx loads plugin workers via a TypeScript transpiler path (ts-node) when .ts files are present, so the plugin DOES load successfully as shown by "[plugin-worker] @op-nx/polyrepo loaded successfully" in verbose output
  timestamp: 2026-03-12

- hypothesis: populateGraphReport returns empty data
  evidence: When disk cache hash matches, 152 projects are returned correctly. The cache at .repos/.polyrepo-graph-cache.json has 149 nodes under report.repos.nx.nodes. populateGraphReport correctly reads and returns the cached data.
  timestamp: 2026-03-12

- hypothesis: hash mismatch alone causes failure
  evidence: Hash mismatch only causes live extraction via extractGraphFromRepo. Extraction succeeds when NX_VERBOSE_LOGGING is not set. The hash mismatch is a necessary precondition, not the direct cause.
  timestamp: 2026-03-12

## Evidence

- timestamp: 2026-03-12
  checked: packages/op-nx-polyrepo/src/lib/graph/extract.ts
  found: exec() call at line 25 passes env: { ...process.env, NX_DAEMON: 'false' } — spreads entire parent process env, only overrides NX_DAEMON
  implication: Any env var set in the parent (plugin worker) process is inherited by the child nx graph --print subprocess

- timestamp: 2026-03-12
  checked: node_modules/nx/src/project-graph/plugins/isolation/isolated-plugin.js startPluginWorker()
  found: Plugin worker spawned with env: { ...process.env } — full parent env inheritance
  implication: When Nx daemon or nx CLI is started with NX_VERBOSE_LOGGING=true, ALL plugin worker processes inherit NX_VERBOSE_LOGGING=true

- timestamp: 2026-03-12
  checked: NX_DAEMON=false NX_VERBOSE_LOGGING=true npm exec nx -- show projects output
  found: Error message: "Failed to extract external project graphs: Failed to parse graph JSON from .repos/nx: Unexpected token 'i', \"[isolated-p\"... is not valid JSON"
  implication: The child nx graph --print process emits "[isolated-plugin]" log lines to stdout before the JSON, because it inherits NX_VERBOSE_LOGGING=true. JSON.parse(stdout) fails on this contaminated output.

- timestamp: 2026-03-12
  checked: packages/op-nx-polyrepo/src/index.ts lines 39-46
  found: try/catch around populateGraphReport silently swallows the parse error, sets report=undefined, and warns "External projects will not be visible"
  implication: The failure is silent from the user's perspective unless NX_VERBOSE_LOGGING is active enough to show the warning

- timestamp: 2026-03-12
  checked: packages/op-nx-polyrepo/src/lib/graph/cache.ts computeOuterHash
  found: Hash constructed from hashArray([optionsHash, 'nx', headSha, dirtyFiles]). Cached hash is 1222891923678234250. Current computed hash is 15195226177213616514.
  implication: Hash mismatch means every createNodesV2 invocation when the daemon was active bypassed both cache layers and attempted live extraction

- timestamp: 2026-03-12
  checked: .repos/.polyrepo-graph-cache.json
  found: 149 nodes under report.repos.nx.nodes, hash "1222891923678234250". This was written by a prior successful extraction.
  implication: The cache IS populated and contains valid data, but the hash doesn't match what the current plugin computes, causing a cache miss and falling through to live extraction

- timestamp: 2026-03-12
  checked: npm exec nx reset followed by npm exec nx -- show projects
  found: After reset (which clears in-memory state but NOT .repos/ disk cache), project count returned to 152
  implication: nx reset forced fresh extraction OR fresh hash computation that matched the disk cache, restoring correct behavior

## Resolution

root_cause: |
Two conditions combine to produce the failure:

1. CACHE MISS: The disk cache hash (.repos/.polyrepo-graph-cache.json hash: "1222891923678234250")
   does not match the hash computed by the current plugin invocation
   (computeOuterHash produces "15195226177213616514"). This forces live extraction via
   extractGraphFromRepo every time createNodesV2 runs.

2. STDOUT CONTAMINATION: extractGraphFromRepo at
   packages/op-nx-polyrepo/src/lib/graph/extract.ts:25-32 passes
   `env: { ...process.env, NX_DAEMON: 'false' }`, inheriting all parent env vars including
   NX_VERBOSE_LOGGING=true when the Nx daemon or CLI was started with verbose logging.
   The child `nx graph --print` process then emits "[isolated-plugin]" log lines to stdout
   before the JSON payload. JSON.parse(stdout) at extract.ts:45 fails with:
   "Unexpected token 'i', \"[isolated-p\"... is not valid JSON".

The error is silently swallowed at index.ts:39-46 (try/catch sets report=undefined),
causing createNodesV2 to return only the root workspace targets (.projects key with
just the '.' entry), explaining the 3-project output.

The direct fix location is extract.ts:32: add NX_VERBOSE_LOGGING: 'false' to the env
override alongside NX_DAEMON: 'false'. This prevents the child nx process from
emitting diagnostic log lines to stdout, keeping stdout clean for JSON parsing.

fix: Not applied (read-only research task)
verification: n/a
files_changed: []
