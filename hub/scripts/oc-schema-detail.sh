#!/usr/bin/env bash
node -e '
const fs = require("fs");
const j = JSON.parse(fs.readFileSync("/tmp/oc-openapi.json", "utf8"));
const c = j.components.schemas || {};
for (const k of ["LocationRef", "PromptInput", "PermissionV2Reply", "QuestionV2Reply", "SessionV2Info", "PermissionV2Request", "SessionInputAdmitted", "TextPart", "ToolPart", "SessionMessageV2"]) {
  const s = c[k];
  console.log("=== " + k);
  console.log(JSON.stringify(s, null, 0).slice(0, 900));
}
'
