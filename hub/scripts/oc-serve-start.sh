#!/usr/bin/env bash
set -e
export PATH="$HOME/.opencode/bin:$PATH"
export OPENCODE_DISABLE_AUTOUPDATE=1
export DEEPSEEK_API_KEY=$(cut -d= -f2 ~/.opencode/.env)
mkdir -p ~/.config/opencode
cat > ~/.config/opencode/opencode.json <<'EOF'
{
  "$schema": "https://opencode.ai/config.json",
  "permission": {
    "edit": "ask",
    "bash": "ask",
    "webfetch": "ask"
  }
}
EOF
# stop any previous serve
pkill -f "opencode serve" 2>/dev/null || true
sleep 1
nohup opencode serve --port 4096 --hostname 127.0.0.1 > /tmp/oc-serve.log 2>&1 &
echo $! > /tmp/oc-serve.pid
for i in $(seq 1 20); do
  sleep 1
  if curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4096/doc | grep -q 200; then
    echo "serve up after ${i}s"
    break
  fi
done
echo "--- /doc status ---"
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:4096/doc
echo "--- serve log tail ---"
tail -n 5 /tmp/oc-serve.log
echo "--- openapi paths (subset) ---"
curl -s http://127.0.0.1:4096/doc | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);console.log(Object.keys(j.paths||{}).join("\n"))})' | head -40
