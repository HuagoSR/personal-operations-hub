#!/usr/bin/env bash
node -e '
const fs = require("fs");
const events = JSON.parse(fs.readFileSync("/tmp/oc-session-events2.json", "utf8"));
const failed = events.filter((e) => (e.type||"").includes("failed"));
for (const e of failed) {
  const d = e.data || {};
  console.log("FAILED EVENT:", JSON.stringify(d.error || d, null, 1).slice(0, 800));
}
console.log("all types:", [...new Set(events.map(e=>e.type))].join(", "));
'
