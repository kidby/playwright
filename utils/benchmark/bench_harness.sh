#!/usr/bin/env bash
# Locked benchmark harness: fork vs upstream, cold vs warm.
# Usage: bash bench_harness.sh [reps=15] [suite=match-grep]
REPS=${1:-15}
SUITE=${2:-match-grep}
WORKERS=1

FORK_DIR="/Users/anonymi/playwright"
UPSTREAM_DIR="/tmp/pw-upstream"

echo "# Node: $(node --version), Reps: $REPS, Suite: $SUITE, Workers: $WORKERS"
echo "# Fork: $(cd "$FORK_DIR" && git rev-parse --short HEAD)"
echo "# Date: $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
echo "branch,suite,rep,type,wall_s,rss_bytes,passed"

run_fork() {
  local rep=$1 type=$2
  local result
  result=$( { /usr/bin/time -l node "$FORK_DIR/node_modules/playwright/cli.js" test \
    --config="$FORK_DIR/tests/playwright-test/playwright.config.ts" \
    "$FORK_DIR/tests/playwright-test/${SUITE}.spec.ts" \
    --reporter=line -j $WORKERS ; } 2>&1 )
  local wall=$(echo "$result" | awk '/real/{print $1}')
  local rss=$(echo "$result" | awk '/maximum resident/{print $1}')
  local passed=$(echo "$result" | grep -oE '[0-9]+ passed' | awk '{print $1}')
  echo "fork,$SUITE,$rep,$type,${wall:-?},${rss:-?},${passed:-0}"
}

run_upstream() {
  local rep=$1 type=$2
  local result
  result=$( { /usr/bin/time -l node "$UPSTREAM_DIR/tests/playwright-test/stable-test-runner/node_modules/@playwright/test/cli.js" test \
    --config="$UPSTREAM_DIR/tests/playwright-test/playwright.config.ts" \
    "$UPSTREAM_DIR/tests/playwright-test/${SUITE}.spec.ts" \
    --reporter=line -j $WORKERS ; } 2>&1 )
  local wall=$(echo "$result" | awk '/real/{print $1}')
  local rss=$(echo "$result" | awk '/maximum resident/{print $1}')
  local passed=$(echo "$result" | grep -oE '[0-9]+ passed' | awk '{print $1}')
  echo "upstream,$SUITE,$rep,$type,${wall:-?},${rss:-?},${passed:-0}"
}

clear_caches() {
  rm -rf /var/folders/4t/knz90zj13sl4n4vpkn3f_lcr0000gn/T/node-compile-cache 2>/dev/null
  find /tmp -maxdepth 1 -name "playwright-transform-cache*" -exec rm -rf {} + 2>/dev/null
  return 0
}

# Cold runs
for i in 1 2 3; do clear_caches; run_fork $i cold; done
for i in 1 2 3; do clear_caches; run_upstream $i cold; done

# Warmup (discard)
run_fork w1 warmup > /dev/null
run_fork w2 warmup > /dev/null
run_upstream w1 warmup > /dev/null
run_upstream w2 warmup > /dev/null

# Warm runs
for i in $(seq 1 $REPS); do run_fork $i warm; done
for i in $(seq 1 $REPS); do run_upstream $i warm; done
