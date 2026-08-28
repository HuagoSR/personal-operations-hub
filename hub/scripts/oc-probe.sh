#!/usr/bin/env bash
set -e
curl -s http://127.0.0.1:4096/doc -o /tmp/oc-openapi.json
node -e '
const fs = require("fs");
const j = JSON.parse(fs.readFileSync("/tmp/oc-openapi.json", "utf8"));
console.log("title:", j.info && j.info.title, j.info && j.info.version);
Object.keys(j.paths || {}).forEach((p) => console.log(p));
'
