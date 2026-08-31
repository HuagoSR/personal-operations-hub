'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { makeDb, makeCtx, seedCandidateViaCommand, pumpUntil, USER_ACTOR } = require('./helpers');
const { approveCandidate } = require('../src/services/candidate-service');
const { decideWorkerPermission, workerAsksQuestion, answerWorkerQuestion } = require('../src/workers/approval-policy');
const { findExecution } = require('../src/domain/execution');
const { findQuestion } = require('../src/domain/execution-question');
const { findPermissionRequest } = require('../src/domain/permission-request');
const { listExecutions } = require('../src/domain/execution');

test('permission dedup: same external id reuses existing row and decision', () => {
  const { db } = makeDb();
  const ctx = makeCtx();
  const { candidateId } = seedCandidateViaCommand(db, ctx, { text: 'dedup test' });
  const { grantId } = approveCandidate(db, {
    candidateId, actor: USER_ACTOR, scenario: 'SUCCESS', worker: 'codex', cfg: ctx.cfg,
  });
  const { consumeOutboxOnce } = require('../src/services/dispatcher');
  consumeOutboxOnce(db, ctx);
  const { applyTransition } = require('../src/services/state-machine');
  const { EXECUTION_TRANSITIONS } = require('../src/domain/states');
  const ex0 = listExecutions(db)[0];
  applyTransition(db, {
    table: 'executions', entityType: 'execution', id: ex0.id, from: 'QUEUED', to: 'RUNNING',
    transitions: EXECUTION_TRANSITIONS, version: ex0.version, actor: { actorType: 'FAKE_WORKER', actorId: 'fake-worker' },
    reason: 'test start',
  });
  const grant = db.prepare('SELECT * FROM execution_grants WHERE id = ?').get(grantId);
  const execution = listExecutions(db)[0];

  const r1 = decideWorkerPermission(db, {
    executionId: execution.id, grant, capability: 'run_project_commands',
    worker: 'codex', externalId: 'cx:item-1',
  });
  assert.equal(r1.decision, 'ALLOW');
  const r2 = decideWorkerPermission(db, {
    executionId: execution.id, grant, capability: 'run_project_commands',
    worker: 'codex', externalId: 'cx:item-1',
  });
  assert.equal(r2.decision, 'ALLOW');
  assert.equal(r2.reused, true);
  assert.equal(r1.permissionId, r2.permissionId);
  const count = db.prepare("SELECT COUNT(*) AS c FROM permission_requests WHERE execution_id = ? AND external_id = 'cx:item-1'")
    .get(execution.id).c;
  assert.equal(count, 1);
});

test('permission dedup: ASK request re-sent keeps same OPEN row', () => {
  const { db } = makeDb();
  const ctx = makeCtx();
  const { candidateId } = seedCandidateViaCommand(db, ctx, { text: 'ask dedup' });
  const { grantId } = approveCandidate(db, {
    candidateId, actor: USER_ACTOR, scenario: 'SUCCESS', worker: 'codex',
    capabilities: { run_project_commands: 'ask' }, cfg: ctx.cfg,
  });
  const { consumeOutboxOnce } = require('../src/services/dispatcher');
  consumeOutboxOnce(db, ctx);
  const { applyTransition } = require('../src/services/state-machine');
  const { EXECUTION_TRANSITIONS } = require('../src/domain/states');
  const ex0 = listExecutions(db)[0];
  applyTransition(db, {
    table: 'executions', entityType: 'execution', id: ex0.id, from: 'QUEUED', to: 'RUNNING',
    transitions: EXECUTION_TRANSITIONS, version: ex0.version, actor: { actorType: 'FAKE_WORKER', actorId: 'fake-worker' },
    reason: 'test start',
  });
  const grant = db.prepare('SELECT * FROM execution_grants WHERE id = ?').get(grantId);
  const execution = listExecutions(db)[0];

  const r1 = decideWorkerPermission(db, {
    executionId: execution.id, grant, capability: 'run_project_commands',
    worker: 'codex', externalId: 'cx:item-2',
  });
  assert.equal(r1.decision, 'ASK_USER');
  assert.equal(findExecution(db, execution.id).state, 'WAITING_FOR_APPROVAL');
  const r2 = decideWorkerPermission(db, {
    executionId: execution.id, grant, capability: 'run_project_commands',
    worker: 'codex', externalId: 'cx:item-2',
  });
  assert.equal(r2.decision, 'ASK_USER');
  assert.equal(r2.reused, true);
  const count = db.prepare("SELECT COUNT(*) AS c FROM permission_requests WHERE execution_id = ? AND external_id = 'cx:item-2'")
    .get(execution.id).c;
  assert.equal(count, 1);
});

