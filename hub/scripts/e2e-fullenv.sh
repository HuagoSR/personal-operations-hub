#!/usr/bin/env bash
set -e
H=/home/huagosr/worker-sandbox-untrusted/home2
WS=/home/huagosr/worker-sandbox-untrusted/calc
K=$(cut -d= -f2 ~/.opencode/.env)
sed -i 's|http://127.0.0.1:8000/v1|https://api.deepseek.com/v1|' $H/.opencode/opencode.json

nohup bwrap --unshare-user --unshare-ipc --unshare-pid --unshare-uts --unshare-cgroup \
  --ro-bind /usr /usr --ro-bind /bin /bin --ro-bind /lib /lib --ro-bind /lib64 /lib64 --ro-bind /etc /etc \
  --proc /proc --dev /dev --tmpfs /tmp \
  --bind "$H" "$H" --setenv HOME "$H" \
  --ro-bind "$HOME/.opencode/bin" /opt/opencode-bin \
  --bind "$WS" "$WS" --chdir "$WS" \
  --setenv DEEPSEEK_API_KEY "$K" --setenv OPENCODE_DISABLE_AUTOUPDATE 1 \
  --die-with-parent -- /opt/opencode-bin/opencode serve --port 4794 --hostname 127.0.0.1 > /tmp/oc7.log 2>&1 < /dev/null &
disown
for i in $(seq 1 30); do
  sleep 1
  curl -s -o /dev/null -w "%{http_code}" -m 5 http://127.0.0.1:4794/doc | grep -q 200 && break
done
echo "serve up"
node -e '
(async () => {
  const r1 = await fetch("http://127.0.0.1:4794/api/session", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ location: { directory: "/home/huagosr/worker-sandbox-untrusted/calc" }, model: { id: "ds", providerID: "hub" } }),
  });
  const sid = (await r1.json()).data.id;
  console.log("sid:", sid);
  fetch("http://127.0.0.1:4794/global/event", { headers: { accept: "text/event-stream" } }).then(async (res) => {
    const reader = res.body.getReader(); const dec = new TextDecoder();
    while (true) { const { done, value } = await reader.read(); if (done) break; dec.decode(value, { stream: true }); }
  }).catch(() => {});
  await new Promise((r) => setTimeout(r, 2000));
  await fetch(`http://127.0.0.1:4794/api/session/${sid}/prompt`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: { text: "Reply with exactly: PONG" } }),
  });
  console.log("prompt sent, waiting 60s");
  await new Promise((r) => setTimeout(r, 60000));
  const m = await fetch(`http://127.0.0.1:4794/api/session/${sid}/message`);
  const j = await m.json();
  const ms = (j.data && j.data.data) || [];
  for (const x of ms) {
    if (x.text) console.log("MSG:", x.text.slice(0, 120));
    for (const c of (x.content || [])) if (c.type === "text") console.log("TEXT:", c.text.slice(0, 120));
  }
  process.exit(0);
})();
'
pkill -f "opencode serve --port 4794" 2>/dev/null
