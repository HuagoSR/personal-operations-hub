#!/usr/bin/env bash
P=$(pgrep -af "codex app-server" | grep -v 8765 | head -1 | cut -c1-100)
echo "worker codex proc: $P"
pgrep -af "codex app-server" | grep -v 8765 | wc -l
L=$(ls -t ~/wechat-linux-research/hub/data/workers/codex/ex-25/home/.codex/sessions/*/*/* 2>/dev/null | head -2)
echo "session files:"
ls -lat ~/wechat-linux-research/hub/data/workers/codex/ex-25/home/.codex/sessions/ 2>/dev/null | head -5
