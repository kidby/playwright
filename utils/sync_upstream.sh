#!/usr/bin/env bash
set -euo pipefail

UPSTREAM_REMOTE="${PLAYWRIGHT_UPSTREAM_REMOTE:-origin}"
UPSTREAM_BRANCH="${PLAYWRIGHT_UPSTREAM_BRANCH:-main}"

if ! git diff-index --quiet HEAD --; then
  echo "Working tree has uncommitted changes; aborting." >&2
  exit 1
fi

git fetch "$UPSTREAM_REMOTE" "$UPSTREAM_BRANCH"

incoming=$(git log --oneline "HEAD..${UPSTREAM_REMOTE}/${UPSTREAM_BRANCH}")
if [[ -z "$incoming" ]]; then
  echo "Already up to date with ${UPSTREAM_REMOTE}/${UPSTREAM_BRANCH}."
  exit 0
fi

count=$(echo "$incoming" | wc -l | tr -d ' ')
echo "Incoming from ${UPSTREAM_REMOTE}/${UPSTREAM_BRANCH} ($count commits):"
echo "$incoming"
echo

echo "--- Dry-Run Conflict Analysis ---"
MERGE_OUTPUT=$(git merge-tree HEAD "${UPSTREAM_REMOTE}/${UPSTREAM_BRANCH}" 2>&1 || true)
if echo "$MERGE_OUTPUT" | grep -q "CONFLICT"; then
  echo "!!! WARNING: CRITICAL CONFLICTS DETECTED !!!"
  echo "$MERGE_OUTPUT" | grep "CONFLICT" || true
  echo "Proceeding will result in a dirty working tree requiring manual resolution."
else
  echo "Analysis complete: No merge conflicts detected. Safe to merge."
fi
echo

read -p "Merge into $(git branch --show-current)? [y/N] " ack
[[ "$ack" == "y" || "$ack" == "Y" ]] || { echo "Aborted."; exit 0; }

if git merge --no-ff -m "merge main" "${UPSTREAM_REMOTE}/${UPSTREAM_BRANCH}"; then
  echo
  echo "Merge complete. Verifying with tsc..."
  npm run tsc
  echo "Done."
else
  echo
  echo "Conflicts detected. Resolve them, then run:"
  echo "  npm run tsc && git commit"
  exit 2
fi
