#!/usr/bin/env bash
P=$(ss -tlnp 2>/dev/null | grep -oE '127\.0\.0\.1:4[0-9]{4}' | grep -vE ':4096|:4567|:4599' | cut -d: -f2 | head -1)
echo "worker serve port: $P"
curl -s -m 10 "http://127.0.0.1:$P/config" -o /tmp/sandbox-config.json
node -e '
const j = require("/tmp/sandbox-config.json");
const redact = (o) => {
  if (o && typeof o === "object") {
    for (const k of Object.keys(o)) {
      if (k === "apiKey") o[k] = "REDACTED";
      else redact(o[k]);
    }
  }
  return o;
};
const r = redact(j);
console.log(JSON.stringify({ model: r.model, small_model: r.small_model, providerKeys: Object.keys(r.provider || {}), provider: r.provider }, null, 1).slice(0, 1200));
'
echo "=== sandbox home .opencode ==="
ls -la ~/wechat-linux-research/hub/data/workers/opencode/ex-18/home/.opencode/ 2>/dev/null
echo "=== sandbox home .config ==="
ls -la ~/wechat-linux-research/hub/data/workers/opencode/ex-18/home/.config/opencode/ 2>/dev/null
