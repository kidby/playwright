#!/bin/bash
# Isolated benchmark script for fork vs upstream Playwright
# Run inside Docker for clean, reproducible numbers
set -uo pipefail

echo "============================================"
echo "  Playwright Fork vs Upstream Benchmark"
echo "  $(date -Iseconds)"
echo "  Node: $(node --version)"
echo "  Bun:  $(bun --version 2>/dev/null || echo 'N/A')"
echo "  CPUs: $(nproc)"
echo "  RAM:  $(free -h 2>/dev/null | awk '/Mem:/{print $2}' || echo 'N/A')"
echo "============================================"
echo ""

FORK_DIR=/bench/fork
UP_DIR=/bench/upstream
SUITES="match-grep.spec.ts exit-code.spec.ts"

# Rebuild native modules for Linux (host node_modules has macOS binaries)
echo "Rebuilding native deps for Linux..."
OXC_DIR=$(find $FORK_DIR/node_modules -path '*oxc-transform/index.js' -exec dirname {} \; | head -1)
if [ -n "$OXC_DIR" ]; then
  cd "$OXC_DIR" && npm install @oxc-transform/binding-linux-arm64-gnu@0.134.0 --no-save 2>/dev/null && echo "oxc-transform binding installed" || true
fi
cd /bench
echo ""



run_suite() {
  local label="$1" runtime="$2" cli="$3" config="$4" spec="$5"
  echo "--- $label: $(basename $spec) ---"
  
  local output
  output=$( { /usr/bin/time -v "$runtime" "$cli" test \
    --config="$config" "$spec" \
    --reporter=line -j 1 2>&1; } || true )
  
  local wall=$(echo "$output" | grep -oP 'Elapsed.*?: \K[\d:.]+' || echo "?")
  local maxrss=$(echo "$output" | grep -i 'maximum resident' | grep -oP '\d+' || echo "?")
  local passed=$(echo "$output" | grep -oP '\d+ passed' | head -1 || echo "?")
  
  echo "  $passed | wall=$wall | maxRSS=${maxrss}KB"
  echo ""
}

echo "======= BUNDLE SIZES ======="
echo "Fork utilsBundle:    $(wc -c < $FORK_DIR/packages/playwright-core/lib/utilsBundle.js) bytes"
echo "Upstream utilsBundle:$(wc -c < $UP_DIR/packages/playwright-core/lib/utilsBundle.js 2>/dev/null || echo ' N/A') bytes"
echo "Fork coreBundle:     $(wc -c < $FORK_DIR/packages/playwright-core/lib/coreBundle.js) bytes"
echo "Upstream coreBundle: $(wc -c < $UP_DIR/packages/playwright-core/lib/coreBundle.js 2>/dev/null || echo ' N/A') bytes"
echo ""

echo "======= CLI STARTUP (3 runs each) ======="
echo "--- Node fork ---"
for i in 1 2 3; do /usr/bin/time -f "  real %es, maxRSS %MKB" node $FORK_DIR/node_modules/playwright/cli.js --version 2>&1; done
echo "--- Node upstream ---"
for i in 1 2 3; do /usr/bin/time -f "  real %es, maxRSS %MKB" node $UP_DIR/tests/playwright-test/stable-test-runner/node_modules/.bin/playwright --version 2>&1; done
if command -v bun &>/dev/null; then
  echo "--- Bun fork ---"
  for i in 1 2 3; do /usr/bin/time -f "  real %es, maxRSS %MKB" bun $FORK_DIR/node_modules/playwright/cli.js --version 2>&1; done
fi
echo ""

echo "======= TEST SUITES (single worker) ======="
for spec in $SUITES; do
  FORK_SPEC="$FORK_DIR/tests/playwright-test/$spec"
  UP_SPEC="$UP_DIR/tests/playwright-test/$spec"
  FORK_CFG="$FORK_DIR/tests/playwright-test/playwright.config.ts"
  UP_CFG="$UP_DIR/tests/playwright-test/playwright.config.ts"

  if [ -f "$FORK_SPEC" ]; then
    echo "=== Node fork: $spec ==="
    /usr/bin/time -f "  wall %es | user %Us | sys %Ss | maxRSS %MKB" \
      node $FORK_DIR/node_modules/playwright/cli.js test \
      --config="$FORK_CFG" "$FORK_SPEC" --reporter=line -j 1 2>&1 | tail -5
    echo ""
  fi
  
  if [ -f "$UP_SPEC" ]; then
    echo "=== Node upstream: $spec ==="
    /usr/bin/time -f "  wall %es | user %Us | sys %Ss | maxRSS %MKB" \
      node $UP_DIR/tests/playwright-test/stable-test-runner/node_modules/.bin/playwright test \
      --config="$UP_CFG" "$UP_SPEC" --reporter=line -j 1 2>&1 | tail -5
    echo ""
  fi
  
  if command -v bun &>/dev/null && [ -f "$FORK_SPEC" ]; then
    echo "=== Bun fork: $spec ==="
    /usr/bin/time -f "  wall %es | user %Us | sys %Ss | maxRSS %MKB" \
      bun $FORK_DIR/node_modules/playwright/cli.js test \
      --config="$FORK_CFG" "$FORK_SPEC" --reporter=line -j 1 2>&1 | tail -5
    echo ""
  fi
done

echo "======= IMPORT TIME ======="
echo "--- Node fork ---"
/usr/bin/time -f "  %es" node -e "require('$FORK_DIR/packages/playwright/lib')" 2>&1
echo "--- Node upstream ---"
/usr/bin/time -f "  %es" node -e "require('$UP_DIR/packages/playwright/lib')" 2>&1
echo ""

echo "============================================"
echo "  Benchmark complete at $(date -Iseconds)"
echo "============================================"
