#!/usr/bin/env bash
set -e
set +x

# Base Ubuntu codename. Override per-invocation: DISTRO=jammy ./build_multiarch.sh ...
# The corresponding Dockerfile.${DISTRO} must exist in this directory.
DISTRO="${DISTRO:-noble}"

if [[ ($1 == '--help') || ($1 == '-h') || ($1 == '') ]]; then
  echo "usage: $(basename $0) mkidby/playwright:v1.61.0 [linux/amd64,linux/arm64]"
  echo
  echo "Build a multi-arch Playwright docker image (Ubuntu ${DISTRO}) and push"
  echo "it directly to a registry. Combines amd64 + arm64 into one manifest tag"
  echo "in a single buildx pass. The non-native arch is QEMU-emulated."
  echo "Default platforms: linux/amd64,linux/arm64"
  echo
  echo "Example:"
  echo "  $(basename $0) mkidby/playwright:v1.61.0"
  echo
  echo "Override the base distro:  DISTRO=<codename> $(basename $0) ..."
  echo
  echo "Prereqs:"
  echo "  - 'npm install' and 'npm run build' completed in the repo root"
  echo "  - 'docker login' completed for the target registry (e.g. docker.io)"
  echo "  - A buildx builder with 'docker-container' driver is active"
  echo "    (verify with: docker buildx inspect --bootstrap)"
  echo
  exit 0
fi

TAG="$1"
PLATFORMS="${2:-linux/amd64,linux/arm64}"

function cleanup() {
  rm -f "playwright-core.tar.gz"
}

trap "cleanup; cd $(pwd -P)" EXIT
cd "$(dirname "$0")"

# Same prep as build.sh — the Dockerfile installs browsers from this tarball
# rather than the upstream npm release, so the image carries fork sources.
node ../../utils/pack_package.js playwright-core ./playwright-core.tar.gz

# One pass, both platforms, pushed directly. `--push` is required for
# multi-platform builds with the docker-container driver — the local
# daemon only holds single-arch images, but the registry holds the
# manifest that resolves per-arch at pull time.
docker buildx build \
  --platform "${PLATFORMS}" \
  -t "${TAG}" \
  -f "Dockerfile.${DISTRO}" \
  --push \
  .
