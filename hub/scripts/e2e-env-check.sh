#!/usr/bin/env bash
cd ~/wechat-linux-research/hub
node -e '
const fs = require("fs");
const { runSandboxed } = require("./src/workers/exec/runner");
const KEY = fs.readFileSync(process.env.HOME + "/.opencode/.env", "utf8").split("\n")[0].split("=")[1].trim();
const H = "/home/huagosr/wechat-linux-research/hub/data/workers/opencode/ex-19/home";
const child = runSandboxed(
  {
    workspace: "/home/huagosr/worker-sandbox-untrusted/calc",
    homeDir: H,
    network: "allow",
    env: ["DEEPSEEK_API_KEY=" + KEY],
  },
  ["/usr/bin/env"],
  { stdio: ["ignore", "pipe", "pipe"] }
);
child.stdout.on("data", (d) => {
  const lines = d.toString().split("\n");
  for (const l of lines) {
    if (l.startsWith("DEEPSEEK")) console.log("DEEPSEEK env:", l.slice(0, 12) + "...len=" + (l.length - 18));
  }
  console.log("PATH:", d.toString().split("\n").find((l) => l.startsWith("PATH=")));
});
child.on("exit", () => process.exit(0));
'
