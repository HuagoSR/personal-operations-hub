#!/usr/bin/env bash
cd ~/wechat-linux-research/hub
SID=$(node -e '
const { DatabaseSync } = require("node:sqlite");
const db = new DatabaseSync("data/hub.db", { readOnly: true });
const r = db.prepare("SELECT session_id, worker_port FROM worker_profiles WHERE execution_id = 14").get();
console.log(r ? r.session_id + " " + r.worker_port : "none");
')
echo "sid+port: $SID"
SID=$(echo $SID | cut -d' ' -f1)
PORT=$(echo $SID | cut -d' ' -f2)
PORT=34845
curl -s "http://127.0.0.1:$PORT/api/session/$SID/message" -o /tmp/sess-msgs.json
node -e '
const j = require("/tmp/sess-msgs.json");
const ms = (j.data && j.data.data) || [];
console.log("messages:", ms.length);
for (const m of ms.slice(0, 3)) {
  console.log("-", m.type, "|", (m.text || "").slice(0, 150));
  for (const c of (m.content || [])) {
    if (c.type === "tool") console.log("  TOOL", c.name, c.state ? c.state.status : "?", JSON.stringify(c.state && (c.state.input || c.state.output || "")).slice(0, 120));
  }
}
'
