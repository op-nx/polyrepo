FROM node:22-slim

# Install git (needed for nrwl/nx clone and Nx operations)
RUN apt-get update && apt-get install -y --no-install-recommends git && \
    rm -rf /var/lib/apt/lists/*

# Disable Nx daemon inside container (prevents file locks and timeouts)
ENV NX_DAEMON=false

# Prebake create-nx-workspace output
# This layer rebuilds only when NX_VERSION changes
ARG NX_VERSION=22.5.4
RUN npx --yes create-nx-workspace@${NX_VERSION} workspace \
    --preset=apps --ci=skip --interactive=false --nxCloud=skip \
    && mv workspace /workspace

# Prebake git clone of nrwl/nx at pinned ref
# This layer rebuilds only when NX_REF changes
ARG NX_REF=master
RUN git clone --depth 1 --branch ${NX_REF} https://github.com/nrwl/nx.git /repos/nx

WORKDIR /workspace

# Keep container alive for exec commands
CMD ["sleep", "infinity"]
