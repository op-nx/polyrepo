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

# Prebake create-nx-workspace output
# This layer rebuilds only when NX_VERSION changes
# --nxCloud=skip: skip CI workflow generation (--ci is an alias for --nxCloud,
#   passing both produces "skip,skip" which fails schema validation)
ARG NX_VERSION=22.5.4
RUN npx --yes create-nx-workspace@${NX_VERSION} workspace \
    --preset=apps --interactive=false --nxCloud=skip

# Prebake git clone of nrwl/nx at pinned ref
# This layer rebuilds only when NX_REF changes
ARG NX_REF=${NX_VERSION}
RUN git clone --depth 1 --branch ${NX_REF} https://github.com/nrwl/nx.git /repos/nx

# Prebake pnpm install for nrwl/nx to warm pnpm content-addressable store.
# The sync executor runs `corepack pnpm install` after cloning into the workspace,
# but git clone does not carry node_modules. With a warm pnpm store, the install
# resolves from cache via hardlinks instead of downloading packages.
RUN cd /repos/nx && corepack enable && CI=true COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm install --frozen-lockfile

WORKDIR /workspace

# Keep container alive for exec commands
CMD ["sleep", "infinity"]
