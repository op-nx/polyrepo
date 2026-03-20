# syntax=docker/dockerfile:1
# ─── Stage 1: expensive nrwl/nx preparation (cached independently) ───────────
FROM node:22-slim AS nx-prep

RUN apt-get update && apt-get install -y --no-install-recommends \
    git ca-certificates default-jre-headless && \
    rm -rf /var/lib/apt/lists/*

ENV NX_DAEMON=false CI=true

RUN git config --global user.email "e2e@test.local" && \
    git config --global user.name "e2e"

# Clone nrwl/nx at pinned ref (rebuilds only on NX_REF change)
ARG NX_VERSION=22.5.4
ARG NX_REF=${NX_VERSION}
RUN git clone --depth 1 --branch ${NX_REF} https://github.com/nrwl/nx.git /repos/nx

# Install deps — warm pnpm store via BuildKit cache mount
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    cd /repos/nx && corepack enable && \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm install --frozen-lockfile

# Pre-sync: clone to /synced-nx (same as what polyrepo-sync does at runtime)
RUN git clone /repos/nx /synced-nx

RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    cd /synced-nx && corepack enable && \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm install --frozen-lockfile

# Pre-warm Nx graph cache AND capture raw JSON for the polyrepo plugin.
# The plugin's extractGraphFromRepo() reads this cached file instead of
# spawning a child `nx graph --print` process (~4-5 min cold start due to
# @nx/gradle JVM init). The JSON is copied alongside .repos/nx/ so the
# plugin can find it at .repos/nx/.nx-graph-output.json.
# || true: don't fail the build if a plugin errors — graph cache is best-effort.
RUN cd /synced-nx && npx nx graph --print > /synced-nx/.nx-graph-output.json 2>/dev/null || true

# ─── Stage 2: workspace setup (cached, changes on NX_VERSION bump) ───────────
FROM node:22-slim AS workspace

RUN apt-get update && apt-get install -y --no-install-recommends \
    git ca-certificates default-jre-headless && \
    rm -rf /var/lib/apt/lists/*

# NX_DAEMON=false: prevent file locks and timeouts in container.
# CI=true: bypass nrwl/nx preinstall script that requires Rust compiler.
# Must be ENV (not inline) so the sync executor's `corepack pnpm install`
# inherits it at test time.
ENV NX_DAEMON=false CI=true

RUN git config --global user.email "e2e@test.local" && \
    git config --global user.name "e2e"

# Copy prebaked nrwl/nx source repo (for file:///repos/nx clone source)
COPY --link --from=nx-prep /repos/nx /repos/nx

# Create workspace (--skip-git: we init after adding .repos/ to .gitignore)
ARG NX_VERSION=22.5.4
RUN npx --yes create-nx-workspace@${NX_VERSION} workspace \
    --preset=apps --interactive=false --nx-cloud=skip --skip-git

# Add .repos/ to .gitignore before git init — matches local dev setup
RUN echo "\n# Synced polyrepo workspaces\n.repos/" >> /workspace/.gitignore

# Init git with .repos/ already ignored from the first commit
RUN cd /workspace && git init && git add . && git commit -m "initial"

# Copy pre-synced nrwl/nx into workspace .repos/ (clone + node_modules + graph cache)
COPY --link --from=nx-prep /synced-nx /workspace/.repos/nx

WORKDIR /workspace

# Pre-warm the host workspace's Nx cache (.nx/workspace-data/).
# This caches file scanning, built-in plugin processing, and the base
# project graph. When the polyrepo plugin is installed later (in
# global-setup), Nx incrementally updates the cached graph instead of
# rebuilding from scratch.
RUN NX_DAEMON=false npx nx show projects 2>/dev/null || true

CMD ["sleep", "infinity"]

# ─── Stage 3: snapshot (rebuilds on every plugin source change) ──────────────
FROM workspace AS snapshot

# Stable args first — don't bust cache for the nx.json write
ARG NX_VERSION=22.5.4
ARG PLUGIN_TAG=e2e

# Write nx.json with polyrepo plugin config
RUN printf '{\n  "plugins": [\n    {\n      "plugin": "@op-nx/polyrepo",\n      "options": {\n        "repos": {\n          "nx": { "url": "file:///repos/nx", "depth": 1, "ref": "%s" }\n        }\n      }\n    }\n  ]\n}\n' "${NX_VERSION}" > /workspace/nx.json

# Volatile arg last — only busts cache from here onwards
ARG REGISTRY_URL

# Install plugin from Verdaccio (running on host, reached via host.docker.internal)
RUN npm install -D "@op-nx/polyrepo@${PLUGIN_TAG}" --registry "${REGISTRY_URL}" --no-audit

# Warm the plugin's graph cache. The plugin reads the pre-computed
# .nx-graph-output.json (from the workspace stage) instead of spawning a
# ~5 min child nx graph --print process.
RUN NX_DAEMON=false npx nx show projects 2>/dev/null || true
