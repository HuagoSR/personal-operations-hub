#!/usr/bin/env bash
cd ~/wechat-linux-research/hub
node -e '
const path = require("path");
const fs = require("fs");
const { runSandboxed } = require("./src/workers/exec/runner");
const KEY = fs.readFileSync(process.env.HOME + "/.opencode/.env", "utf8").split("\n")[0].split("=")[1].trim();
const H = "/home/huagosr/wechat-linux-research/hub/data/workers/opencode/ex-7/home";
const extraRoBinds = [
  [process.env.HOME + "/.opencode/bin", "/opt/opencode-bin"],
  [process.env.HOME + "/.opencode/node_modules", H + "/.opencode/node_modules"],
  [process.env.HOME + "/.cache/opencode", H + "/.cache/opencode"],
];
const child = runSandboxed(
  {
    workspace: "/home/huagosr/worker-sandbox-untrusted/calc",
    homeDir: H,
    network: "allow",
    env: ["DEEPSEEK_API_KEY=" + KEY],
    extraRoBinds,
  },
  ["/opt/opencode-bin/opencode", "serve", "--port", "4599", "--hostname", "127.0.0.1"],
  { stdio: ["ignore", "pipe", "pipe"] }
);
child.stdout.on("data", (d) => console.log("OUT:", d.toString().slice(0, 300)));
child.stderr.on("data", (d) => console.log("ERR:", d.toString().slice(0, 300)));
child.on("exit", (c) => { console.log("EXIT:", c); process.exit(0); });
setTimeout(async () => {
  try {
    const r = await fetch("http://127.0.0.1:4599/doc");
    console.log("DOC STATUS:", r.status);
    child.kill("SIGTERM");
  } catch (e) { console.log("DOC FETCH FAILED:", e.message); }
  setTimeout(() => process.exit(0), 2000);
}, 12000);
'
