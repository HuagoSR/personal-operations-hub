'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { makeDb, makeCtx } = require('./helpers');
const { insertRawMessage } = require('../src/domain/raw-message');
const { insertEvent, linkRawMessage } = require('../src/domain/event');
const { insertInboxItem } = require('../src/domain/inbox-item');
const { createServiceFacade } = require('../src/services/facade');
const { createServer } = require('../src/api/server');
const { episodeForMessage } = require('../src/intelligence/episode-builder');
const { closeEpisode } = require('../src/domain/intelligence-episode');
const { enqueueEpisodeForAnalysis, runJob } = require('../src/intelligence/service');
const { createStubClient } = require('../src/intelligence/client');

function seedInboxMessage(db, { chatId, text, mentioned }) {
  const rawId = insertRawMessage(db, {
    idempotencyKey: `k:${chatId}:${Date.now()}:${Math.random()}`,
    source: 'wechat', chatId, chatType: 'group', chatName: '测试群', senderId: 's1',
    senderName: '某同学', messageType: '1', text, isMentioned: mentioned === true,
    collectedAt: '2026-09-04T00:00:00.000Z', raw: { text },
  });
  const evId = insertEvent(db, {
    eventType: 'wechat_message', priorityHint: mentioned ? 'mentioned' : 'normal',
    source: 'wechat', metadata: { chatId }, actorType: 'HUB', actorId: 'hub-v01',
  });
  linkRawMessage(db, evId, rawId);
  const inboxId = insertInboxItem(db, { eventId: evId });
  return { rawId, evId, inboxId };
}

function analysisResponse() {
  return JSON.stringify({
    summary: '同学询问项目进展', importance: 'HIGH', urgency: 'HIGH', requires_action: true,
    intent: 'REQUEST', deadline: { text: null, resolved: null },
    suggested_project: { project_id: null, confidence: null },
    suggested_task: { title: '跟进项目进展', description: 'd', confidence: 0.9 },
    reason_codes: ['EXPLICIT_REQUEST', 'MENTIONED_USER'], evidence_refs: [], risk_flags: [],
    confidence: 0.88,
  });
}

test('7C: inboxIntelligence attaches latest analysis with feedback', async () => {
  const { db } = makeDb();
  const ctx = makeCtx({ cfg: { intelligenceDenyEgressChats: [], intelligenceModel: 'm', outboxMaxAttempts: 3, intelligenceBudgetDailyUsd: 0.5, intelligenceBudgetMonthlyUsd: 5 } });
  ctx.clock = { iso: () => '2026-09-04T00:01:00.000Z', ms: () => Date.parse('2026-09-04T00:01:00.000Z') };
  const { inboxId, rawId } = seedInboxMessage(db, { chatId: 'c100', text: '项目进展如何', mentioned: true });
  const ep = episodeForMessage(db, { chatId: 'c100', chatType: 'group', rawMessageId: rawId, atIso: '2026-09-04T00:00:00.000Z', idleMs: 600000, maxMessages: 30 });
  closeEpisode(db, ep.id, '2026-09-04T00:00:05.000Z');
  const job = enqueueEpisodeForAnalysis(db, { episodeId: ep.id });
  const client = createStubClient(() => analysisResponse());
  const analysis = await runJob(db, ctx, job, client);
  assert.ok(analysis, 'analysis created');

  const S = createServiceFacade(db, ctx);
  const items = S.inboxIntelligence();
  const mine = items.find((i) => i.id === inboxId);
  assert.ok(mine, 'inbox item present');
  assert.equal(mine.analyses.length, 1);
  const a = mine.analyses[0];
  assert.equal(a.analysis_id, analysis.id);
  assert.equal(a.output.summary, '同学询问项目进展');
  assert.equal(a.output.requires_action, true);
  assert.equal(a.output.suggested_task.title, '跟进项目进展');
  assert.equal(a.feedback.length, 0);

  const fb = S.postAnalysisFeedback({ analysisId: analysis.id, verdict: 'accepted' });
  assert.equal(fb.verdict, 'accepted');
  const fb2 = S.postAnalysisFeedback({ analysisId: analysis.id, verdict: 'partial', correctedImportance: 'MEDIUM', correctedUrgency: 'LOW' });
  assert.equal(fb2.verdict, 'partial');
  const detail = S.analysisDetail(analysis.id);
  assert.equal(detail.raw.status, 'COMPLETED');
  assert.equal(detail.analysis.feedback.length, 2);

  assert.throws(() => S.postAnalysisFeedback({ analysisId: analysis.id, verdict: 'maybe' }), /verdict/);
  assert.throws(() => S.postAnalysisFeedback({ analysisId: analysis.id, verdict: 'partial', correctedImportance: 'URGENT' }), /correctedImportance/);
  assert.throws(() => S.analysisDetail(99999), /not found/i);
});

test('7C: inbox item without analysis returns empty analyses', () => {
  const { db } = makeDb();
  const ctx = makeCtx();
  const { inboxId } = seedInboxMessage(db, { chatId: 'c101', text: 'hello' });
  const S = createServiceFacade(db, ctx);
  const items = S.inboxIntelligence();
  const mine = items.find((i) => i.id === inboxId);
  assert.ok(mine);
  assert.deepEqual(mine.analyses, []);
});

function startApp(db, ctx) {
  const server = createServer(db, ctx, ctx.cfg);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` }));
  });
}

test('7C: API routes inbox/intelligence and analyses feedback', async () => {
  const { db } = makeDb();
  const ctx = makeCtx();
  const { inboxId } = seedInboxMessage(db, { chatId: 'c102', text: 'x' });
  const app = await startApp(db, ctx);
  try {
    let r = await fetch(app.base + '/api/inbox/intelligence').then((x) => x.json());
    assert.ok(Array.isArray(r));
    assert.ok(r.some((i) => i.id === inboxId));
    r = await fetch(app.base + '/api/analyses/1/feedback', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ verdict: 'accepted' }),
    });
    assert.equal(r.status, 404, 'no analysis yet -> not found');
  } finally {
    app.server.close();
  }
});

test('7C: markInboxRead batch marks only NEW items as READ', async () => {
  const { db } = makeDb();
  const ctx = makeCtx();
  const a = seedInboxMessage(db, { chatId: 'c103', text: 'a' });
  const b = seedInboxMessage(db, { chatId: 'c104', text: 'b' });
  const S = createServiceFacade(db, ctx);
  const r = S.markInboxRead([a.inboxId, b.inboxId, 99999]);
  assert.equal(r.changed, 2);
  assert.equal(db.prepare('SELECT state FROM inbox_items WHERE id = ?').get(a.inboxId).state, 'READ');
  assert.equal(db.prepare('SELECT state FROM inbox_items WHERE id = ?').get(b.inboxId).state, 'READ');
  const again = S.markInboxRead([a.inboxId]);
  assert.equal(again.changed, 0, 'idempotent: already READ not re-transitioned');
  assert.throws(() => S.markInboxRead('nope'), /ids array/);
});
