#!/usr/bin/env bash
# Benchmark runner for Docker container
# Compares Fork vs Upstream with resource monitoring
# Env vars: RUNTIME (node|bun), ITERATIONS (default 3), FORK_DIR, UPSTREAM_DIR
set -euo pipefail

RUNTIME=${RUNTIME:-node}
ITERATIONS=${ITERATIONS:-3}
FORK_DIR=${FORK_DIR:-/fork}
UPSTREAM_DIR=${UPSTREAM_DIR:-/upstream}

echo "========================================"
echo "  Playwright Fork vs Upstream Benchmark"
echo "========================================"
echo "Runtime:    $RUNTIME"
echo "Iterations: $ITERATIONS"
echo "Node:       $(node --version)"
if command -v bun &>/dev/null; then
  echo "Bun:        $(bun --version)"
fi
echo "CPUs:       $(nproc)"
echo "Memory:     $(free -h 2>/dev/null | awk '/Mem:/{print $2}' || echo 'N/A')"
echo "Date:       $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "Fork:       $(cd $FORK_DIR && git log --oneline -1 2>/dev/null || echo 'built')"
echo "Upstream:   $(cd $UPSTREAM_DIR && git log --oneline -1 2>/dev/null || echo 'built')"
echo ""

# CSV output
RESULTS="/tmp/benchmark_results.csv"
echo "branch,runtime,suite,iteration,wall_time_s,peak_rss_kb,cpu_pct,tests_passed,tests_failed" > "$RESULTS"

run_test() {
  local branch=$1
  local dir=$2
  local suite=$3
  local test_file=$4
  local iter=$5

  local runner
  if [ "$branch" = "upstream" ]; then
    runner="node ./tests/playwright-test/stable-test-runner/node_modules/@playwright/test/cli test --config=tests/playwright-test/playwright.config.ts"
  else
    if [ "$RUNTIME" = "bun" ]; then
      runner="bun ./node_modules/playwright/cli.js test --config=tests/playwright-test/playwright.config.ts"
    else
      runner="node ./node_modules/playwright/cli.js test --config=tests/playwright-test/playwright.config.ts"
    fi
  fi

  local tmpout tmptime
  tmpout=$(mktemp)
  tmptime=$(mktemp)

  local start end wall_s exit_code=0
  start=$(date +%s%N)

  # Run with /usr/bin/time for resource tracking (GNU time on Linux)
  /usr/bin/time -v bash -c "cd $dir && $runner $test_file --reporter=line" > "$tmpout" 2> "$tmptime" || exit_code=$?

  end=$(date +%s%N)
  wall_s=$(echo "scale=3; ($end - $start) / 1000000000" | bc)

  # Parse GNU time output
  local peak_rss_kb cpu_pct
  peak_rss_kb=$(grep 'Maximum resident set size' "$tmptime" | awk '{print $NF}' || echo "0")
  cpu_pct=$(grep 'Percent of CPU' "$tmptime" | awk '{print $NF}' || echo "0%")

  # Extract pass/fail
  local passed failed
  passed=$(grep -oE '[0-9]+ passed' "$tmpout" | awk '{print $1}' || echo "0")
  failed=$(grep -oE '[0-9]+ failed' "$tmpout" | awk '{print $1}' || echo "0")

  echo "$branch,$RUNTIME,$suite,$iter,$wall_s,$peak_rss_kb,$cpu_pct,$passed,$failed" | tee -a "$RESULTS"

  rm -f "$tmpout" "$tmptime"
}

# Test suites that exist on both branches
SUITES=(
  "basic:tests/playwright-test/basic.spec.ts"
  "hooks:tests/playwright-test/hooks.spec.ts"
  "expect:tests/playwright-test/expect.spec.ts"
  "match-grep:tests/playwright-test/match-grep.spec.ts"
)

for suite_entry in "${SUITES[@]}"; do
  IFS=':' read -r suite_name test_file <<< "$suite_entry"
  echo ""
  echo "--- Suite: $suite_name ---"

  for i in $(seq 1 $ITERATIONS); do
    run_test "fork"     "$FORK_DIR"     "$suite_name" "$test_file" "$i"
    run_test "upstream" "$UPSTREAM_DIR"  "$suite_name" "$test_file" "$i"
  done
done

echo ""
echo "========================================"
echo "  Results"
echo "========================================"
echo ""
column -t -s',' "$RESULTS"
echo ""
echo "Raw CSV: $RESULTS"

# Summary
echo ""
echo "--- Averages ---"
for suite_entry in "${SUITES[@]}"; do
  IFS=':' read -r suite_name _ <<< "$suite_entry"

  fork_avg=$(grep "^fork,$RUNTIME,$suite_name," "$RESULTS" | awk -F',' '{sum+=$5; n++} END {if(n>0) printf "%.2f", sum/n; else print "N/A"}')
  upstream_avg=$(grep "^upstream,$RUNTIME,$suite_name," "$RESULTS" | awk -F',' '{sum+=$5; n++} END {if(n>0) printf "%.2f", sum/n; else print "N/A"}')
  fork_rss=$(grep "^fork,$RUNTIME,$suite_name," "$RESULTS" | awk -F',' '{sum+=$6; n++} END {if(n>0) printf "%.0f", sum/n; else print "N/A"}')
  upstream_rss=$(grep "^upstream,$RUNTIME,$suite_name," "$RESULTS" | awk -F',' '{sum+=$6; n++} END {if(n>0) printf "%.0f", sum/n; else print "N/A"}')

  echo "$suite_name: Fork=${fork_avg}s (RSS:${fork_rss}KB) | Upstream=${upstream_avg}s (RSS:${upstream_rss}KB)"
done

echo ""
echo "Benchmark complete."
