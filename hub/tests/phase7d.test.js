'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { makeDb, makeCtx, spoolRecord, makeFixtureSpool } = require('./helpers');
const { ingestOnce, ingestRecord } = require('../src/services/ingest');
const { tx } = require('../src/services/tx');
const { onInboxMessageIngested, sweepEpisodesOnce, enqueueEpisodeForAnalysis, runJob, processIntelligenceOnce } = require('../src/intelligence/service');
const { episodeForMessage } = require('../src/intelligence/episode-builder');
const { findJobByEpisode } = require('../src/domain/intelligence-job');
const { closeEpisode } = require('../src/domain/intelligence-episode');
const { createServiceFacade } = require('../src/services/facade');
const { createServer } = require('../src/api/server');
const { createStubClient } = require('../src/intelligence/client');

const liveCfg = (extra) => Object.assign({
  episodeIdleMs: 600000,
  episodeMaxMessages: 3,
  intelligenceDenyEgressChats: [],
  intelligenceEnabled: true,
  intelligenceModel: 'm',
  outboxMaxAttempts: 3,
  intelligenceBudgetDailyUsd: 0.5,
  intelligenceBudgetMonthlyUsd: 5,
}, extra);

function seedRawNow(db, { chatId, text, atIso }) {
  return Number(db.prepare(`INSERT INTO raw_messages (idempotency_key, source, chat_id, chat_type, sender_id, sender_name, message_type, text, is_mentioned, collected_at, raw_json)
    VALUES (?, 'wechat', ?, 'group', 's1', 'n1', '1', ?, 1, ?, '{}')`)
    .run(`k:${chatId}:${Date.now()}:${Math.random()}`, chatId, text || 't', atIso).lastInsertRowid);
}

function spyHook(db, calls) {
  return (db2, m) => { calls.push(m); onInboxMessageIngested(db2, liveCfg(), m); };
}

test('7D: ingest hook appends inbox messages to episodes and sweep enqueues trailing episode', () => {
  const { db, dir } = makeDb();
  const calls = [];
  const t1 = new Date(Date.now() - 120000).toISOString();
  const t2 = new Date(Date.now() - 60000).toISOString();
  const r1 = spoolRecord({ text: 'live 1', is_mentioned: true, sequence: 1, local_id: 9101, chat_id: 'live@chatroom', collected_at: t1 });
  const r2 = spoolRecord({ text: 'live 2', is_mentioned: true, sequence: 2, local_id: 9102, chat_id: 'live@chatroom', collected_at: t2 });
  makeFixtureSpool(dir, [r1, r2]);
  tx(db, () => {
    const out = ingestRecord(db, r1, { inboxRule: 'mentioned_or_direct', intelHook: spyHook(db, calls) });
    assert.ok(out.inboxId, 'inbox created');
    assert.equal(calls.length, 1);
  });
  tx(db, () => {
    ingestRecord(db, r2, { inboxRule: 'mentioned_or_direct', intelHook: spyHook(db, calls) });
  });
  assert.equal(calls.length, 2);
  const eps = db.prepare('SELECT * FROM message_episodes').all();
  assert.equal(eps.length, 1, 'same chat within window = one open episode');
  assert.equal(eps[0].message_count, 2);
  assert.equal(findJobByEpisode(db, eps[0].id), null, 'open episode not enqueued yet');
  const r = sweepEpisodesOnce(db, liveCfg());
  assert.equal(r.enqueued, 0, 'not idle yet (messages 1-2 min old)');
  const past = new Date(Date.now() - 700000).toISOString();
  db.prepare('UPDATE message_episodes SET window_end = ? WHERE id = ?').run(past, eps[0].id);
  const r2s = sweepEpisodesOnce(db, liveCfg());
  assert.equal(r2s.enqueued, 1);
  assert.ok(findJobByEpisode(db, eps[0].id), 'job enqueued after idle sweep');
  const r3 = sweepEpisodesOnce(db, liveCfg());
  assert.equal(r3.enqueued, 0, 'sweep idempotent');
});

test('7D: idle split during ingest enqueues closed previous episode', () => {
  const { db } = makeDb();
  const calls = [];
  const raw1 = seedRawNow(db, { chatId: 'split@chat', atIso: new Date(Date.now() - 3600000).toISOString() });
  const raw2 = seedRawNow(db, { chatId: 'split@chat', atIso: new Date().toISOString() });
  tx(db, () => {
    onInboxMessageIngested(db, liveCfg(), { rawMessageId: raw1, chatId: 'split@chat', chatType: 'group', collectedAt: new Date(Date.now() - 3600000).toISOString() });
    const ep = db.prepare('SELECT * FROM message_episodes').all();
    assert.equal(ep.length, 1);
    assert.equal(findJobByEpisode(db, ep[0].id), null);
    calls.push('first');
  });
  tx(db, () => {
    onInboxMessageIngested(db, liveCfg(), { rawMessageId: raw2, chatId: 'split@chat', chatType: 'group', collectedAt: new Date().toISOString() });
    const eps = db.prepare('SELECT * FROM message_episodes ORDER BY id').all();
    assert.equal(eps.length, 2, 'idle gap split');
    assert.equal(eps[0].status, 'CLOSED');
    assert.ok(findJobByEpisode(db, eps[0].id), 'closed first episode enqueued');
  });
  assert.equal(calls.length, 1);
});

