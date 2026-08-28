#!/usr/bin/env bash
node -e '
(async () => {
  const r1 = await fetch("http://127.0.0.1:4096/api/session", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ location: { directory: "/home/huagosr/worker-sandbox-untrusted/calc" }, model: { id: "deepseek-chat", providerID: "deepseek" } }),
  });
  const sid = (await r1.json()).data.id;
  console.log("sid:", sid);
  await new Promise((r) => setTimeout(r, 1000));
  await fetch(`http://127.0.0.1:4096/api/session/${sid}/prompt`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt: { text: "Reply with exactly: PONG" } }),
  });
  console.log("prompt sent, waiting 90s");
  await new Promise((r) => setTimeout(r, 90000));
  const m = await fetch(`http://127.0.0.1:4096/api/session/${sid}/message`);
  const j = await m.json();
  const ms = (j.data && j.data.data) || [];
  for (const x of ms) {
    if (x.text) console.log("MSG:", x.text.slice(0, 120));
    for (const c of (x.content || [])) {
      if (c.type === "text") console.log("TEXT:", c.text.slice(0, 120));
      if (c.type === "tool") console.log("TOOL:", c.name, c.state && c.state.status);
    }
  }
  process.exit(0);
})();
'
