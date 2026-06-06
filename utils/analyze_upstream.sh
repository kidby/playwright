#!/usr/bin/env bash
set -euo pipefail

UPSTREAM_REMOTE="${PLAYWRIGHT_UPSTREAM_REMOTE:-origin}"
UPSTREAM_BRANCH="${PLAYWRIGHT_UPSTREAM_BRANCH:-main}"

echo "Fetching ${UPSTREAM_REMOTE}/${UPSTREAM_BRANCH}..."
git fetch "$UPSTREAM_REMOTE" "$UPSTREAM_BRANCH" --quiet

BASE=$(git merge-base HEAD "${UPSTREAM_REMOTE}/${UPSTREAM_BRANCH}")
if [ "$BASE" == "$(git rev-parse HEAD)" ]; then
  echo "Current branch is behind upstream. Fast-forward is possible. No conflicts."
  exit 0
fi

echo "Running dry-run conflict analysis against upstream..."
echo

# Perform an in-memory merge without touching the working tree
MERGE_OUTPUT=$(git merge-tree HEAD "${UPSTREAM_REMOTE}/${UPSTREAM_BRANCH}" 2>&1 || true)

if echo "$MERGE_OUTPUT" | grep -q "Auto-merging"; then
  echo "--- DIVERGED FILES ---"
  echo "$MERGE_OUTPUT" | grep "Auto-merging" || true
  echo
fi

if echo "$MERGE_OUTPUT" | grep -q "CONFLICT"; then
  echo "!!! CRITICAL CONFLICTS DETECTED !!!"
  echo "The following files will cause merge conflicts if pulled:"
  echo "$MERGE_OUTPUT" | grep "CONFLICT" || true
  echo
  echo "Recommendation: Do not automate merge. Manually rebase and resolve the above files."
  exit 1
else
  echo "Analysis complete: No merge conflicts detected. It is safe to run git merge."
  exit 0
fi
