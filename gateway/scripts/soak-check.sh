#!/usr/bin/env bash
# soak-check.sh <day> — verify expected markers vs spool, print day summary
set -u
DAY="${1:?usage: soak-check.sh <day-number>}"
G="$HOME/wechat-linux-research/gateway"
OUT="$HOME/wechat-linux-research/research/soak/day-$DAY.md"
METRICS_DAY=$(date -u +%F)

DAY="$DAY" node -e '
const fs = require("fs");
const path = require("path");
const day = parseInt(process.env.DAY, 10);
const dir = process.env.HOME + "/wechat-linux-research/gateway/data/spool";
const files = fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl"));
const all = [];
for (const f of files) {
  for (const l of fs.readFileSync(path.join(dir, f), "utf8").split("\n")) {
    if (l.trim()) all.push(JSON.parse(l));
  }
}
const expected = [
  `WGATE_D${day}_TEXT_001`, `WGATE_D${day}_TEXT_002`, `WGATE_D${day}_TEXT_003`,
  `WGATE_D${day}_AT_001`, `WGATE_D${day}_REPLY_001`,
];
// relaxed fallback: AT/REPLY markers may be sent without the WGATE_D{n}_ prefix
const now = Date.now();
const relaxed = (m, suffix) =>
  !m.text.includes(`WGATE_D${day}_${suffix}`) &&
  m.text.includes(suffix) &&
  now - new Date(m.collected_at).getTime() < 26 * 3600 * 1000;
const found = {};
for (const m of all) {
  for (const e of expected) if ((m.text || "").includes(e)) found[e] = found[e] || m;
  if (!found[`WGATE_D${day}_AT_001`] && relaxed(m, "AT_001")) found[`WGATE_D${day}_AT_001`] = m;
  if (!found[`WGATE_D${day}_REPLY_001`] && relaxed(m, "REPLY_001")) found[`WGATE_D${day}_REPLY_001`] = m;
}
const missing = expected.filter((e) => !found[e]);
const ok = expected.length - missing.length;
const atMsg = found[`WGATE_D${day}_AT_001`];
const replyMsg = found[`WGATE_D${day}_REPLY_001`];

const m = (() => {
  const f = process.env.HOME + "/wechat-linux-research/gateway/data/metrics/" + new Date().toISOString().slice(0, 10) + ".json";
  if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, "utf8"));
  return null;
})();

const lines = [];
lines.push(`# Soak Test Day ${day} 日报`);
lines.push(``);
lines.push(`- 生成时间：${new Date().toISOString()}`);
lines.push(``);
lines.push(`## 对账`);
lines.push(``);
lines.push(`| 项目 | 值 |`);
lines.push(`|---|---|`);
lines.push(`| expected markers | ${expected.length} |`);
lines.push(`| found | ${ok} |`);
lines.push(`| missing | ${missing.length}${missing.length ? "：" + missing.join(", ") : ""} |`);
lines.push(`| @ 判定 | ${atMsg ? "is_mentioned=" + atMsg.is_mentioned : "N/A"} |`);
lines.push(`| reply 字段 | ${replyMsg ? (replyMsg.reply ? "OK" : "MISSING") : "N/A"} |`);
lines.push(``);
lines.push(`## 当日指标（${m ? m.day : "N/A"}）`);
lines.push(``);
if (m) {
  lines.push(`- poll：${m.poll_count} 成功 / ${m.poll_failures} 失败`);
  lines.push(`- 消息：${m.messages_collected} 条，重复 ${m.duplicate_messages}`);
  lines.push(`- 掉线：${m.auth_loss_count} 次；agent 错误：${m.agent_error_count}`);
  lines.push(`- visibility_delay：${JSON.stringify(m.visibility_delay)}`);
  const s = m.samples || [];
  if (s.length) {
    const cpus = s.map((x) => x.wechat_cpu_pct).filter((x) => x !== null);
    const mems = s.map((x) => x.wechat_mem_mib).filter((x) => x !== null);
    const q = (a, p) => { const t = [...a].sort((x, y) => x - y); return t[Math.min(t.length - 1, Math.floor(t.length * p))]; };
    if (cpus.length) lines.push(`- 微信 CPU：avg=${(cpus.reduce((a, b) => a + b, 0) / cpus.length).toFixed(1)}% p95=${q(cpus, 0.95)?.toFixed(1)}% max=${Math.max(...cpus).toFixed(1)}%`);
    if (mems.length) lines.push(`- 微信内存：avg=${(mems.reduce((a, b) => a + b, 0) / mems.length).toFixed(0)}MiB max=${Math.max(...mems).toFixed(0)}MiB`);
  }
  lines.push(`- spool 大小：${JSON.stringify(m.spool_daily_bytes)}`);
}
lines.push(``);
lines.push(`## 状态`);
lines.push(``);
const h = JSON.parse(fs.readFileSync(process.env.HOME + "/wechat-linux-research/gateway/data/state/health.json", "utf8"));
lines.push(`- gateway：${h.gateway}；agent：${h.agent_wechat}；微信：${h.wechat_auth}`);
lines.push(`- poll_failures_consecutive：${h.poll_failures_consecutive}`);
lines.push(`- uptime：${(h.uptime_seconds / 3600).toFixed(1)}h`);
const out = lines.join("\n");
const outFile = process.env.HOME + "/wechat-linux-research/research/soak/day-" + day + ".md";
fs.writeFileSync(outFile, out);
console.log(out);
console.log("\n== written to " + outFile);
'
