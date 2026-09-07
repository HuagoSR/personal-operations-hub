#!/usr/bin/env bash
# build-release.sh — build the v0.1.0 release artifact + SHA256SUMS (R0-F).
# Usage: ./build-release.sh [version]   (default: reads VERSION)
# Output: dist/personal-operations-hub-<version>.tar.gz + dist/SHA256SUMS
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
VER="${1:-$(cat "$ROOT/VERSION")}"
VER="${VER#v}"
OUT_DIR="$ROOT/dist"
TAR="$OUT_DIR/personal-operations-hub-$VER.tar.gz"

echo "== release gates =="
(cd "$ROOT/hub" && npm test >/dev/null 2>&1 && echo "npm test: PASS")
node "$ROOT/hub/scripts/release-check.js" "$ROOT" >/dev/null 2>&1 && echo "release-check (portable+secret): PASS"
bash "$ROOT/gateway/scripts/check-readonly.sh" >/dev/null && echo "check-readonly: PASS"

echo "== build artifact =="
rm -rf "$OUT_DIR"
mkdir -p "$OUT_DIR"
tar -czf "$TAR" -C "$ROOT" \
  --exclude=.git \
  --exclude='*/node_modules' \
  --exclude='*/data' \
  --exclude='*/logs' \
  --exclude=research \
  --exclude=dist \
  --exclude='*.db' \
  --exclude='*.db-wal' \
  --exclude='*.db-shm' \
  --exclude='*.jsonl' \
  --exclude='*.tar.gz' \
  --exclude='*.png' \
  --exclude=token \
  --exclude='hub/eval/intelligence/runs' \
  --exclude='hub-backups' \
  .
echo "artifact: $TAR ($(du -h "$TAR" | cut -f1))"

echo "== sha256 =="
(cd "$OUT_DIR" && sha256sum "personal-operations-hub-$VER.tar.gz" > SHA256SUMS)
cat "$OUT_DIR/SHA256SUMS"

echo "== artifact self-check =="
WORK="$(mktemp -d)"
tar -xzf "$TAR" -C "$WORK"
(cd "$WORK/hub" && npm test >/dev/null 2>&1 && echo "artifact npm test: PASS")
node "$WORK/hub/bin/hubctl.js" version
rm -rf "$WORK"
echo "== done =="
