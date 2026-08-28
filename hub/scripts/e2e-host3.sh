#!/usr/bin/env bash
set -e
export PATH="$HOME/.opencode/bin:$PATH"
export DEEPSEEK_API_KEY=$(cut -d= -f2 ~/.opencode/.env)
cat > ~/.opencode/opencode.json <<'EOF'
{
  "model": "deepseek/deepseek-v4-pro",
  "small_model": "deepseek/deepseek-v4-pro",
  "provider": {
    "deepseek": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "DeepSeek",
      "options": {
        "baseURL": "https://api.deepseek.com/v1",
        "apiKey": "{env:DEEPSEEK_API_KEY}"
      },
      "models": {
        "deepseek-v4-pro": { "name": "DeepSeek V4 Pro" }
      }
    }
  },
  "permission": { "edit": "allow", "bash": "allow", "webfetch": "ask" }
}
EOF
pkill -f "opencode serve" 2>/dev/null || true
sleep 2
nohup opencode serve --port 4096 --hostname 127.0.0.1 > /tmp/oc-host3.log 2>&1 < /dev/null &
disown
for i in $(seq 1 30); do
  sleep 1
  curl -s -o /dev/null -w "%{http_code}" -m 5 http://127.0.0.1:4096/doc | grep -q 200 && break
done
echo "host serve up"
node -e '
(async () => {
  const r1 = await fetch("http://127.0.0.1:4096/api/session", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ location: { directory: "/home/huagosr/worker-sandbox-untrusted/calc" }, model: { id: "deepseek-v4-pro", providerID: "deepseek" } }),
  });
  const sid = (await r1.json()).data.id;
  console.log("sid:", sid);
  await new Promise((r) => setTimeout(r, 1000));
  await fetch(`http://127.0.0.1:4096/api/session/${sid}/prompt`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: { text: "Reply with exactly: PONG" } }),
  });
  console.log("prompt sent, waiting 90s");
  await new Promise((r) => setTimeout(r, 90000));
  const m = await fetch(`http://127.0.0.1:4096/api/session/${sid}/message`);
  const j = await m.json();
  const ms = (j.data && j.data.data) || [];
  for (const x of ms) {
    if (x.text) console.log("MSG:", x.text.slice(0, 150));
    for (const c of (x.content || [])) {
      if (c.type === "text") console.log("TEXT:", c.text.slice(0, 150));
    }
  }
  process.exit(0);
})();
'
