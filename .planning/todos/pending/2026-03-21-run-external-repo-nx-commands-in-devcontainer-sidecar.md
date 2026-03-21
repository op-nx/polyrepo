---
created: 2026-03-21T22:48:19.581Z
title: Run external repo Nx commands in devcontainer sidecar
area: executor
files: []
---

## Problem

The run executor currently proxies Nx targets to child repos by spawning commands directly on the host OS. This means the child repo's toolchain (Node version, native dependencies, platform-specific binaries) must be compatible with the host. On Windows arm64, x86_64 native modules need QEMU emulation, and repos with Linux-only tooling can't run at all.

A devcontainer sidecar would let each synced repo define its own containerized development environment, so the polyrepo plugin could dispatch Nx commands into the sidecar instead of running them on the host.

## Solution

Explore a devcontainer-based execution model:

1. Detect `.devcontainer/devcontainer.json` in synced repos under `.repos/<alias>/`
2. When a proxy target is invoked, check if a devcontainer sidecar is already running for that repo
3. If not, start one (via `devcontainer up` CLI or Docker API)
4. Execute the Nx command inside the sidecar (via `devcontainer exec` or `docker exec`)
5. Stream stdout/stderr back through the run executor's output handling
6. Consider lifecycle management — keep sidecars warm between runs, shut down on workspace close

Key considerations:
- Fallback to host execution when no devcontainer config exists
- Volume mounting `.repos/<alias>/` into the container vs. cloning inside
- Port forwarding for dev servers
- Performance overhead of container startup vs. QEMU emulation overhead
- Integration with `runCommandsImpl` from `@nx/workspace`
