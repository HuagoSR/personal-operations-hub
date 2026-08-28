#!/usr/bin/env bash
set -e
codex app-server daemon stop 2>&1 | head -n 2
sleep 2
nohup codex app-server --listen ws://127.0.0.1:8765 > /tmp/codex-ws.log 2>&1 < /dev/null &
disown
for i in $(seq 1 30); do
  sleep 1
  if curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8765/readyz | grep -q 200; then
    echo "codex app-server ws up (${i}s)"
    exit 0
  fi
done
echo "failed"; tail -n 10 /tmp/codex-ws.log; exit 1
