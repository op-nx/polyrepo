#!/bin/sh
set -euo pipefail

# Creates a tiny synthetic Nx workspace at /repos/test-repo
# for e2e testing. Uses the NX_VERSION ARG from the Dockerfile.

echo "[INFO] Creating synthetic Nx test repo..."

WORKDIR=$(mktemp -d)

echo "[INFO] Scaffolding Nx workspace with create-nx-workspace@${NX_VERSION}..."
npx --yes create-nx-workspace@${NX_VERSION} test-repo \
  --preset=apps --interactive=false --nxCloud=skip

mv test-repo "$WORKDIR/test-repo"

echo "[INFO] Creating lib-a and lib-b manually..."
mkdir -p "$WORKDIR/test-repo/libs/lib-a/src"
mkdir -p "$WORKDIR/test-repo/libs/lib-b/src"

cat > "$WORKDIR/test-repo/libs/lib-a/project.json" << 'LIBAEOF'
{
  "name": "lib-a",
  "sourceRoot": "libs/lib-a/src"
}
LIBAEOF

cat > "$WORKDIR/test-repo/libs/lib-a/src/index.ts" << 'SRCAEOF'
export const greeting = 'hello from lib-a';
SRCAEOF

cat > "$WORKDIR/test-repo/libs/lib-b/project.json" << 'LIBBEOF'
{
  "name": "lib-b",
  "sourceRoot": "libs/lib-b/src"
}
LIBBEOF

cat > "$WORKDIR/test-repo/libs/lib-b/src/index.ts" << 'SRCBEOF'
export const greeting = 'hello from lib-b';
SRCBEOF

echo "[INFO] Running npm install..."
cd "$WORKDIR/test-repo"
npm install

echo "[INFO] Initializing git repo..."
git init
git add -A
git commit -m "init"

echo "[INFO] Moving to /repos/test-repo..."
mkdir -p /repos
mv "$WORKDIR/test-repo" /repos/test-repo

echo "[INFO] Synthetic test repo created at /repos/test-repo"
echo "[INFO] Projects: lib-a, lib-b + default workspace project"
