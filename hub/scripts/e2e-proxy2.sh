#!/usr/bin/env bash
set -e
export PATH="$HOME/.opencode/bin:$PATH"
H=/home/huagosr/wechat-linux-research/hub/data/workers/opencode/ex-19/home
WS=/home/huagosr/worker-sandbox-untrusted/calc
K=$(cut -d= -f2 ~/.opencode/.env)

node ~/tmp-proxy.js > /tmp/proxy2.log 2>&1 &
PROXY=$!
sleep 1

sed -i 's|https://api.deepseek.com/v1|http://127.0.0.1:8000/v1|' $H/.opencode/opencode.json
grep baseURL $H/.opencode/opencode.json

nohup bwrap --unshare-user --unshare-ipc --unshare-pid --unshare-uts --unshare-cgroup \
  --ro-bind /usr /usr --ro-bind /bin /bin --ro-bind /lib /lib --ro-bind /lib64 /lib64 --ro-bind /etc /etc \
  --proc /proc --dev /dev --tmpfs /tmp \
  --bind "$H" "$H" --setenv HOME "$H" \
  --ro-bind "$HOME/.opencode/bin" /opt/opencode-bin \
  --ro-bind "$HOME/.opencode/node_modules" "$H/.opencode/node_modules" \
  --bind "$WS" "$WS" --chdir "$WS" \
  --clearenv --setenv PATH "/usr/bin:/bin:/usr/sbin:/sbin" --setenv LANG "C.UTF-8" \
  --setenv DEEPSEEK_API_KEY "$K" --setenv OPENCODE_DISABLE_AUTOUPDATE 1 \
  --die-with-parent -- /opt/opencode-bin/opencode serve --port 4789 --hostname 127.0.0.1 > /tmp/oc-proxy-serve.log 2>&1 < /dev/null &
disown
for i in $(seq 1 30); do
  sleep 1
  curl -s -o /dev/null -w "%{http_code}" -m 5 http://127.0.0.1:4789/doc | grep -q 200 && break
done
echo "serve up"
node -e '
(async () => {
  const r1 = await fetch("http://127.0.0.1:4789/api/session", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ location: { directory: "/home/huagosr/worker-sandbox-untrusted/calc" }, model: { id: "deepseek-v4-pro", providerID: "deepseek" } }),
  });
  const sid = (await r1.json()).data.id;
  console.log("sid:", sid);
  await fetch(`http://127.0.0.1:4789/api/session/${sid}/prompt`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: { text: "PONG" } }),
  });
  console.log("prompt sent");
  await new Promise((r) => setTimeout(r, 30000));
  console.log("done waiting");
})();
'
sleep 2
kill $PROXY 2>/dev/null
echo "=== proxy captured ==="
grep -o '"auth":"[^"]*"' /tmp/proxy2.log | head -3
grep -c chat/completions /tmp/proxy2.log
pkill -f "opencode serve --port 4789" 2>/dev/null
sed -i 's|http://127.0.0.1:8000/v1|https://api.deepseek.com/v1|' $H/.opencode/opencode.json
