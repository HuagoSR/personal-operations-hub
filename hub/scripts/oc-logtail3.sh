#!/usr/bin/env bash
tail -n 20 ~/.local/share/opencode/log/opencode.log | grep -vE "loading path"
