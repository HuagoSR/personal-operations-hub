#!/usr/bin/env bash
node -e '
const j = require(process.env.HOME + "/.cache/opencode/models.json");
const walk = (o, path) => {
  if (o && typeof o === "object") {
    for (const k of Object.keys(o)) {
      if (k.toLowerCase().includes("deepseek")) {
        console.log("KEY:", path + "." + k);
        console.log(JSON.stringify(o[k], null, 1).slice(0, 800));
      }
      walk(o[k], path + "." + k);
    }
  }
};
walk(j, "$");
'
