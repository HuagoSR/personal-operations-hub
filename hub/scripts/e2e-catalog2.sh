#!/usr/bin/env bash
node -e '
const j = require(process.env.HOME + "/.cache/opencode/models.json");
console.log("top-level keys:", Object.keys(j).join(", "));
if (j.providers) {
  console.log("provider keys:", Object.keys(j.providers).join(", "));
  if (j.providers.deepseek) console.log("deepseek provider:", JSON.stringify(j.providers.deepseek, null, 1).slice(0, 800));
}
if (j.deepprovider || j.deepseek) console.log("deepseek root:", JSON.stringify(j.deepseek || j.deepprovider, null, 1).slice(0, 600));
'
