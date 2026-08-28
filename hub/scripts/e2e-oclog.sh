#!/usr/bin/env bash
L=~/wechat-linux-research/hub/data/workers/opencode/ex-16/home/.local/share/opencode/log
ls -la $L
tail -n 25 $L/$(ls -t $L | head -1)
