#!/usr/bin/env bash
SID=$(curl -s "http://127.0.0.1:4096/api/session?limit=5" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);console.log(j.data && j.data[0] ? j.data[0].id : "")})')
echo "latest session: $SID"
echo "=== messages ==="
curl -s "http://127.0.0.1:4096/api/session/$SID/message" | head -c 2000
echo
echo "=== saved permissions ==="
curl -s "http://127.0.0.1:4096/api/permission/saved" | head -c 400
echo
echo "=== openapi for /api/permission/request ==="
node -e '
const fs = require("fs");
const j = JSON.parse(fs.readFileSync("/tmp/oc-openapi.json", "utf8"));
const p = j.paths["/api/permission/request"];
console.log(JSON.stringify(p, null, 1).slice(0, 700));
'
