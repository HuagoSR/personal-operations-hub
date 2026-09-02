#!/usr/bin/env bash
# Out-of-band rollback: restore production Hub from a backup tar.
# Fully independent of the Hub (works even when Hub cannot start).
# Usage: bash scripts/rollback-hub.sh [latest|<timestamp>]
set -euo pipefail
if [ "$0" != "/tmp/rollback-hub.sh" ]; then cp "$0" /tmp/rollback-hub.sh; exec bash /tmp/rollback-hub.sh "$@"; fi

PROD="$HOME/wechat-linux-research/hub"
BACKUP_DIR="$HOME/wechat-linux-research/hub-backups"
SEL="${1:-latest}"
if [ "$SEL" == "latest" ]; then
  TAR=$(ls -t "$BACKUP_DIR"/hub-*.tar.gz 2>/dev/null | head -n 1)
else
  TAR="$BACKUP_DIR/hub-$SEL.tar.gz"
fi
if [ -z "$TAR" ] || [ ! -f "$TAR" ]; then echo "no backup found for '$SEL'"; exit 1; fi
echo "restoring from: $TAR"
systemctl --user stop personal-hub 2>/dev/null || true
rm -rf "$PROD/src" "$PROD/tests" "$PROD/scripts" "$PROD/package.json" "$PROD/config/config.example.json"
tar -xzf "$TAR" -C "$PROD" --exclude=config/config.json
systemctl --user start personal-hub
sleep 3
if curl -sf http://127.0.0.1:8300/api/status >/dev/null && curl -sf -o /dev/null http://127.0.0.1:8300/; then
  echo "ROLLBACK OK: hub healthy after restore"
else
  echo "ROLLBACK FAILED: hub not healthy after restore; inspect: journalctl --user -u personal-hub -n 50"
  exit 1
fi
