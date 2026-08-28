#!/usr/bin/env bash
SID=$(curl -s "http://127.0.0.1:4096/api/session?limit=5" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);console.log(j.data && j.data[0] ? j.data[0].id : "")})')
echo "sid=$SID"
echo "--- v1 /session/status ---"
curl -s -w "\nHTTP %{http_code}\n" "http://127.0.0.1:4096/session/status" | head -c 400
echo "--- v1 /session (list) ---"
curl -s "http://127.0.0.1:4096/session" | head -c 500
echo
echo "--- session info ---"
curl -s "http://127.0.0.1:4096/api/session/$SID" | head -c 700
echo
