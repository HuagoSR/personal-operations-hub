#!/usr/bin/env bash
H=~/wechat-linux-research/hub/data/workers/opencode/ex-20/home
echo "=== profile node_modules ==="
du -sh $H/.opencode/node_modules 2>/dev/null
ls $H/.opencode/node_modules/@ai-sdk 2>/dev/null
echo "=== config ==="
cat $H/.opencode/opencode.json
echo "=== serve log tail ==="
L=$(ls -t $H/.local/share/opencode/log/*.log | head -1)
tail -n 10 "$L"
