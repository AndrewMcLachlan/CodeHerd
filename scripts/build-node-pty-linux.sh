#!/usr/bin/env bash
# Recompile node-pty's pty.node against an old glibc so the Linux build runs on
# every distro Electron itself supports, not just ones as new as the build host.
#
# node-pty ships no Linux prebuild, so `npm ci` compiles pty.node on whatever
# machine runs it and the binary inherits that machine's glibc symbol versions.
# A build on a glibc 2.42 runner failed to load on glibc 2.39 distros with
# "Failed to load native module: pty.node". manylinux_2_28 (AlmaLinux 8,
# glibc 2.28) exists for exactly this: its gcc-toolset emits binaries that only
# need the glibc and libstdc++ of a 2018-era distro. 2.28 is also the floor of
# Node 22+, which node-gyp needs inside the container.
#
# Run from the repo root after `npm ci`, before packaging. Requires Docker.
set -euo pipefail

IMAGE="${MANYLINUX_IMAGE:-quay.io/pypa/manylinux_2_28_x86_64:2026.11.14-1@sha256:d086f64cddcace250ef0f0073583c51b8298159303290a730c9f59bd91edfd2c}"
PTY_DIR="node_modules/node-pty"
NODE_BIN="$(readlink -f "$(command -v node)")"
NPM_DIR="$(npm root -g)/npm"
NODE_GYP="node_modules/node-gyp/bin/node-gyp.js"
# binding.gyp runs require('node-addon-api'), which npm usually hoists out of
# node-pty's own folder, so resolve it the way node-pty would and copy it in.
ADDON_API="$(node -p "require('path').dirname(require.resolve('node-addon-api/package.json', { paths: ['$PTY_DIR'] }))")"

if [ ! -f "$PTY_DIR/binding.gyp" ]; then
  echo "::error::$PTY_DIR not found. Run npm ci first, from the repo root."
  exit 1
fi
if [ ! -f "$NPM_DIR/$NODE_GYP" ]; then
  echo "::error::node-gyp not found at $NPM_DIR/$NODE_GYP."
  exit 1
fi

# Inputs go in and the result comes out with `docker cp`, not bind mounts:
# Docker Desktop on Linux runs in a VM that only shares /home by default, so a
# bind mount of /usr/bin/node or a repo elsewhere silently arrives empty. The
# host's node binary and npm's bundled node-gyp are copied rather than
# installed, so the container builds with exactly the Node used everywhere
# else, and only those two are copied: a whole prefix such as /usr would put
# host tools built for a newer glibc ahead of the container's own on PATH.
CID=$(docker create \
  -e PYTHON=/opt/python/cp312-cp312/bin/python3 \
  "$IMAGE" \
  bash -euo pipefail -c "
    mkdir -p /tmp/nodebin && ln -s /opt/node-bin /tmp/nodebin/node
    export PATH=/tmp/nodebin:\$PATH HOME=/tmp
    cd /opt/node-pty
    node /opt/npm/$NODE_GYP rebuild
    node scripts/post-install.js
  ")
trap 'docker rm -f "$CID" > /dev/null' EXIT

docker cp -q "$NODE_BIN" "$CID:/opt/node-bin"
docker cp -q "$NPM_DIR" "$CID:/opt/npm"
# Stage node-pty with node-addon-api nested inside it, so one copy carries a
# layout that require() resolves without depending on how npm hoisted things.
STAGE="$(mktemp -d)"
trap 'docker rm -f "$CID" > /dev/null; rm -rf "$STAGE"' EXIT
cp -a "$PTY_DIR" "$STAGE/node-pty"
rm -rf "$STAGE/node-pty/build"
mkdir -p "$STAGE/node-pty/node_modules"
[ -d "$STAGE/node-pty/node_modules/node-addon-api" ] || cp -a "$ADDON_API" "$STAGE/node-pty/node_modules/"
docker cp -q "$STAGE/node-pty" "$CID:/opt/node-pty"

docker start -a "$CID"

rm -rf "$PTY_DIR/build"
docker cp -q "$CID:/opt/node-pty/build" "$PTY_DIR/build"
ls -la "$PTY_DIR/build/Release"
