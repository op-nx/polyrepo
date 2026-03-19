# syntax=docker/dockerfile:1
FROM node:22-slim

# Install git (needed for nrwl/nx clone and Nx operations)
# Install default-jre-headless (needed for @nx/gradle plugin in nrwl/nx repo)
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates default-jre-headless && \
    rm -rf /var/lib/apt/lists/*

# Disable Nx daemon inside container (prevents file locks and timeouts)
# CI=true bypasses nrwl/nx preinstall script that requires Rust compiler.
# The preinstall is a contributor-environment gate (scripts/preinstall.js),
# not needed for running Nx. Must be ENV (not inline) so the sync executor's
# `corepack pnpm install` inherits it at test time.
ENV NX_DAEMON=false CI=true

# Configure git identity for create-nx-workspace initial commit
RUN git config --global user.email "e2e@test.local" && \
    git config --global user.name "e2e"

# --- Expensive layers: nrwl/nx clone + pnpm install ---
# These are placed BEFORE workspace setup so that changes to .gitignore logic,
# create-nx-workspace flags, or other workspace scaffolding do NOT invalidate
# the 10-15 min pnpm install layer.

# Prebake git clone of nrwl/nx at pinned ref
# This layer rebuilds only when NX_REF (or NX_VERSION) changes
ARG NX_VERSION=22.5.4
ARG NX_REF=${NX_VERSION}
RUN git clone --depth 1 --branch ${NX_REF} https://github.com/nrwl/nx.git /repos/nx

# Prebake pnpm install for nrwl/nx to warm pnpm content-addressable store.
# The sync executor runs `corepack pnpm install` after cloning into the workspace,
# but git clone does not carry node_modules. With a warm pnpm store, the install
# resolves from cache via hardlinks instead of downloading packages.
# --mount=type=cache: BuildKit persistent cache for the pnpm store — even when
# this layer is invalidated, previously downloaded packages are still in the
# store and resolve via hardlinks instead of network fetches.
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    cd /repos/nx && corepack enable && COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm install --frozen-lockfile

# --- Pre-sync: clone nrwl/nx into workspace .repos/ and warm graph cache ---
# Replicates what polyrepo-sync does, but at build time (no time pressure).
# The plugin isn't installed yet, but the expensive parts (clone, pnpm install,
# nx graph --print with Gradle/Maven init) are plugin-independent.
RUN git clone /repos/nx /workspace/.repos/nx
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    cd /workspace/.repos/nx && corepack enable && COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm install --frozen-lockfile
# Pre-warm Nx graph cache inside the synced repo (Gradle daemon init is ~2min).
# || true: don't fail the build if a plugin errors — the graph cache is best-effort.
RUN cd /workspace/.repos/nx && npx nx graph --print > /dev/null 2>&1 || true

# --- Cheap layers: workspace setup (~60s rebuild) ---
# Changes here do NOT invalidate the expensive nrwl/nx layers above.

# Prebake create-nx-workspace output (skip git — we init after adding .repos/ to .gitignore)
# This layer rebuilds only when NX_VERSION changes
# --nxCloud=skip: skip CI workflow generation (--ci is an alias for --nxCloud,
#   passing both produces "skip,skip" which fails schema validation)
RUN npx --yes create-nx-workspace@${NX_VERSION} workspace \
    --preset=apps --interactive=false --nxCloud=skip --skipGit

# Add .repos/ to .gitignore before git init so it's ignored from the first commit.
# Matches the real-world local setup where .repos/ is always gitignored.
RUN echo "\n# Synced polyrepo workspaces\n.repos/" >> /workspace/.gitignore

# Now init git with .repos/ already in .gitignore
RUN cd /workspace && git init && git add . && git commit -m "initial"

WORKDIR /workspace

# Keep container alive for exec commands
CMD ["sleep", "infinity"]
