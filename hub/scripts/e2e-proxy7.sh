#!/usr/bin/env bash
set -e
H=/home/huagosr/worker-sandbox-untrusted/home3
WS=/home/huagosr/worker-sandbox-untrusted/calc
K=$(cut -d= -f2 ~/.opencode/.env)
rm -rf "$H"
mkdir -p $H/.opencode $H/.cache/opencode $H/.local/share/opencode
cp -r ~/.opencode/node_modules $H/.opencode/node_modules
cp ~/.cache/opencode/models.json $H/.cache/opencode/models.json
node -e '
const fs = require("fs");
const p = process.env.HOME + "/worker-sandbox-untrusted/home3/.cache/opencode/models.json";
const j = JSON.parse(fs.readFileSync(p, "utf8"));
j.deepseek.api = "http://127.0.0.1:8000/v1";
fs.writeFileSync(p, JSON.stringify(j));
'
cat > $H/.opencode/opencode.json <<'EOF'
{
  "model": "deepseek/deepseek-v4-pro",
  "small_model": "deepseek/deepseek-v4-pro",
  "permission": { "edit": "allow", "bash": "allow", "webfetch": "ask" }
}
EOF

node ~/tmp-proxy.js > /tmp/proxy7.log 2>&1 &
PROXY=$!
sleep 1

nohup bwrap --unshare-user --unshare-ipc --unshare-pid --unshare-uts --unshare-cgroup \
  --ro-bind /usr /usr --ro-bind /bin /bin --ro-bind /lib /lib --ro-bind /lib64 /lib64 --ro-bind /etc /etc \
  --proc /proc --dev /dev --tmpfs /tmp \
  --bind "$H" "$H" --setenv HOME "$H" \
  --ro-bind "$HOME/.opencode/bin" /opt/opencode-bin \
  --bind "$WS" "$WS" --chdir "$WS" \
  --clearenv --setenv PATH "/usr/bin:/bin:/usr/sbin:/sbin" --setenv LANG "C.UTF-8" \
  --setenv DEEPSEEK_API_KEY "$K" --setenv OPENCODE_DISABLE_AUTOUPDATE 1 \
  --die-with-parent -- /opt/opencode-bin/opencode serve --port 4795 --hostname 127.0.0.1 > /tmp/oc8.log 2>&1 < /dev/null &
disown
for i in $(seq 1 30); do
  sleep 1
  curl -s -o /dev/null -w "%{http_code}" -m 5 http://127.0.0.1:4795/doc | grep -q 200 && break
done
echo "serve up"
node -e '
(async () => {
  const r1 = await fetch("http://127.0.0.1:4795/api/session", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ location: { directory: "/home/huagosr/worker-sandbox-untrusted/calc" }, model: { id: "deepseek-v4-pro", providerID: "deepseek" } }),
  });
  const sid = (await r1.json()).data.id;
  fetch("http://127.0.0.1:4795/global/event", { headers: { accept: "text/event-stream" } }).then(async (res) => {
    const reader = res.body.getReader(); const dec = new TextDecoder();
    while (true) { const { done, value } = await reader.read(); if (done) break; dec.decode(value, { stream: true }); }
  }).catch(() => {});
  await new Promise((r) => setTimeout(r, 2000));
  await fetch(`http://127.0.0.1:4795/api/session/${sid}/prompt`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: { text: "PONG" } }),
  });
  console.log("prompt sent, waiting 60s");
  await new Promise((r) => setTimeout(r, 60000));
  process.exit(0);
})();
'
sleep 2
kill $PROXY 2>/dev/null
echo "=== proxy captured ==="
grep -o '"auth":"[^"]*"' /tmp/proxy7.log | head -3
grep -o '"url":"[^"]*"' /tmp/proxy7.log | head -3
grep -c chat/completions /tmp/proxy7.log
pkill -f "opencode serve --port 4795" 2>/dev/null
