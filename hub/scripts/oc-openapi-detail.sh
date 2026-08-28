#!/usr/bin/env bash
node -e '
const fs = require("fs");
const j = JSON.parse(fs.readFileSync("/tmp/oc-openapi.json", "utf8"));
const paths = j.paths || {};
const want = [
  "/api/session", "/api/session/{sessionID}", "/api/session/{sessionID}/prompt",
  "/api/session/{sessionID}/message", "/api/session/{sessionID}/wait",
  "/api/session/{sessionID}/event", "/api/session/{sessionID}/history",
  "/api/session/{sessionID}/permission/{requestID}", "/api/session/{sessionID}/permission/{requestID}/reply",
  "/api/session/{sessionID}/question/{requestID}/reply", "/api/session/{sessionID}/interrupt",
  "/api/session/{sessionID}/agent", "/api/session/{sessionID}/model"
];
for (const p of want) {
  const pathObj = paths[p];
  if (!pathObj) { console.log("=== MISSING:", p); continue; }
  for (const [m, op] of Object.entries(pathObj)) {
    console.log("=== " + m.toUpperCase() + " " + p);
    const params = (op.parameters || []).map((x) => `${x.name}(${x.in})${x.required ? "*" : ""}`).join(", ");
    if (params) console.log("  params:", params);
    if (op.requestBody) {
      const sch = (op.requestBody.content || {})["application/json"];
      if (sch && sch.schema) console.log("  req:", JSON.stringify(sch.schema).slice(0, 600));
      else console.log("  req keys:", Object.keys(op.requestBody.content || {}).join(","));
    }
    const r200 = (op.responses || {})["200"] || (op.responses || {})["201"];
    if (r200 && r200.content && r200.content["application/json"]) {
      console.log("  resp:", JSON.stringify(r200.content["application/json"].schema).slice(0, 400));
    }
  }
}
'
