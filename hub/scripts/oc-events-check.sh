#!/usr/bin/env bash
node -e '
const fs = require("fs");
const events = JSON.parse(fs.readFileSync("/tmp/oc-runtime-events.json", "utf8"));
const failed = events.filter((e) => (e.type||"").includes("failed"));
for (const e of failed) console.log(JSON.stringify(e, null, 1).slice(0, 1200));
'
echo "=== config endpoint ==="
curl -s http://127.0.0.1:4096/config | head -c 1500
echo
