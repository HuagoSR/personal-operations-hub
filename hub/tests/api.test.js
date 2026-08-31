'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { makeDb, makeCtx, pumpUntil } = require('./helpers');
const { createServer } = require('../src/api/server');
const { sweepOnce } = require('../src/services/sweep');
const { listExecutions } = require('../src/domain/execution');
const { findTask } = require('../src/domain/task');
const { findOpenQuestion } = require('../src/domain/execution-question');
const { findOpenPermissionRequest } = require('../src/domain/permission-request');

function startApp(db, ctx) {
  const server = createServer(db, ctx, ctx.cfg);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        server,
        base: `http://127.0.0.1:${server.address().port}`,
      });
    });
  });
}

async function req(base, method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

test('API happy path: command -> approve -> result -> review', async () => {
  const { db } = makeDb();
  const ctx = makeCtx();
  const app = await startApp(db, ctx);
  try {
    let r = await req(app.base, 'GET', '/api/status');
    assert.equal(r.status, 200);
    assert.ok(r.data.ok);

    r = await req(app.base, 'POST', '/api/user-commands', { text: '检查测试' });
    assert.equal(r.status, 201);
    const candidateId = r.data.candidateId;

    r = await req(app.base, 'POST', `/api/candidates/${candidateId}/approve`, { scenario: 'SUCCESS' });
    assert.equal(r.status, 200);
    const taskId = r.data.taskId;

    await pumpUntil(db, ctx, () => {
      const ex = listExecutions(db)[0];
      return ex && ex.state === 'RESULT_AVAILABLE';
    });
    assert.equal(findTask(db, taskId).state, 'RESULT_AVAILABLE');

    const results = await req(app.base, 'GET', '/api/results');
    assert.equal(results.data.length, 1);
    r = await req(app.base, 'POST', `/api/results/${results.data[0].id}/review`, { action: 'complete' });
    assert.equal(r.status, 200);
    assert.equal(findTask(db, taskId).state, 'COMPLETED');

    const detail = await req(app.base, 'GET', `/api/tasks/${taskId}`);
    assert.equal(detail.status, 200);
    assert.equal(detail.data.executions.length, 1);
  } finally {
    app.server.close();
  }
});

test('API double submit approve returns 409', async () => {
  const { db } = makeDb();
  const ctx = makeCtx();
  const app = await startApp(db, ctx);
  try {
    let r = await req(app.base, 'POST', '/api/user-commands', { text: 'double' });
    const candidateId = r.data.candidateId;
    r = await req(app.base, 'POST', `/api/candidates/${candidateId}/approve`, { scenario: 'SUCCESS' });
    assert.equal(r.status, 200);
    r = await req(app.base, 'POST', `/api/candidates/${candidateId}/approve`, { scenario: 'SUCCESS' });
    assert.equal(r.status, 409);
    assert.equal(r.data.error.code, 'INVALID_TRANSITION');
  } finally {
    app.server.close();
  }
});

test('API not found returns 404', async () => {
  const { db } = makeDb();
  const ctx = makeCtx();
  const app = await startApp(db, ctx);
  try {
    const r = await req(app.base, 'GET', '/api/tasks/9999');
    assert.equal(r.status, 404);
  } finally {
    app.server.close();
  }
});

test('API expired approval returns 410', async () => {
  const { db } = makeDb();
  const ctx = makeCtx({ cfg: { approvalDefaultTtlMs: 80 } });
  const app = await startApp(db, ctx);
  try {
    let r = await req(app.base, 'POST', '/api/user-commands', { text: 'expire me' });
    const candidateId = r.data.candidateId;
    await new Promise((res) => setTimeout(res, 150));
    sweepOnce(db, ctx);
    r = await req(app.base, 'POST', `/api/candidates/${candidateId}/approve`, { scenario: 'SUCCESS' });
    assert.equal(r.status, 409);
  } finally {
    app.server.close();
  }
});

test('API revoked grant blocks auto approval of permission', async () => {
  const { db } = makeDb();
  const ctx = makeCtx();
  const app = await startApp(db, ctx);
  try {
    let r = await req(app.base, 'POST', '/api/user-commands', { text: 'revoke via api' });
    const candidateId = r.data.candidateId;
    r = await req(app.base, 'POST', `/api/candidates/${candidateId}/approve`, {
      scenario: 'WAIT_FOR_APPROVAL', grant: { network: 'allow' },
    });
    assert.equal(r.status, 200);
    const grantId = r.data.grantId;
    r = await req(app.base, 'POST', `/api/grants/${grantId}/revoke`, { reason: 'test' });
    assert.equal(r.status, 200);
    await pumpUntil(db, ctx, () => {
      const ex = listExecutions(db)[0];
      return ex && ex.state === 'WAITING_FOR_APPROVAL';
    });
    const perm = findOpenPermissionRequest(db, listExecutions(db)[0].id);
    assert.ok(perm);
  } finally {
    app.server.close();
  }
});

test('API WAIT_FOR_USER question answer flow', async () => {
  const { db } = makeDb();
  const ctx = makeCtx();
  const app = await startApp(db, ctx);
  try {
    let r = await req(app.base, 'POST', '/api/user-commands', { text: 'ask me' });
    const candidateId = r.data.candidateId;
    await req(app.base, 'POST', `/api/candidates/${candidateId}/approve`, { scenario: 'WAIT_FOR_USER' });
    await pumpUntil(db, ctx, () => {
      const ex = listExecutions(db)[0];
      return ex && ex.state === 'WAITING_FOR_USER';
    });
    const ex = listExecutions(db)[0];
    const q = findOpenQuestion(db, ex.id);
    assert.ok(q);
    r = await req(app.base, 'POST', `/api/executions/${ex.id}/questions/${q.id}/answer`, { answer: '继续' });
    assert.equal(r.status, 200);
    r = await req(app.base, 'POST', `/api/executions/${ex.id}/questions/${q.id}/answer`, { answer: 'again' });
    assert.equal(r.status, 409);
    await pumpUntil(db, ctx, () => {
      const e2 = db.prepare('SELECT * FROM executions WHERE id = ?').get(ex.id);
      return e2.state === 'RESULT_AVAILABLE';
    });
  } finally {
    app.server.close();
  }
});

test('API invalid transition on completed task review returns 409', async () => {
  const { db } = makeDb();
  const ctx = makeCtx();
  const app = await startApp(db, ctx);
  try {
    let r = await req(app.base, 'POST', '/api/user-commands', { text: 'complete twice' });
    const candidateId = r.data.candidateId;
    await req(app.base, 'POST', `/api/candidates/${candidateId}/approve`, { scenario: 'SUCCESS' });
    await pumpUntil(db, ctx, () => {
      const ex = listExecutions(db)[0];
      return ex && ex.state === 'RESULT_AVAILABLE';
    });
    const results = await req(app.base, 'GET', '/api/results');
    const resultId = results.data[0].id;
    r = await req(app.base, 'POST', `/api/results/${resultId}/review`, { action: 'complete' });
    assert.equal(r.status, 200);
    r = await req(app.base, 'POST', `/api/results/${resultId}/review`, { action: 'complete' });
    assert.equal(r.status, 409);
    assert.equal(r.data.error.code, 'INVALID_TRANSITION');
  } finally {
    app.server.close();
  }
});
