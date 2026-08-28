#!/usr/bin/env bash
echo "=== all sessions ==="
curl -s "http://127.0.0.1:4096/api/session?limit=10" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);(j.data||[]).forEach(s=>console.log(s.id, JSON.stringify(s.title||"")))})'
echo "=== v1 /session list ==="
curl -s "http://127.0.0.1:4096/session" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);(j||[]).forEach(s=>console.log(s.id, JSON.stringify(s.title||"")))})'
echo "=== messages of fix-task session via v2 ==="
curl -s "http://127.0.0.1:4096/api/session/ses_fb70a95abffeJ3gFJAy1WVKzsc/message" | head -c 400
echo
echo "=== messages via v1 ==="
curl -s "http://127.0.0.1:4096/session/ses_fb70a95abffeJ3gFJAy1WVKzsc/message" | head -c 400
echo
