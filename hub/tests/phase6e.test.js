'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { makeDb, makeCtx, USER_ACTOR } = require('./helpers');
const { createServiceFacade } = require('../src/services/facade');
const { ensureSystemEntities } = require('../src/services/bootstrap');
const { approveCandidate } = require('../src/services/candidate-service');
const { findGrant } = require('../src/domain/execution-grant');
const { insertResult } = require('../src/domain/result');
const { createServer } = require('../src/api/server');

function seedHubCandidate(db) {
  const cand = Number(db.prepare("INSERT INTO task_candidates (origin_type, origin_id, title, description, project_id, actor_type, actor_id) VALUES ('USER_COMMAND', 'cmd-hub-' || (SELECT COUNT(*)+1 FROM task_candidates), 'hub task', NULL, 1, 'USER', 'owner')").run().lastInsertRowid);
  db.prepare("INSERT INTO approvals (approval_type, candidate_id, state, version, actor_type, actor_id) VALUES ('TASK_APPROVAL', ?, 'PENDING', 1, 'USER', 'owner')").run(cand);
  return cand;
}

function seedExecution(db, taskId, worker) {
  return Number(db.prepare(`INSERT INTO executions (task_id, grant_id, worker, scenario, execution_dispatch_id, state, version)
    VALUES (?, NULL, ?, 'SUCCESS', 'dsp-e-' || (SELECT COUNT(*)+1 FROM executions), 'RESULT_AVAILABLE', 1)`)
    .run(taskId, worker || 'codex').lastInsertRowid);
}