test('7D: denied chat never enters episodes', () => {
  const { db } = makeDb();
  const cfg = liveCfg({ intelligenceDenyEgressChats: ['secret@chat'] });
  const calls = [];
  tx(db, () => {
    onInboxMessageIngested(db, cfg, { rawMessageId: 1, chatId: 'secret@chat', chatType: 'group', collectedAt: '2026-09-04T02:00:00.000Z' });
  });
  assert.equal(db.prepare('SELECT COUNT(*) c FROM message_episodes').get().c, 0);
  void calls;
});

test('7D: full live loop ingest->sweep->process produces analysis (stub)', async () => {
  const { db } = makeDb();
  const ctx = makeCtx({ cfg: liveCfg({ intelligenceProvider: 'stub' }) });
  const calls = [];
  const raw = db.prepare(`INSERT INTO raw_messages (idempotency_key, source, chat_id, chat_type, sender_id, text, is_mentioned, collected_at, raw_json)
    VALUES ('k-live', 'wechat', 'live@c', 'group', 's1', '实时消息', 1, '2026-09-04T03:00:00.000Z', '{}')`).run();
  const rawId = Number(raw.lastInsertRowid);
  tx(db, () => {
    onInboxMessageIngested(db, liveCfg(), { rawMessageId: rawId, chatId: 'live@c', chatType: 'group', collectedAt: '2026-09-04T03:00:00.000Z' });
  });
  const past = new Date(Date.now() - 700000).toISOString();
  db.prepare('UPDATE message_episodes SET window_end = ?').run(past);
  sweepEpisodesOnce(db, liveCfg());
  ctx.clock = { iso: () => new Date().toISOString(), ms: () => Date.now() };
  const job = db.prepare("SELECT * FROM intelligence_jobs WHERE status='PENDING'").get();
  assert.ok(job);
  const client = createStubClient(() => JSON.stringify({
    summary: '实时测试', importance: 'MEDIUM', urgency: 'LOW', requires_action: false,
    intent: 'QUESTION', deadline: { text: null, resolved: null },
    suggested_project: { project_id: null, confidence: null },
    suggested_task: { title: null, description: null, confidence: null },
    reason_codes: [], evidence_refs: [], risk_flags: [], confidence: 0.7,
  }));
  const analysis = await runJob(db, ctx, job, client);
  assert.ok(analysis);
  assert.equal(analysis.status, 'COMPLETED');
  assert.equal(JSON.parse(analysis.output_json).summary, '实时测试');
  assert.equal(calls.length, 0);
});

test('7D: processIntelligenceOnce claims pending job and completes via stub', async () => {
  const { db } = makeDb();
  const rawId = seedRawNow(db, { chatId: 'proc@c', text: 'x', atIso: new Date(Date.now() - 600000).toISOString() });
  tx(db, () => {
    onInboxMessageIngested(db, liveCfg(), { rawMessageId: rawId, chatId: 'proc@c', chatType: 'group', collectedAt: new Date(Date.now() - 600000).toISOString() });
  });
  db.prepare('UPDATE message_episodes SET window_end = ?').run(new Date(Date.now() - 700000).toISOString());
  sweepEpisodesOnce(db, liveCfg());
  const ctx = makeCtx({ cfg: liveCfg({ intelligenceProvider: 'stub' }) });
  ctx.clock = { iso: () => new Date().toISOString(), ms: () => Date.now() };
  const r = await processIntelligenceOnce(db, ctx);
  assert.equal(r.processed, 1);
  const job = db.prepare('SELECT * FROM intelligence_jobs').get();
  assert.equal(job.status, 'COMPLETED');
});

test('7D: intelligence status endpoint', async () => {
  const { db } = makeDb();
  const ctx = makeCtx({ cfg: liveCfg() });
  const S = createServiceFacade(db, ctx);
  const st = S.intelligenceStatus();
  assert.equal(st.enabled, true);
  assert.ok('budget' in st);
  assert.equal(typeof st.today.analyzed, 'number');
  assert.ok('confidence' in st);
  const server = createServer(db, ctx, ctx.cfg);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const r = await fetch(`http://127.0.0.1:${server.address().port}/api/intelligence/status`).then((x) => x.json());
    assert.equal(typeof r.today.analyzed, 'number');
  } finally {
    server.close();
  }
});
