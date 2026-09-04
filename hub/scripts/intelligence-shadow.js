#!/usr/bin/env node
'use strict';
// Offline shadow analysis (7B): analyze historical inbox-scoped messages only.
// No inbox/task state changes; results are append-only intelligence_analyses.
// Usage (on VPS): HUB_INTELLIGENCE_API_KEY=$(cut -d= -f2 ~/.hub-intelligence.env) node scripts/intelligence-shadow.js [--dry-run] [--limit N]
const path = require('path');
const { openDatabase, migrate } = require('../src/db');
const { load, resolveDbPath } = require('../src/config');
const { Logger } = require('../src/logger');
const { episodeForMessage } = require('../src/intelligence/episode-builder');
const { closeEpisode } = require('../src/domain/intelligence-episode');
const { enqueueEpisodeForAnalysis, runJob, budgetState } = require('../src/intelligence/service');

const ROOT = path.join(__dirname, '..');
const dryRun = process.argv.includes('--dry-run');
const limitArg = process.argv.indexOf('--limit');
const limit = limitArg > -1 ? Number(process.argv[limitArg + 1]) : 0;

const cfg = load(process.env.HUB_CONFIG || path.join(ROOT, 'config', 'config.json'));
const logger = new Logger({ level: cfg.logLevel || 'INFO' });
const db = openDatabase(resolveDbPath(cfg, ROOT));
migrate(db, path.join(ROOT, 'src', 'migrations'));

const ctx = {
  cfg,
  logger,
  clock: { iso: () => new Date().toISOString(), ms: () => Date.now() },
};

async function main() {
  const deny = cfg.intelligenceDenyEgressChats || [];
  const rows = db.prepare(`SELECT DISTINCT rm.* FROM inbox_items i
    JOIN events e ON e.id = i.event_id
    JOIN event_raw_messages erm ON erm.event_id = e.id
    JOIN raw_messages rm ON rm.id = erm.raw_message_id
    WHERE i.state IN ('NEW','READ','IGNORED')
      AND rm.message_type = '1'
      AND rm.text != ''
    ORDER BY rm.id`).all();
  let messages = rows;
  if (limit > 0) messages = messages.slice(-limit);
  const scope = messages.filter((m) => !deny.includes(m.chat_id));
  const denied = messages.length - scope.length;
  const budget = budgetState(db, ctx);
  console.log(`shadow: inbox messages=${messages.length} denied-chat=${denied} budget={month:$${budget.month.toFixed(3)}, day:$${budget.today.toFixed(3)}} dryRun=${dryRun}`);

  const episodesByChat = new Map();
  const ordered = [];
  if (dryRun) {
    // pure in-memory simulation: same chat + idle/max rules, no db writes
    const groups = new Map();
    for (const m of scope) {
      if (!groups.has(m.chat_id)) groups.set(m.chat_id, []);
      groups.get(m.chat_id).push(m);
    }
    let estEpisodes = 0;
    for (const [chatId, msgs] of groups) {
      msgs.sort((a, b) => a.collected_at.localeCompare(b.collected_at));
      let eps = 1;
      for (let i = 1; i < msgs.length; i++) {
        const idle = Date.parse(msgs[i].collected_at) - Date.parse(msgs[i - 1].collected_at);
        if (idle > cfg.episodeIdleMs) eps++;
      }
      estEpisodes += eps;
      console.log(`  would-analyze chat=${String(chatId).slice(0, 12)}… msgs=${msgs.length} ~episodes=${eps}`);
    }
    console.log(`dry-run complete: ${scope.length} messages, ~${estEpisodes} episodes would be enqueued`);
    return;
  }
  for (const m of scope) {
    const ep = episodeForMessage(db, {
      chatId: m.chat_id, chatType: m.chat_type, rawMessageId: m.id,
      atIso: m.collected_at, idleMs: cfg.episodeIdleMs, maxMessages: cfg.episodeMaxMessages,
    });
    if (!episodesByChat.has(ep.id)) { episodesByChat.set(ep.id, ep); ordered.push(ep); }
  }
  let enqueued = 0;
  for (const ep of ordered) {
    const row = db.prepare('SELECT * FROM message_episodes WHERE id = ?').get(ep.id);
    if (row.status === 'OPEN') closeEpisode(db, ep.id, ctx.clock.iso());
    enqueueEpisodeForAnalysis(db, { episodeId: ep.id, maxAttempts: 2 });
    enqueued++;
  }
  console.log(`enqueued ${enqueued} episodes`);
  if (!cfg.intelligenceApiKey) {
    console.error('HUB_INTELLIGENCE_API_KEY not configured; run with env var or install ~/.hub-intelligence.env');
    return;
  }
  let completed = 0; let failed = 0; let skipped = 0; let totalCost = 0; let totalMs = 0;
  const jobs = db.prepare("SELECT * FROM intelligence_jobs WHERE status IN ('PENDING','RETRYABLE') ORDER BY id").all();
  for (const job of jobs) {
    const b = budgetState(db, ctx);
    if (b.blocked) { console.error(`budget blocked (month $${b.month.toFixed(3)} / $${b.monthLimit}, day $${b.today.toFixed(3)} / $${b.dayLimit})`); break; }
    const analysis = await runJob(db, ctx, job);
    const j = db.prepare('SELECT * FROM intelligence_jobs WHERE id = ?').get(job.id);
    if (j.status === 'COMPLETED') {
      if (analysis && analysis.status === 'COMPLETED') {
        completed++;
        totalCost += analysis.estimated_cost || 0;
        totalMs += analysis.latency_ms || 0;
        const out = JSON.parse(analysis.output_json);
        const chatLabel = db.prepare('SELECT chat_id FROM message_episodes WHERE id = ?').get(analysis.episode_id);
        console.log(`  #${analysis.id} [${String(chatLabel.chat_id).slice(0, 10)}…] ${out.importance}/${out.urgency} action=${out.requires_action} conf=${out.confidence} $${analysis.estimated_cost || 0} ${analysis.latency_ms}ms :: ${String(out.summary).slice(0, 60)}`);
      } else {
        skipped++;
      }
    } else { failed++; }
  }
  const fin = budgetState(db, ctx);
  console.log(`shadow done: completed=${completed} skipped(dup)=${skipped} failed=${failed} costToday=$${fin.today.toFixed(4)} totalMs=${totalMs}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
