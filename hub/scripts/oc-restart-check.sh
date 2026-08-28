#!/usr/bin/env bash
curl -s "http://127.0.0.1:4096/api/session?limit=3" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);(j.data||[]).forEach(s=>console.log("survived:",s.id,s.title||""))})'
SID=$(curl -s "http://127.0.0.1:4096/api/session?limit=3" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);console.log(j.data && j.data[0] ? j.data[0].id : "")})')
echo "continue: $SID"
curl -s "http://127.0.0.1:4096/api/session/$SID/message" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);const ms=(j.data&&j.data.data)||[];const last=ms[0];if(last)console.log("last msg:",JSON.stringify(last).slice(0,500))})'
