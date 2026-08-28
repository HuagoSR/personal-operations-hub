#!/usr/bin/env bash
tail -n 25 ~/.local/share/opencode/log/opencode.log | grep -vE "loading path|bootstrapping|creating instance|fromDirectory"
