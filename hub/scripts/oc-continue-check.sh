#!/usr/bin/env bash
SID=ses_fb70a95abffeJ3gFJAy1WVKzsc
curl -s -X POST "http://127.0.0.1:4096/api/session/$SID/prompt" -H "Content-Type: application/json" -d '{"prompt":{"text":"用一句话确认你还记得之前的任务"}}' | head -c 200
echo
sleep 40
curl -s "http://127.0.0.1:4096/api/session/$SID/message" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);const ms=(j.data&&j.data.data)||[];const m=ms[0];if(m){console.log("LATEST:",m.type,"|",(m.text||"").slice(0,200)||JSON.stringify((m.content||[]).map(c=>c.type+"="+(c.text||"").slice(0,80))))}})'