test('worker question machinery: ask -> WAITING_FOR_USER -> answer -> RUNNING', () => {
  const { db } = makeDb();
  const ctx = makeCtx();
  const { candidateId } = seedCandidateViaCommand(db, ctx, { text: 'question test' });
  const { grantId } = approveCandidate(db, {
    candidateId, actor: USER_ACTOR, scenario: 'SUCCESS', worker: 'codex', cfg: ctx.cfg,
  });
  const { consumeOutboxOnce } = require('../src/services/dispatcher');
  consumeOutboxOnce(db, ctx);
  const { applyTransition } = require('../src/services/state-machine');
  const { EXECUTION_TRANSITIONS } = require('../src/domain/states');
  const ex0 = listExecutions(db)[0];
  applyTransition(db, {
    table: 'executions', entityType: 'execution', id: ex0.id, from: 'QUEUED', to: 'RUNNING',
    transitions: EXECUTION_TRANSITIONS, version: ex0.version, actor: { actorType: 'FAKE_WORKER', actorId: 'fake-worker' },
    reason: 'test start',
  });
  const grant = db.prepare('SELECT * FROM execution_grants WHERE id = ?').get(grantId);
  const execution = listExecutions(db)[0];

  const qId = workerAsksQuestion(db, {
    executionId: execution.id,
    question: 'which priority?',
    worker: 'codex',
    externalId: 42,
  });
  assert.ok(qId);
  assert.equal(findExecution(db, execution.id).state, 'WAITING_FOR_USER');
  const q = findQuestion(db, qId);
  assert.equal(q.state, 'OPEN');

  const r = answerWorkerQuestion(db, {
    executionId: execution.id, questionId: qId, answer: 'high', actor: USER_ACTOR,
  });
  assert.equal(r.ok, true);
  assert.equal(findExecution(db, execution.id).state, 'RUNNING');
  assert.equal(findQuestion(db, qId).state, 'ANSWERED');

  const r2 = answerWorkerQuestion(db, {
    executionId: execution.id, questionId: qId, answer: 'again', actor: USER_ACTOR,
  });
  assert.equal(r2.error, 'INVALID_TRANSITION');
});

test('permission dedup: revoked grant never auto-allows (evaluate returns null)', () => {
  const { db } = makeDb();
  const ctx = makeCtx();
  const { candidateId } = seedCandidateViaCommand(db, ctx, { text: 'revoke dedup' });
  const { grantId } = approveCandidate(db, {
    candidateId, actor: USER_ACTOR, scenario: 'SUCCESS', worker: 'codex',
    capabilities: { run_project_commands: 'allow' }, cfg: ctx.cfg,
  });
  const { revokeGrant } = require('../src/services/grant-admin');
  revokeGrant(db, { grantId, actor: USER_ACTOR, reason: 'test' });
  const { consumeOutboxOnce } = require('../src/services/dispatcher');
  consumeOutboxOnce(db, ctx);
  const { applyTransition } = require('../src/services/state-machine');
  const { EXECUTION_TRANSITIONS } = require('../src/domain/states');
  const ex0 = listExecutions(db)[0];
  applyTransition(db, {
    table: 'executions', entityType: 'execution', id: ex0.id, from: 'QUEUED', to: 'RUNNING',
    transitions: EXECUTION_TRANSITIONS, version: ex0.version, actor: { actorType: 'FAKE_WORKER', actorId: 'fake-worker' },
    reason: 'test start',
  });
  const grant = db.prepare('SELECT * FROM execution_grants WHERE id = ?').get(grantId);
  const execution = listExecutions(db)[0];

  const r = decideWorkerPermission(db, {
    executionId: execution.id, grant, capability: 'run_project_commands',
    worker: 'codex', externalId: 'cx:item-3',
  });
  assert.equal(r.decision, 'ASK_USER');
  assert.equal(findPermissionRequest(db, r.permissionId).grant_value, null);
});



