#!/usr/bin/env bash
cd ~/wechat-linux-research/hub
node -e '
const { DatabaseSync } = require("node:sqlite");
const db = new DatabaseSync("data/hub.db", { readOnly: true });
console.log(db.prepare("SELECT id,state,deadline_at,started_at,error FROM executions WHERE id >= 10 ORDER BY id").all());
'