function startApp(db, ctx) {
  const server = createServer(db, ctx, ctx.cfg);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` }));
  });
}

test('6E: self project approval applies template, only-tighten overrides, forced workspace', () => {
  const { db } = makeDb();
  const ctx = makeCtx({ cfg: { selfDevWorkspace: '/tmp/hub-dev-test' } });
  ensureSystemEntities(db);
  const candId = seedHubCandidate(db);
  const r = approveCandidate(db, {
    candidateId: candId, actor: USER_ACTOR, scenario: 'SUCCESS', worker: 'codex',
    capabilities: { git_push: 'allow', network: 'deny', sudo: 'allow', outside_project: 'allow' },
    workspace: '/tmp/evil-workspace', cfg: ctx.cfg,
  });
  const grant = findGrant(db, r.grantId);
  assert.equal(grant.workspace, '/tmp/hub-dev-test');
  const caps = JSON.parse(grant.capabilities_json);
  assert.equal(caps.git_push, 'ask', 'cannot loosen git_push');
  assert.equal(caps.sudo, 'deny', 'sudo stays deny');
  assert.equal(caps.outside_project, 'deny', 'outside_project stays deny');
  assert.equal(caps.network, 'deny', 'tightening allowed');
  assert.equal(caps.git_commit, 'allow', 'template allow kept');
  assert.equal(caps.install_dependencies, 'allow', 'template allow kept');
});

test('6E: non-hub project keeps default capability merge', () => {
  const { db } = makeDb();
  const ctx = makeCtx();
  const cand = Number(db.prepare("INSERT INTO task_candidates (origin_type, origin_id, title, project_id, actor_type, actor_id) VALUES ('USER_COMMAND', 'cmd-x', 't', NULL, 'USER', 'owner')").run().lastInsertRowid);
  db.prepare("INSERT INTO approvals (approval_type, candidate_id, state, version, actor_type, actor_id) VALUES ('TASK_APPROVAL', ?, 'PENDING', 1, 'USER', 'owner')").run(cand);
  const r = approveCandidate(db, { candidateId: cand, actor: USER_ACTOR, scenario: 'SUCCESS', worker: 'fake-worker', cfg: ctx.cfg });
  const caps = JSON.parse(findGrant(db, r.grantId).capabilities_json);
  assert.equal(caps.outside_project, 'ask');
  assert.equal(caps.install_dependencies, 'ask');
});

test('6E: prepareApplyRequest lifecycle', () => {
  const { db } = makeDb();
  const ctx = makeCtx({ cfg: { selfDevBaseCommit: 'base123' } });
  ensureSystemEntities(db);
  const candId = seedHubCandidate(db);
  const r = approveCandidate(db, { candidateId: candId, actor: USER_ACTOR, scenario: 'SUCCESS', worker: 'codex', cfg: ctx.cfg });
  const resultId = insertResult(db, {
    executionId: seedExecution(db, r.taskId), taskId: r.taskId, worker: 'codex', summary: 'done',
    facts: { commitHash: 'abc1234def', baseCommit: null, commitSubject: 'pilot change', diffStat: { files: 2, additions: 10, deletions: 3 }, changedFiles: [{ path: 'src/web/index.html' }] },
    actorType: USER_ACTOR.actorType, actorId: USER_ACTOR.actorId,
  });
  const S = createServiceFacade(db, ctx);
  const ar1 = S.prepareApplyRequest(resultId);
  assert.equal(ar1.state, 'PREPARED');
  assert.equal(ar1.source_commit, 'abc1234def');
  assert.equal(ar1.base_commit, 'base123');
  const ar2 = S.prepareApplyRequest(resultId);
  assert.equal(ar2.id, ar1.id, 'duplicate returns same request');
  const a = S.attentionList();
  assert.equal(a.applyRequests.length, 1);
  assert.equal(a.count, 1);
  S.markApplyRequestStatus(ar1.id, 'APPLIED', 'ok');
  const after = S.applyRequestList()[0];
  assert.equal(after.state, 'APPLIED');
  assert.ok(after.applied_at);
  assert.throws(() => S.markApplyRequestStatus(ar1.id, 'ROLLED_BACK'), /PREPARED/);
  assert.throws(() => S.markApplyRequestStatus(ar1.id, 'NOPE'), /unknown apply state/);
});

test('6E: prepare rejects non-hub or missing commit', () => {
  const { db } = makeDb();
  const ctx = makeCtx();
  ensureSystemEntities(db);
  const cand = Number(db.prepare("INSERT INTO task_candidates (origin_type, origin_id, title, project_id, actor_type, actor_id) VALUES ('USER_COMMAND', 'cmd-y', 't', NULL, 'USER', 'owner')").run().lastInsertRowid);
  db.prepare("INSERT INTO approvals (approval_type, candidate_id, state, version, actor_type, actor_id) VALUES ('TASK_APPROVAL', ?, 'PENDING', 1, 'USER', 'owner')").run(cand);
  const r = approveCandidate(db, { candidateId: cand, actor: USER_ACTOR, scenario: 'SUCCESS', worker: 'fake-worker', cfg: ctx.cfg });
  const resultId = insertResult(db, {
    executionId: seedExecution(db, r.taskId, 'fake-worker'), taskId: r.taskId, worker: 'fake-worker', summary: 'no commit',
    facts: { commitHash: null },
    actorType: USER_ACTOR.actorType, actorId: USER_ACTOR.actorId,
  });
  const S = createServiceFacade(db, ctx);
  assert.throws(() => S.prepareApplyRequest(resultId), /commit hash/);
  const hubCandId = seedHubCandidate(db);
  const hr = approveCandidate(db, { candidateId: hubCandId, actor: USER_ACTOR, scenario: 'SUCCESS', worker: 'codex', cfg: ctx.cfg });
  const r2 = insertResult(db, {
    executionId: seedExecution(db, hr.taskId), taskId: hr.taskId, worker: 'codex', summary: 'commit',
    facts: { commitHash: 'abc' },
    actorType: USER_ACTOR.actorType, actorId: USER_ACTOR.actorId,
  });
  assert.throws(() => S.prepareApplyRequest(9999));
  const ok = S.prepareApplyRequest(r2);
  assert.equal(ok.state, 'PREPARED');
});

test('6E: apply-request API routes', async () => {
  const { db } = makeDb();
  const ctx = makeCtx();
  ensureSystemEntities(db);
  const app = await startApp(db, ctx);
  try {
    let r = await fetch(app.base + '/api/apply-requests').then((x) => x.json());
    assert.ok(Array.isArray(r));
    r = await fetch(app.base + '/api/apply-requests/999/status', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ state: 'APPLIED' }),
    });
    assert.equal(r.status, 404);
  } finally {
    app.server.close();
  }
});

test('6E: json responder never throws on already-sent headers', async () => {
  const http = require('node:http');
  const { json } = require('../src/api/server');
  const server = http.createServer((req, res) => {
    json(res, 200, { a: 1 });
    assert.doesNotThrow(() => json(res, 500, { b: 2 }));
    assert.doesNotThrow(() => json(res, 400, { c: 3 }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const resp = await fetch(`http://127.0.0.1:${server.address().port}/`);
    assert.equal(resp.status, 200);
    const data = await resp.json();
    assert.equal(data.a, 1);
  } finally {
    server.close();
  }
});
