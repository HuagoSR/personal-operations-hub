#!/usr/bin/env bash
curl -s http://127.0.0.1:8300/api/executions/4 -o /tmp/ex4.json
node -e '
const j = require("/tmp/ex4.json");
console.log("state:", j.execution.state, "| error:", j.execution.error, "| worker:", j.execution.worker);
console.log("perms:", j.permissions.map(p => p.capability + ":" + p.state).join(",") || "none");
console.log("questions:", j.questions.map(q => q.state).join(",") || "none");
console.log("result:", j.result ? j.result.summary.slice(0, 150) : "no");
'
