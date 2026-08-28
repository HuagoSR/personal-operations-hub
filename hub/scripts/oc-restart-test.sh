#!/usr/bin/env bash
set -e
export PATH="$HOME/.opencode/bin:$PATH"
export OPENCODE_DISABLE_AUTOUPDATE=1
export DEEPSEEK_API_KEY=$(cut -d= -f2 ~/.opencode/.env)
SID=$(curl -s "http://127.0.0.1:4096/api/session?limit=3" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);console.log(j.data && j.data[0] ? j.data[0].id : "")})')
echo "session before restart: $SID"
pkill -f "opencode serve" 2>/dev/null || true
sleep 3
nohup opencode serve --port 4096 --hostname 127.0.0.1 > /tmp/oc-serve.log 2>&1 < /dev/null &
disown
for i in $(seq 1 25); do
  sleep 1
  if curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4096/doc | grep -q 200; then break; fi
done
echo "serve restarted"
curl -s "http://127.0.0.1:4096/api/session?limit=3" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);(j.data||[]).forEach(s=>console.log("survived:",s.id,s.title||""))})'
echo "continue old session:"
curl -s -X POST "http://127.0.0.1:4096/api/session/$SID/prompt" -H "Content-Type: application/json" -d '{"prompt":{"text":"一句话确认你还记得之前的任务"}}' | head -c 300
echo
sleep 25
curl -s "http://127.0.0.1:4096/api/session/$SID/message" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);const ms=(j.data&&j.data.data)||[];const last=ms[0];if(last)console.log("last msg:",JSON.stringify(last).slice(0,400))})'
