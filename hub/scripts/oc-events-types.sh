#!/usr/bin/env bash
node -e '
const fs = require("fs");
const events = JSON.parse(fs.readFileSync("/tmp/oc-runtime-events.json", "utf8"));
const types = [...new Set(events.map((e) => e.type))];
console.log("observed event types:", types.join("\n"));
'
