#!/usr/bin/env bash
set -e
H=/home/huagosr/wechat-linux-research/hub/data/workers/opencode/ex-19/home
WS=/home/huagosr/worker-sandbox-untrusted/calc
K=$(cut -d= -f2 ~/.opencode/.env)

node -e '
const fs = require("fs");
const p = process.env.HOME + "/wechat-linux-research/hub/data/workers/opencode/ex-19/home/.opencode/opencode.json";
const j = {
  model: "hub/ds",
  small_model: "hub/ds",
  experimental: { policies: [ { effect: "deny", action: "provider.use", resource: "*" }, { effect: "allow", action: "provider.use", resource: "hub" } ] },
  provider: { hub: { npm: "@ai-sdk/openai-compatible", name: "HubDS", options: { baseURL: "http://127.0.0.1:8000/v1", apiKey: "{env:DEEPSEEK_API_KEY}" }, models: { ds: { name: "Hub DS" } } } },
  permission: { edit: "allow", bash: "allow", webfetch: "ask" },
};
fs.writeFileSync(p, JSON.stringify(j, null, 2));
'

node ~/tmp-proxy.js > /tmp/proxy5.log 2>&1 &
PROXY=$!
sleep 1

nohup bwrap --unshare-user --unshare-ipc --unshare-pid --unshare-uts --unshare-cgroup \
  --ro-bind /usr /usr --ro-bind /bin /bin --ro-bind /lib /lib --ro-bind /lib64 /lib64 --ro-bind /etc /etc \
  --proc /proc --dev /dev --tmpfs /tmp \
  --bind "$H" "$H" --setenv HOME "$H" \
  --ro-bind "$HOME/.opencode/bin" /opt/opencode-bin \
  --ro-bind "$HOME/.opencode/node_modules" "$H/.opencode/node_modules" \
  --bind "$WS" "$WS" --chdir "$WS" \
  --clearenv --setenv PATH "/usr/bin:/bin:/usr/sbin:/sbin" --setenv LANG "C.UTF-8" \
  --setenv DEEPSEEK_API_KEY "$K" --setenv OPENCODE_DISABLE_AUTOUPDATE 1 \
  --die-with-parent -- /opt/opencode-bin/opencode serve --port 4792 --hostname 127.0.0.1 > /tmp/oc-proxy-serve5.log 2>&1 < /dev/null &
disown
for i in $(seq 1 30); do
  sleep 1
  curl -s -o /dev/null -w "%{http_code}" -m 5 http://127.0.0.1:4792/doc | grep -q 200 && break
done
echo "serve up"
node -e '
(async () => {
  const r1 = await fetch("http://127.0.0.1:4792/api/session", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ location: { directory: "/home/huagosr/worker-sandbox-untrusted/calc" }, model: { id: "ds", providerID: "hub" } }),
  });
  const sid = (await r1.json()).data.id;
  console.log("sid:", sid);
  fetch("http://127.0.0.1:4792/global/event", { headers: { accept: "text/event-stream" } }).then(async (res) => {
    const reader = res.body.getReader(); const dec = new TextDecoder();
    while (true) { const { done, value } = await reader.read(); if (done) break; dec.decode(value, { stream: true }); }
  }).catch(() => {});
  await new Promise((r) => setTimeout(r, 2000));
  await fetch(`http://127.0.0.1:4792/api/session/${sid}/prompt`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: { text: "PONG" } }),
  });
  console.log("prompt sent, waiting 45s");
  await new Promise((r) => setTimeout(r, 45000));
  process.exit(0);
})();
'
sleep 2
kill $PROXY 2>/dev/null
echo "=== proxy captured ==="
grep -o '"auth":"[^"]*"' /tmp/proxy5.log | head -3
grep -c chat/completions /tmp/proxy5.log
pkill -f "opencode serve --port 4792" 2>/dev/null
