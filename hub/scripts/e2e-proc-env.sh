#!/usr/bin/env bash
P=$(pgrep -f "opencode serve" | grep -v "$(pgrep -f 'opencode serve --port 4096')" | head -1)
echo "opencode pid: $P"
tr '\0' '\n' < /proc/$P/environ | grep -E 'DEEPSEEK|HOME|PATH' | sed 's/\(DEEPSEEK_API_KEY=.\{8\}\).*/\1.../' 
