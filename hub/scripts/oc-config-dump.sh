#!/usr/bin/env bash
echo "=== ~/.config/opencode/config.json ==="
cat ~/.config/opencode/config.json 2>/dev/null | head -c 1500
echo
echo "=== ~/.config/opencode/opencode.json ==="
cat ~/.config/opencode/opencode.json 2>/dev/null | head -c 800
echo
echo "=== ~/.opencode/opencode.json (effective) ==="
cat ~/.opencode/opencode.json | head -c 800
echo
