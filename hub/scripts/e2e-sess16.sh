#!/usr/bin/env bash
cd ~/wechat-linux-research/hub
INFO=$(node -e '
const { DatabaseSync } = require("node:sqlite");
const db = new DatabaseSync("data/hub.db", { readOnly: true });
const r = db.prepare("SELECT session_id, worker_port FROM worker_profiles WHERE execution_id = 16").get();
console.log(r ? r.session_id : "none", r && r.worker_port ? r.worker_port : "");
')
SID=$(echo $INFO | cut -d' ' -f1)
PORT=$(echo $INFO | cut -d' ' -f2)
echo "sid=$SID port=$PORT"
curl -s -m 10 "http://127.0.0.1:$PORT/api/session/$SID/message" -o /tmp/sess16.json
node -e '
const j = require("/tmp/sess16.json");
const ms = (j.data && j.data.data) || [];
console.log("messages:", ms.length);
for (const m of ms.slice(0, 4)) {
  console.log("---", m.type, m.completed ? "DONE" : "");
  if (m.text) console.log(m.text.slice(0, 200));
  for (const c of (m.content || [])) {
    if (c.type === "tool") console.log("  TOOL", c.name, c.state ? c.state.status : "?", JSON.stringify(c.state && c.state.input).slice(0, 100));
    if (c.type === "text") console.log("  TEXT:", c.text.slice(0, 200));
  }
}
'
