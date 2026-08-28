#!/usr/bin/env bash
curl -s http://127.0.0.1:8300/api/executions/25 -o /tmp/ex25b.json
node -e '
const j = require("/tmp/ex25b.json");
console.log("state:", j.execution.state);
console.log("perms:", j.permissions.map((p) => p.id + ":" + p.capability + ":" + p.state).join(", "));
'
