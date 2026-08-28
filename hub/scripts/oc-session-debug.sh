#!/usr/bin/env bash
cd ~/wechat-linux-research/hub
node -e '
const fs = require("fs");
const path = require("path");
const { OpenCodeWorkerSession } = require("./src/workers/opencode-worker");
const { Logger } = require("./src/logger");

(async () => {
  const key = fs.readFileSync(process.env.HOME + "/.opencode/.env", "utf8").split("\n")[0].split("=")[1].trim();
  const homeDir = "/home/huagosr/wechat-linux-research/hub/data/workers/opencode/ex-10/home";
  const profile = {
    workspace: "/home/huagosr/worker-sandbox-untrusted/calc",
    home_dir: homeDir,
    network_mode: "allow",
  };
  const fakeCtx = {
    cfg: { workerDeepseekApiKey: key, dataDir: "/home/huagosr/wechat-linux-research/hub/data" },
    logger: new Logger({ level: "DEBUG" }),
  };
  const db = { prepare() { return { get() { return null; }, all() { return []; }, run() { return { changes: 1, lastInsertRowid: 1 }; } }; } };
  const grant = { capabilities_json: JSON.stringify({ network: "allow" }) };
  const execution = { id: 10, worker: "opencode", grant_id: 1, state: "RUNNING", version: 1 };
  const s = new OpenCodeWorkerSession(db, fakeCtx, execution, grant, profile);
  try {
    await s.ensureServer();
    console.log("ensureServer OK, base =", s.base);
    const r = await fetch(s.base + "/doc");
    console.log("doc status:", r.status);
    const ev = await fetch(s.base + "/global/event", { headers: { accept: "text/event-stream" } });
    console.log("event stream status:", ev.status, ev.headers.get("content-type"));
    ev.body.cancel();
    s.server.kill("SIGTERM");
  } catch (e) {
    console.log("FAILED:", e.message, e.cause ? e.cause.message : "");
  }
  setTimeout(() => process.exit(0), 3000);
})();
'
