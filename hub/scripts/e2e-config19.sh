#!/usr/bin/env bash
P=$(pgrep -af 'opencode serve' | grep -v 4096 | grep -oE 'port [0-9]+' | head -1 | awk '{print $2}')
echo "serve port: $P"
curl -s -m 10 "http://127.0.0.1:$P/config" -o /tmp/cfg19.json
node -e '
const j = require("/tmp/cfg19.json");
const p = j.provider && j.provider.deepseek;
const opts = p && p.options;
console.log("model:", j.model);
console.log("provider deepseek present:", !!p);
console.log("baseURL:", opts && opts.baseURL);
const k = opts && opts.apiKey;
console.log("apiKey resolved:", k === undefined ? "undefined" : k === "" ? "EMPTY STRING" : k.includes("env:") ? "UNRESOLVED:" + k.slice(0, 30) : "RESOLVED len=" + k.length);
'
