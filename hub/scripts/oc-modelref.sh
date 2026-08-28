#!/usr/bin/env bash
node -e '
const fs = require("fs");
const j = JSON.parse(fs.readFileSync("/tmp/oc-openapi.json", "utf8"));
const c = j.components.schemas;
for (const k of ["ModelRef", "Model"]) {
  const s = c[k];
  if (s) console.log(k + ":", JSON.stringify(s).slice(0, 600));
}
'
echo "=== redacted /config model line ==="
curl -s http://127.0.0.1:4096/config | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);if(j.options&&j.options.apiKey)j.options.apiKey="REDACTED";console.log(JSON.stringify({model:j.model,small_model:j.small_model,agent:j.agent,mode:j.mode,provider:j.provider},null,1))})'
