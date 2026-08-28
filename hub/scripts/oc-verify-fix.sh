#!/usr/bin/env bash
echo "=== calc.js ==="
cat ~/worker-sandbox/calc/src/calc.js
echo "=== npm test ==="
cd ~/worker-sandbox/calc && npm test 2>&1 | tail -n 8
echo "=== v1 diff endpoint ==="
SID=$(curl -s "http://127.0.0.1:4096/api/session?limit=3" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);console.log(j.data && j.data[0] ? j.data[0].id : "")})')
curl -s -w "\nHTTP %{http_code}\n" "http://127.0.0.1:4096/session/$SID/diff" | head -c 600
