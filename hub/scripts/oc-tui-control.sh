#!/usr/bin/env bash
echo "=== GET /tui/control/next (timeout 15s) ==="
timeout 15 curl -s http://127.0.0.1:4096/tui/control/next | head -c 1200
echo
echo "=== exit: $? ==="
