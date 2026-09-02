#!/usr/bin/env bash
# Read-only summary of a pending Hub self update. Never modifies production.
set -euo pipefail
DEV="${HUB_DEV:-$HOME/worker-sandbox-untrusted/hub-dev}"
BASE_TAG="${HUB_BASE_TAG:-phase6d-known-good}"
cd "$DEV"
HEAD=$(git rev-parse HEAD)
BASE=$(git rev-parse "$BASE_TAG" 2>/dev/null || git rev-parse HEAD~1)
echo "Source commit: $HEAD"
echo "Base commit:   $BASE"
git log -1 --format='Subject: %s' "$HEAD"
echo "Changed files:"
git diff --numstat "$BASE" "$HEAD" | awk '{printf "  %-55s +%s -%s\n", $3, $1, $2}'
echo "Working tree dirty: $(git status --porcelain | wc -l) files"
