#!/usr/bin/env bash
# report.sh — print today's metrics summary
set -u
GATEWAY_DIR="$HOME/wechat-linux-research/gateway"
DAY=$(date -u +%F)
M="$GATEWAY_DIR/data/metrics/$DAY.json"

if [ -f "$M" ]; then
  node -e '
    const m = require(process.env.HOME + "/wechat-linux-research/gateway/data/metrics/" + new Date().toISOString().slice(0, 10) + ".json");
    console.log("day:", m.day);
    console.log("poll_count:", m.poll_count);
    console.log("poll_failures:", m.poll_failures);
    console.log("messages_collected:", m.messages_collected);
    console.log("duplicate_messages:", m.duplicate_messages);
    console.log("auth_loss_count:", m.auth_loss_count);
    console.log("agent_error_count:", m.agent_error_count);
    console.log("visibility_delay:", JSON.stringify(m.visibility_delay));
    console.log("spool_daily_bytes:", JSON.stringify(m.spool_daily_bytes));
    const s = m.samples || [];
    if (s.length > 0) {
      const cpus = s.map((x) => x.wechat_cpu_pct).filter((x) => x !== null && x !== undefined);
      const mems = s.map((x) => x.wechat_mem_mib).filter((x) => x !== null && x !== undefined);
      const q = (a, p) => { const t = [...a].sort((x, y) => x - y); return t[Math.min(t.length - 1, Math.floor(t.length * p))]; };
      console.log("samples:", s.length);
      if (cpus.length) console.log("wechat_cpu avg/p50/p95/max:", (cpus.reduce((a, b) => a + b, 0) / cpus.length).toFixed(1), q(cpus, 0.5)?.toFixed(1), q(cpus, 0.95)?.toFixed(1), Math.max(...cpus).toFixed(1));
      if (mems.length) console.log("wechat_mem avg/max MiB:", (mems.reduce((a, b) => a + b, 0) / mems.length).toFixed(0), Math.max(...mems).toFixed(0));
    }
  '
else
  echo "no metrics file for $DAY yet"
fi
