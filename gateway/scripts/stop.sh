#!/usr/bin/env bash
# stop.sh — graceful stop (SIGTERM triggers flush + cursor persist)
set -euo pipefail
GATEWAY_DIR="$HOME/wechat-linux-research/gateway"

if systemctl --user list-unit-files wechat-gateway.service >/dev/null 2>&1; then
  systemctl --user stop wechat-gateway
  echo "stopped via systemd --user"
else
  pid_file="$GATEWAY_DIR/data/state/gateway.pid"
  if [ -f "$pid_file" ]; then
    pid=$(cat "$pid_file")
    if kill -0 "$pid" 2>/dev/null; then
      kill -TERM "$pid"
      echo "SIGTERM sent to pid $pid"
      for i in $(seq 1 15); do
        kill -0 "$pid" 2>/dev/null || { echo "stopped"; exit 0; }
        sleep 1
      done
      echo "WARN: gateway did not exit in 15s"
      exit 1
    fi
  fi
  echo "gateway not running"
fi
