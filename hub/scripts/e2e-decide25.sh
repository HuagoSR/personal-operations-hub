#!/usr/bin/env bash
curl -s http://127.0.0.1:8300/api/executions/25 -o /tmp/ex25.json
PID=$(node -e 'const j=require("/tmp/ex25.json");const p=j.permissions.find(x=>x.state==="OPEN");console.log(p?p.id:"")')
echo "permission id: $PID"
if [ -n "$PID" ]; then
  curl -s -X POST "http://127.0.0.1:8300/api/executions/25/permissions/$PID/decide" -H "Content-Type: application/json" -d '{"decision":"allow"}'
  echo
fi
