#!/usr/bin/env bash
PORT=46561
echo "=== session list on serve ==="
curl -s -m 10 "http://127.0.0.1:$PORT/api/session?limit=10" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);(j.data||[]).forEach(s=>console.log(s.id, JSON.stringify(s.title)))})'
echo "=== opencode.db in profile ==="
ls -la ~/wechat-linux-research/hub/data/workers/opencode/ex-16/home/.local/share/opencode/
echo "=== session dirs ==="
find ~/wechat-linux-research/hub/data/workers/opencode/ex-16/home/.local/share/opencode -maxdepth 2 -type d | head -10
