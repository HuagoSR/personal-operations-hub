#!/usr/bin/env bash
L=$(ls -t ~/wechat-linux-research/hub/data/workers/opencode/ex-19/home/.local/share/opencode/log/*.log | head -1)
grep -E "401|stream error|llm runtime|provider" "$L" | tail -n 8
