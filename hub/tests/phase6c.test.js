'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { makeDb, makeCtx, pumpUntil, seedCandidateViaCommand, USER_ACTOR } = require('./helpers');
const { ensureSystemEntities } = require('../src/services/bootstrap');
const { createUserCommand } = require('../src/services/user-command-service');
const { approveCandidate } = require('../src/services/candidate-service');
const { findTask } = require('../src/domain/task');
const { listExecutions } = require('../src/domain/execution');
const { createServiceFacade } = require('../src/services/facade');
const { createServer } = require('../src/api/server');
const { insertConversation, findConversation } = require('../src/domain/conversation');

function startApp(db, ctx) {
  const server = createServer(db, ctx, ctx.cfg);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` }));
  });
}

async function req(base, method, p, body) {
  const res = await fetch(base + p, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

test('6C: command binds to given conversation and inherits its project', () => {
  const { db } = makeDb();
  const ctx = makeCtx();
  const boot = ensureSystemEntities(db);
  const convId = insertConversation(db, { projectId: boot.hubProject.id, title: 'UI 改造', kind: 'PROJECT' });
  const r = createUserCommand(db, {
    text: '修复会话绑定', projectId: null, conversationId: convId,
    actor: USER_ACTOR, ttlMs: ctx.cfg.approvalDefaultTtlMs,
  });
  const conv = findConversation(db, convId);
  const cmd = db.prepare('SELECT * FROM user_commands WHERE id = ?').get(r.commandId);
  assert.equal(cmd.conversation_id, convId);
  assert.equal(cmd.project_id, boot.hubProject.id);
  const cand = db.prepare('SELECT * FROM task_candidates WHERE id = ?').get(r.candidateId);
  assert.equal(cand.project_id, boot.hubProject.id);
  const msgCount = db.prepare('SELECT COUNT(*) c FROM conversation_messages WHERE conversation_id = ?').get(convId).c;
  assert.equal(msgCount, 2);
  const res = approveCandidate(db, { candidateId: r.candidateId, actor: USER_ACTOR, scenario: 'SUCCESS', worker: 'fake-worker', cfg: ctx.cfg });
  const task = findTask(db, res.taskId);
  assert.equal(task.conversation_id, convId);
  assert.equal(task.project_id, boot.hubProject.id);
});

test('6C: command without conversationId still lands in Global Hub', () => {
  const { db } = makeDb();
  const ctx = makeCtx();
  const r = seedCandidateViaCommand(db, ctx, { text: 'default conv' });
  const cmd = db.prepare('SELECT * FROM user_commands WHERE id = ?').get(r.commandId);
  const global = db.prepare("SELECT id FROM conversations WHERE kind = 'GLOBAL_HUB'").get();
  assert.equal(cmd.conversation_id, global.id);
});

test('6C: unknown conversationId returns 404 via API', async () => {
  const { db } = makeDb();
  const ctx = makeCtx();
  const app = await startApp(db, ctx);
  try {
    const r = await req(app.base, 'POST', '/api/user-commands', { text: 'x', conversationId: 9999 });
    assert.equal(r.status, 404);
    assert.equal(r.data.error.code, 'NOT_FOUND');
  } finally {
    app.server.close();
  }
});

test('6C: timeline approval items carry candidate info', () => {
  const { db } = makeDb();
  const ctx = makeCtx();
  const boot = ensureSystemEntities(db);
  const convId = insertConversation(db, { projectId: boot.hubProject.id, title: 'T', kind: 'PROJECT' });
  const r = createUserCommand(db, {
    text: 'timeline approval card', projectId: null, conversationId: convId,
    actor: USER_ACTOR, ttlMs: ctx.cfg.approvalDefaultTtlMs,
  });
  const S = createServiceFacade(db, ctx);
  const tl = S.conversationTimeline(convId);
  const approvalItems = tl.items.filter((i) => i.type === 'approval');
  assert.ok(approvalItems.length >= 1);
  const a = approvalItems[0].data;
  assert.ok(a.candidate, 'approval item has candidate');
  assert.equal(a.candidate.id, r.candidateId);
  assert.equal(a.candidate.title, 'timeline approval card');
  assert.ok(tl.candidates.some((c) => c.id === r.candidateId));
});

test('6C: plain message post still works in project conversation', async () => {
  const { db } = makeDb();
  const ctx = makeCtx();
  const app = await startApp(db, ctx);
  try {
    const boot = ensureSystemEntities(db);
    const convId = insertConversation(db, { projectId: boot.hubProject.id, title: 'M', kind: 'PROJECT' });
    let r = await req(app.base, 'POST', `/api/conversations/${convId}/messages`, { text: '普通消息' });
    assert.equal(r.status, 201);
    r = await req(app.base, 'GET', `/api/conversations/${convId}/timeline`);
    assert.equal(r.status, 200);
    assert.ok(r.data.items.some((i) => i.type === 'message' && i.data.content === '普通消息'));
  } finally {
    app.server.close();
  }
});
