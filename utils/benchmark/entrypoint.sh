#!/usr/bin/env bash
# Entrypoint: copy sources, rebuild native bindings for Linux, then benchmark.
set -euo pipefail

echo "=== Preparing benchmark environment ==="

# Copy fork source and rebuild native bindings for Linux
if [ -d /fork-src ]; then
  echo "Copying fork source..."
  cp -a /fork-src /fork
  cd /fork
  # Bun installs platform-specific native bindings under .bun/
  # Just install the missing Linux binding directly
  echo "Installing Linux-native oxc-transform binding..."
  npm install @oxc-transform/binding-linux-arm64-gnu 2>&1 | tail -1 || true
  echo "Fork ready."
fi

# Copy upstream source and rebuild
if [ -d /upstream-src ]; then
  echo "Copying upstream source..."
  cp -a /upstream-src /upstream
  echo "Upstream ready."
fi

# Run the benchmark
exec /bench/run.sh
