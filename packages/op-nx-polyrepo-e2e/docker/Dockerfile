FROM node:22-slim

# Install git (needed for nrwl/nx clone and Nx operations)
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# Disable Nx daemon inside container (prevents file locks and timeouts)
ENV NX_DAEMON=false

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
ARG NX_REF=master
RUN git clone --depth 1 --branch ${NX_REF} https://github.com/nrwl/nx.git /repos/nx

WORKDIR /workspace

# Keep container alive for exec commands
CMD ["sleep", "infinity"]
