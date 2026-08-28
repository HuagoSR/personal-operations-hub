#!/usr/bin/env bash
echo "--- v1 /permission ---"
curl -s -w "\nHTTP %{http_code}\n" http://127.0.0.1:4096/permission | head -c 1200
echo
echo "--- v2 /api/permission/request (raw) ---"
curl -s -w "\nHTTP %{http_code}\n" "http://127.0.0.1:4096/api/permission/request" | head -c 1200
echo
echo "--- openapi /permission GET schema ---"
node -e '
const fs = require("fs");
const j = JSON.parse(fs.readFileSync("/tmp/oc-openapi.json", "utf8"));
const p = j.paths["/permission"];
console.log(JSON.stringify(p, null, 1).slice(0, 600));
'
