#!/usr/bin/env bash
# Launch benchmark in Docker with resource-equivalent constraints.
# Pre-built fork and upstream are bind-mounted read-only.
#
# Usage:
#   ./utils/benchmark/bench.sh              # Node benchmark
#   RUNTIME=bun ./utils/benchmark/bench.sh  # Bun benchmark
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
FORK_DIR="${FORK_DIR:-$(cd "$SCRIPT_DIR/../.." && pwd)}"
UPSTREAM_DIR="${UPSTREAM_DIR:-/tmp/pw-upstream}"
RUNTIME="${RUNTIME:-node}"
CPUS="${CPUS:-4}"
MEMORY="${MEMORY:-8g}"
ITERATIONS="${ITERATIONS:-3}"
IMAGE="pw-bench-runner"

# Build runner image if needed
if ! docker image inspect "$IMAGE" &>/dev/null; then
  echo "Building benchmark runner image..."
  docker build -t "$IMAGE" -f "$SCRIPT_DIR/Dockerfile.runner" "$SCRIPT_DIR"
fi

echo "=== Docker Benchmark ==="
echo "Fork:     $FORK_DIR"
echo "Upstream: $UPSTREAM_DIR"
echo "Runtime:  $RUNTIME"
echo "CPUs:     $CPUS"
echo "Memory:   $MEMORY"
echo ""

docker run --rm \
  --cpus="$CPUS" \
  --memory="$MEMORY" \
  -v "$FORK_DIR:/fork:ro" \
  -v "$UPSTREAM_DIR:/upstream:ro" \
  -e RUNTIME="$RUNTIME" \
  -e ITERATIONS="$ITERATIONS" \
  "$IMAGE"
