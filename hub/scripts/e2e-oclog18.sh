#!/usr/bin/env bash
L=$(ls -t ~/wechat-linux-research/hub/data/workers/opencode/ex-18/home/.local/share/opencode/log/*.log | head -1)
echo "log: $L"
tail -n 12 "$L"
