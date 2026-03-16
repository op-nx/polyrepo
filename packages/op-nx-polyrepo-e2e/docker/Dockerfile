FROM node:22-slim

# Install git (needed for nrwl/nx clone and Nx operations)
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# Disable Nx daemon inside container (prevents file locks and timeouts)
ENV NX_DAEMON=false

# Prebake create-nx-workspace output
# This layer rebuilds only when NX_VERSION changes
# create-nx-workspace creates /workspace directly (default WORKDIR is /)
# git init and CI workflow steps may fail in Docker — non-critical
ARG NX_VERSION=22.5.4
RUN npx --yes create-nx-workspace@${NX_VERSION} workspace \
    --preset=apps --interactive=false --nxCloud=skip \
    || test -d /workspace

# Prebake git clone of nrwl/nx at pinned ref
# This layer rebuilds only when NX_REF changes
ARG NX_REF=master
RUN git clone --depth 1 --branch ${NX_REF} https://github.com/nrwl/nx.git /repos/nx

WORKDIR /workspace

# Keep container alive for exec commands
CMD ["sleep", "infinity"]
