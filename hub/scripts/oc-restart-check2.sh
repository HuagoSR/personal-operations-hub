#!/usr/bin/env bash
SID=$(curl -s "http://127.0.0.1:4096/api/session?limit=3" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);console.log(j.data && j.data[0] ? j.data[0].id : "")})')
curl -s "http://127.0.0.1:4096/api/session/$SID/message" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);const ms=(j.data&&j.data.data)||[];console.log("msg count:",ms.length);for(const m of ms.slice(0,3)){console.log("-",m.type,m.text?m.text.slice(0,120):JSON.stringify((m.content||[]).map(c=>c.type)))}})'
