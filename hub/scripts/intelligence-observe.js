#!/usr/bin/env node
'use strict';
// Observation-period snapshot for live shadow (7D). Prints today/month metrics.
// Usage: node scripts/intelligence-observe.js
const path = require('path');
const { openDatabase, migrate } = require('../src/db');
const { load, resolveDbPath } = require('../src/config');

const ROOT = path.join(__dirname, '..');
const cfg = load(process.env.HUB_CONFIG || path.join(ROOT, 'config', 'config.json'));
const db = openDatabase(resolveDbPath(cfg, ROOT));
migrate(db, path.join(ROOT, 'src', 'migrations'));
const now = new Date().toISOString();
const day = now.slice(0, 10);
const month = now.slice(0, 7);
const q = (sql, ...a) => db.prepare(sql).get(...a);

const todayA = q(`SELECT COUNT(*) c, AVG(latency_ms) avg_ms, SUM(estimated_cost) cost FROM intelligence_analyses WHERE status='COMPLETED' AND substr(created_at,1,10)=?`, day);
const todayF = q(`SELECT COUNT(*) c FROM intelligence_analyses WHERE status='FAILED' AND substr(created_at,1,10)=?`, day);
const monthA = q(`SELECT COUNT(*) c, SUM(estimated_cost) cost FROM intelligence_analyses WHERE status='COMPLETED' AND substr(created_at,1,7)=?`, month);
const schemaBad = q(`SELECT COUNT(*) c FROM intelligence_analyses WHERE status='FAILED' AND error LIKE 'schema invalid%'`);
const fb = db.prepare('SELECT verdict, COUNT(*) c FROM analysis_feedback GROUP BY verdict').all();
const jobs = db.prepare(`SELECT status, COUNT(*) c FROM intelligence_jobs GROUP BY status`).all();
const conf = q(`SELECT SUM(confidence>=0.8) high, SUM(confidence>=0.5 AND confidence<0.8) mid, SUM(confidence<0.5) low FROM intelligence_analyses WHERE status='COMPLETED'`);
const eps = q(`SELECT COUNT(*) c FROM message_episodes WHERE status='CLOSED' AND substr(created_at,1,10)=?`, day);

console.log(JSON.stringify({
  at: now,
  day,
  episodesClosedToday: eps.c || 0,
  today: {
    analyzed: todayA.c || 0,
    failed: todayF.c || 0,
    avgLatencyMs: todayA.avg_ms ? Math.round(todayA.avg_ms) : null,
    costUsd: todayA.cost ? Number(todayA.cost.toFixed(4)) : 0,
  },
  month: {
    analyzed: monthA.c || 0,
    costUsd: monthA.cost ? Number(monthA.cost.toFixed(4)) : 0,
  },
  schemaInvalidTotal: schemaBad.c || 0,
  jobsByState: Object.fromEntries(jobs.map((r) => [r.status, r.c])),
  confidence: { high: conf.high || 0, mid: conf.mid || 0, low: conf.low || 0 },
  feedback: Object.fromEntries(fb.map((r) => [r.verdict, r.c])),
}, null, 2));
db.close();
