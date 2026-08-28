#!/usr/bin/env bash
# check-readonly.sh — static read-only boundary check for gateway source
# Exit 0 = clean; Exit 1 = violation found.
set -u
GATEWAY_DIR="$HOME/wechat-linux-research/gateway"

echo "=== static read-only check on $GATEWAY_DIR/src ==="
VIOLATIONS=$(grep -RInE "method[[:space:]]*[:=][[:space:]]*['\"](POST|PUT|PATCH|DELETE)|send_message|messages/send|chats/.*/open|status/logout" "$GATEWAY_DIR/src" || true)

if [ -n "$VIOLATIONS" ]; then
  echo "VIOLATIONS FOUND:"
  echo "$VIOLATIONS"
  exit 1
fi

echo "CLEAN: no POST/send/open/logout references in gateway source"
exit 0
