#!/usr/bin/env bash
# Out-of-band manual apply: deploy validated hub-dev content to production Hub.
# Run by the user over SSH, fully independent of the running Hub.
# Usage: bash scripts/apply-hub.sh <applyRequestId> [source_commit]
set -euo pipefail
if [ "$0" != "/tmp/apply-hub.sh" ]; then cp "$0" /tmp/apply-hub.sh; exec bash /tmp/apply-hub.sh "$@"; fi

REQ_ID="${1:?usage: apply-hub.sh <applyRequestId> [source_commit]}"
PROD="$HOME/wechat-linux-research/hub"
DEV="${HUB_DEV:-$HOME/worker-sandbox-untrusted/hub-dev}"
BACKUP_DIR="$HOME/wechat-linux-research/hub-backups"
MANIFEST="$BACKUP_DIR/manifest.json"
BASE_TAG="${HUB_BASE_TAG:-phase6d-known-good}"
TS=$(date +%Y%m%d-%H%M%S)

cd "$DEV"
SOURCE_COMMIT="${2:-$(git rev-parse HEAD)}"
git rev-parse --verify "$SOURCE_COMMIT^{commit}" >/dev/null
BASE=$(git rev-parse "$BASE_TAG" 2>/dev/null || echo "")

echo "== confirm =="
echo "apply request : $REQ_ID"
echo "source commit : $SOURCE_COMMIT"
git log -1 --format='subject       : %s' "$SOURCE_COMMIT"
read -rp "continue? [y/N] " ans
[ "$ans" == "y" ] || exit 1

echo "== stop hub =="
systemctl --user stop personal-hub

echo "== backup production =="
TAR="$BACKUP_DIR/hub-$TS.tar.gz"
tar -czf "$TAR" -C "$PROD" --exclude=data --exclude=logs --exclude='*.tar.gz' .
SHA=$(sha256sum "$TAR" | cut -d' ' -f1)
echo "backup: $TAR (sha256 $SHA)"
if [ -f "$PROD/data/hub.db" ]; then cp "$PROD/data/hub.db" "$BACKUP_DIR/hub-$TS.db"; fi

echo "== deploy dev -> production =="
rsync -a --delete --exclude data --exclude logs --exclude config/config.json --exclude .git "$DEV"/ "$PROD"/

echo "== start hub =="
systemctl --user start personal-hub
sleep 3

echo "== health check =="
ok=1
curl -sf http://127.0.0.1:8300/api/status >/dev/null || { echo "FAIL: /api/status"; ok=0; }
curl -sf -o /dev/null http://127.0.0.1:8300/ || { echo "FAIL: / (dashboard)"; ok=0; }
curl -sf http://127.0.0.1:8300/api/bootstrap/status >/dev/null || { echo "FAIL: /api/bootstrap/status"; ok=0; }

CHANGED=""
if [ -n "$BASE" ]; then CHANGED=$(git diff --name-only "$BASE" "$SOURCE_COMMIT" 2>/dev/null | paste -sd, - || true); fi

if [ "$ok" == "1" ]; then
  echo "== APPLY OK =="
  curl -sf -X POST "http://127.0.0.1:8300/api/apply-requests/$REQ_ID/status" \
    -H 'Content-Type: application/json' \
    -d "{\"state\":\"APPLIED\",\"note\":\"backup=$TAR sha256=$SHA\"}" >/dev/null || true
  node -e '
    const fs = require("fs");
    const f = process.argv[1];
    let arr = [];
    try { arr = JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) {}
    arr.push({
      source_commit: process.argv[2],
      applied_at: new Date().toISOString(),
      backup_tar: process.argv[3],
      backup_sha256: process.argv[4],
      changed_files: (process.argv[5] || "").split(",").filter(Boolean),
    });
    fs.writeFileSync(f, JSON.stringify(arr, null, 2) + "\n");
  ' "$MANIFEST" "$SOURCE_COMMIT" "$TAR" "$SHA" "$CHANGED"
  echo "manifest updated: $MANIFEST"
else
  echo "== APPLY FAILED (health check) =="
  echo "DO NOT retry blindly. Run rollback:"
  echo "  bash $PROD/scripts/rollback-hub.sh latest"
  curl -sf -X POST "http://127.0.0.1:8300/api/apply-requests/$REQ_ID/status" \
    -H 'Content-Type: application/json' \
    -d "{\"state\":\"FAILED\",\"note\":\"health check failed; backup=$TAR\"}" >/dev/null || true
  exit 1
fi
