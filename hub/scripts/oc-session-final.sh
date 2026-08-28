#!/usr/bin/env bash
SID=$(curl -s "http://127.0.0.1:4096/api/session?limit=3" | node -e 'let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const j=JSON.parse(d);console.log(j.data && j.data[0] ? j.data[0].id : "")})')
echo "sid=$SID"
curl -s "http://127.0.0.1:4096/api/session/$SID/message" | node -e '
let d="";
process.stdin.on("data",c=>d+=c).on("end",()=>{
  const j = JSON.parse(d);
  for (const m of (j.data||[]).reverse()) {
    console.log("---", m.type, m.model ? m.model.id : "", "---");
    if (m.text) console.log(m.text.slice(0, 400));
    for (const c of (m.content||[])) {
      if (c.type === "tool") {
        console.log("TOOL", c.name, "status:", c.state.status, "output:", JSON.stringify(c.state.output||c.state.content||"").slice(0, 300));
      } else if (c.type === "text") {
        console.log("TEXT:", c.text.slice(0, 400));
      }
    }
  }
});
'
