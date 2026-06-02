#!/usr/bin/env bash
set -e
set +x

# Base Ubuntu codename. Override per-invocation: DISTRO=jammy ./build.sh ...
# The corresponding Dockerfile.${DISTRO} must exist in this directory.
DISTRO="${DISTRO:-noble}"

if [[ ($1 == '--help') || ($1 == '-h') || ($1 == '') || ($2 == '') ]]; then
  echo "usage: $(basename $0) {--arm64,--amd64} mkidby/playwright:v1.61.0-${DISTRO}"
  echo
  echo "Build the fork's Playwright docker image (Ubuntu ${DISTRO}) and tag it."
  echo "Once built, run it with:"
  echo
  echo "  docker run --rm -it mkidby/playwright:v1.61.0-${DISTRO} /bin/bash"
  echo
  echo "Override the base distro:  DISTRO=<codename> $(basename $0) ..."
  echo
  echo "Prereqs:"
  echo "  - 'npm install' completed"
  echo "  - 'npm run build' completed (or 'npm run watch' running)"
  echo
  exit 0
fi

function cleanup() {
  rm -f "playwright-core.tar.gz"
}

trap "cleanup; cd $(pwd -P)" EXIT
cd "$(dirname "$0")"

# Bundled into the image so browsers install from fork sources, not the
# upstream npm release.
node ../../utils/pack_package.js playwright-core ./playwright-core.tar.gz

PLATFORM=""
if [[ "$1" == "--arm64" ]]; then
  PLATFORM="linux/arm64";
elif [[ "$1" == "--amd64" ]]; then
  PLATFORM="linux/amd64"
else
  echo "ERROR: unknown platform specifier - $1. Only --arm64 or --amd64 is supported"
  exit 1
fi

docker build --platform "${PLATFORM}" -t "$2" -f "Dockerfile.${DISTRO}" .
