#!/usr/bin/env bash
echo "=== permission request list (by directory) ==="
curl -s "http://127.0.0.1:4096/api/permission/request?location[directory]=/home/huagosr/worker-sandbox/calc" | head -c 1500
echo
echo "=== schema of list response ==="
node -e '
const fs = require("fs");
const j = JSON.parse(fs.readFileSync("/tmp/oc-openapi.json", "utf8"));
const p = j.paths["/api/permission/request"].get;
const r200 = p.responses["200"];
console.log(JSON.stringify(r200, null, 1).slice(0, 900));
'
