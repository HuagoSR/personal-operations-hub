#!/usr/bin/env bash
curl -s http://127.0.0.1:8300/api/results -o /tmp/results.json
node -e '
const j = require("/tmp/results.json");
console.log("results:", j.length);
const r = j.find((x) => x.worker === "codex");
if (r) console.log("codex result id:", r.id, "summary:", r.summary.slice(0, 100));
'
curl -s http://127.0.0.1:8300/api/tasks/21 -o /tmp/task21.json
node -e '
const j = require("/tmp/task21.json");
console.log("task21 state:", j.task.state);
'
