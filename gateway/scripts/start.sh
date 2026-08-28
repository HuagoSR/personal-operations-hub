#!/usr/bin/env bash
# start.sh — start gateway via systemd --user (fallback: direct nohup)
set -euo pipefail
GATEWAY_DIR="$HOME/wechat-linux-research/gateway"

if systemctl --user list-unit-files wechat-gateway.service >/dev/null 2>&1; then
  systemctl --user start wechat-gateway
  echo "started via systemd --user"
  systemctl --user status wechat-gateway --no-pager | head -6
else
  cd "$GATEWAY_DIR"
  if [ -f data/state/gateway.pid ]; then
    pid=$(cat data/state/gateway.pid)
    if kill -0 "$pid" 2>/dev/null; then
      echo "Gateway already running (pid $pid)"
      exit 1
    fi
  fi
  nohup node src/collector.js >> logs/startup.log 2>&1 &
  echo "started via nohup (pid $!)"
fi
