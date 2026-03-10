# nx-openpolyrepo

## What This Is

An open-source Nx plugin for synthetic monorepos — a development tool for polyrepo Nx workspaces. It merges project graphs from multiple repos into one unified Nx workspace, so `nx graph`, `nx affected`, `nx run-many`, and all standard Nx CLI commands work seamlessly across repo boundaries. An open-source alternative to Nx Polygraph that requires no Nx Cloud or Nx Enterprise — it assumes self-hosted Nx remote cache.

## Core Value

`nx graph` displays projects from all assembled repos with cross-repo dependency edges, and all relevant Nx CLI commands output projects from multiple repos — making polyrepo feel like monorepo.

## Requirements

### Validated

- Nx workspace scaffolded with @nx/plugin, @nx/devkit, TypeScript, Vite, Vitest — existing
- Build, test, and lint pipeline via Nx plugins — existing

### Active

- [ ] Repo assembly via git clone/pull, configured in nx.json plugin options
- [ ] Nx project graph plugin that merges graphs from multiple Nx workspaces
- [ ] Namespace/prefix external repo projects (repo name prefix) when running from an individual repo
- [ ] Cross-repo dependency auto-detection from package.json
- [ ] Explicit cross-repo dependency overrides (manual wiring)
- [ ] Multi-repo git DX — combined git status across all repos
- [ ] Multi-repo git DX — bulk/selective git commands (pull, fetch, etc.)

### Out of Scope

- Nx Cloud or Nx Enterprise integration — this is explicitly a free/open-source alternative
- Task running reimplementation — Nx handles task orchestration natively; plugin only merges graphs
- Custom build system — leverages Nx's built-in task graph and caching
- GUI/web dashboard — CLI/TUI only for v1

## Context

- **Nx Polygraph** is the enterprise/paid solution for synthetic monorepos. This project provides the same core concept (assemble multiple repos, unified graph) without the enterprise dependency.
- **Self-hosted Nx remote cache** is assumed — no Nx Cloud dependency for caching.
- Each assembled repo is a full Nx workspace with its own `nx.json`. The plugin merges their project graphs rather than treating them as raw source directories.
- Projects from external repos are namespaced (prefixed with repo name) to avoid collisions when running Nx commands from an individual repo folder.
- **Nx sync generators** (`nx sync` command and related hooks) may be a natural mechanism for keeping the assembled workspace in sync (e.g., updating tsconfig paths for cross-repo imports, flagging stale repos). To be evaluated during research.
- **Other polyrepo tools** (meta, mu-repo, etc.) should be researched for DX patterns, especially around multi-repo git operations and combined status views.

## Constraints

- **Nx plugin architecture**: Must integrate as a standard Nx plugin registered in `nx.json` — no custom CLI entry points that bypass Nx
- **Open source**: MIT or similar permissive license
- **Cross-platform**: Must work on Windows, macOS, and Linux
- **Self-hosted cache**: No dependency on Nx Cloud; must work with any self-hosted remote cache solution
- **Nx version**: Built against Nx 22.x (currently 22.5.4)

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Git clone/pull for repo assembly | Cross-platform, portable, full control over branch/commit, no symlink permission issues on Windows | -- Pending |
| Config in nx.json plugin options | Nx-native approach, repos configured where all other plugins are configured | -- Pending |
| Namespace external projects by repo name | Avoids collisions when repos have same project names; only applied when running from individual repo | -- Pending |
| Auto-detect deps from package.json + explicit overrides | Best of both worlds: zero-config for standard setups, escape hatch for complex cases | -- Pending |

---
*Last updated: 2026-03-10 after initialization*
