'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { makeDb, makeCtx, makeFixtureSpool, spoolRecord, pumpUntil, seedCandidateViaCommand, USER_ACTOR } = require('./helpers');
const { ingestOnce } = require('../src/services/ingest');
const { consumeOutboxOnce } = require('../src/services/dispatcher');
const { sweepOnce } = require('../src/services/sweep');
const { approveCandidate } = require('../src/services/candidate-service');
const { answerQuestion, decidePermissionRequest } = require('../src/services/execution-service');
const { completeReview } = require('../src/services/review-service');
const { revokeGrant } = require('../src/services/grant-admin');
const { listRawMessages } = require('../src/domain/raw-message');
const { listEvents } = require('../src/domain/event');
const { listInboxItems } = require('../src/domain/inbox-item');
const { findApproval } = require('../src/domain/approval');
const { findCandidate } = require('../src/domain/task-candidate');
const { findTask, listTasks } = require('../src/domain/task');
const { findGrant } = require('../src/domain/execution-grant');
const { findExecution, listExecutions } = require('../src/domain/execution');
const { findResult, findResultByExecution } = require('../src/domain/result');
const { listOutbox } = require('../src/domain/outbox-event');
const { findOpenQuestion } = require('../src/domain/execution-question');
const { findOpenPermissionRequest } = require('../src/domain/permission-request');

const { openDatabase } = require('../src/db');
const path = require('path');

test('Test 1: duplicate source ingest produces single RawMessage/Event', async () => {
  const { db, dir } = makeDb();
  const ctx = makeCtx();
  const spoolDir = path.join(dir, 'spool');
  makeFixtureSpool(spoolDir, [
    spoolRecord({ local_id: 1, sequence: 1, text: 'a' }),
    spoolRecord({ local_id: 2, sequence: 2, text: 'b', is_mentioned: true }),
  ]);
  ingestOnce(db, { spoolDir, inboxRule: 'mentioned_or_direct', logger: ctx.logger });
  ingestOnce(db, { spoolDir, inboxRule: 'mentioned_or_direct', logger: ctx.logger });
  assert.equal(listRawMessages(db).length, 2);
  assert.equal(listEvents(db).length, 2);
  assert.equal(listInboxItems(db).length, 1);
  const keys = db.prepare('SELECT idempotency_key FROM raw_messages ORDER BY id').all();
  assert.equal(keys.length, 2);
});

test('Test 2: double approve only succeeds once', async () => {
  const { db } = makeDb();
  const ctx = makeCtx();
  const { candidateId, approvalId } = seedCandidateViaCommand(db, ctx, { text: 'double approve test' });
  const res = approveCandidate(db, {
    candidateId, actor: USER_ACTOR, scenario: 'SUCCESS', cfg: ctx.cfg,
  });
  assert.ok(res.taskId);
  assert.throws(() => approveCandidate(db, {
    candidateId, actor: USER_ACTOR, scenario: 'SUCCESS', cfg: ctx.cfg,
  }), /not allowed/);
  assert.equal(listTasks(db).length, 1);
  const converted = db.prepare("SELECT COUNT(*) AS c FROM transition_log WHERE entity_type='candidate' AND entity_id=? AND from_state='OPEN' AND to_state='CONVERTED'")
    .get(candidateId).c;
  assert.equal(converted, 1);
  assert.equal(listOutbox(db, { state: 'PENDING' }).length, 1);
});

test('Test 3: crash after approval does not lose dispatch', async () => {
  const { db, dir } = makeDb();
  const ctx = makeCtx();
  const { candidateId } = seedCandidateViaCommand(db, ctx, { text: 'crash test' });
  const { dispatchId } = approveCandidate(db, {
    candidateId, actor: USER_ACTOR, scenario: 'SUCCESS', cfg: ctx.cfg,
  });
  assert.equal(listExecutions(db).length, 0);
  db.close();
  const { openDatabase: reopen } = require('../src/db');
  const db2 = openDatabase(path.join(dir, 'hub.db'));
  const { migrate } = require('../src/db');
  migrate(db2, path.join(__dirname, '..', 'src', 'migrations'));
  await await pumpUntil(db2, ctx, () => {
    const ex = db2.prepare('SELECT * FROM executions WHERE execution_dispatch_id = ?').get(dispatchId);
    return ex && ex.state === 'RESULT_AVAILABLE';
  });
  assert.equal(listExecutions(db2).length, 1);
  const out = listOutbox(db2);
  assert.equal(out.length, 1);
  assert.equal(out[0].state, 'DISPATCHED');
  assert.equal(out[0].dispatch_id, dispatchId);
});

test('Test 4: duplicate outbox delivery creates one execution and one effect', async () => {
  const { db } = makeDb();
  const ctx = makeCtx();
  const { candidateId } = seedCandidateViaCommand(db, ctx, { text: 'dup delivery' });
  const { dispatchId } = approveCandidate(db, {
    candidateId, actor: USER_ACTOR, scenario: 'SUCCESS', cfg: ctx.cfg,
  });
  const ev = listOutbox(db)[0];
  const { dispatchOutboxEvent } = require('../src/services/dispatcher');
  dispatchOutboxEvent(db, ev, ctx);
  db.prepare("UPDATE outbox_events SET state = 'PENDING' WHERE id = ?").run(ev.id);
  dispatchOutboxEvent(db, ev, ctx);
  assert.equal(listExecutions(db).length, 1);
  await pumpUntil(db, ctx, () => {
    const ex = db.prepare('SELECT * FROM executions WHERE execution_dispatch_id = ?').get(dispatchId);
    return ex.state === 'RESULT_AVAILABLE';
  });
  const runs = db.prepare("SELECT COUNT(*) AS c FROM transition_log WHERE entity_type='execution' AND from_state='QUEUED' AND to_state='RUNNING'").get().c;
  assert.equal(runs, 1);
  assert.equal(listOutbox(db).filter((o) => o.dispatch_id === dispatchId && o.state === 'DISPATCHED').length, 1);
});

test('Test 5: worker failure leaves task not completed', async () => {
  const { db } = makeDb();
  const ctx = makeCtx();
  const { candidateId } = seedCandidateViaCommand(db, ctx, { text: 'fail test' });
  const { taskId } = approveCandidate(db, {
    candidateId, actor: USER_ACTOR, scenario: 'FAIL', cfg: ctx.cfg,
  });
  await pumpUntil(db, ctx, () => {
    const ex = listExecutions(db)[0];
    return ex && ex.state === 'FAILED';
  });
  const ex = listExecutions(db)[0];
  assert.equal(ex.error, 'worker failed (scenario FAIL)');
  const task = findTask(db, taskId);
  assert.equal(task.state, 'EXECUTING');
  assert.notEqual(task.state, 'COMPLETED');
});

test('Test 6: WAITING_FOR_USER survives restart and continues same execution', async () => {
  const { db, dir } = makeDb();
  const ctx = makeCtx();
  const { candidateId } = seedCandidateViaCommand(db, ctx, { text: 'wait user' });
  const { taskId } = approveCandidate(db, {
    candidateId, actor: USER_ACTOR, scenario: 'WAIT_FOR_USER', cfg: ctx.cfg,
  });
  await pumpUntil(db, ctx, () => {
    const ex = listExecutions(db)[0];
    return ex && ex.state === 'WAITING_FOR_USER';
  });
  const before = listExecutions(db)[0];
  const q = findOpenQuestion(db, before.id);
  assert.ok(q);
  db.close();
  const { openDatabase: reopen, migrate } = require('../src/db');
  const db2 = openDatabase(path.join(dir, 'hub.db'));
  migrate(db2, path.join(__dirname, '..', 'src', 'migrations'));
  await await pumpUntil(db2, ctx, () => false, 100);
  const after = db2.prepare('SELECT * FROM executions WHERE id = ?').get(before.id);
  assert.equal(after.state, 'WAITING_FOR_USER');
  answerQuestion(db2, {
    executionId: before.id, questionId: q.id, answer: '缁х画', actor: USER_ACTOR,
  });
  await await pumpUntil(db2, ctx, () => {
    const ex = db2.prepare('SELECT * FROM executions WHERE id = ?').get(before.id);
    return ex.state === 'RESULT_AVAILABLE';
  });
  assert.equal(listExecutions(db2).length, 1);
  const task = findTask(db2, taskId);
  assert.equal(task.state, 'RESULT_AVAILABLE');
});

test('Test 7: expired approval cannot be executed', async () => {
  const { db } = makeDb();
  const ctx = makeCtx();
  const { candidateId, approvalId } = seedCandidateViaCommand(db, ctx, { text: 'ttl test', ttlMs: 80 });
  await new Promise((r) => setTimeout(r, 150));
  const swept = sweepOnce(db, ctx);
  assert.ok(swept.approvals >= 1);
  const approval = findApproval(db, approvalId);
  assert.equal(approval.state, 'EXPIRED');
  const candidate = findCandidate(db, candidateId);
  assert.equal(candidate.state, 'EXPIRED');
  assert.throws(() => approveCandidate(db, {
    candidateId, actor: USER_ACTOR, scenario: 'SUCCESS', cfg: ctx.cfg,
  }), /not allowed/);
});

test('Test 8: revoked grant cannot auto-approve permission', async () => {
  const { db } = makeDb();
  const ctx = makeCtx();
  const { candidateId } = seedCandidateViaCommand(db, ctx, { text: 'revoke test' });
  const { grantId } = approveCandidate(db, {
    candidateId, actor: USER_ACTOR, scenario: 'WAIT_FOR_APPROVAL',
    capabilities: { network: 'allow' }, cfg: ctx.cfg,
  });
  revokeGrant(db, { grantId, actor: USER_ACTOR, reason: 'test revoke' });
  const grant = findGrant(db, grantId);
  assert.equal(grant.state, 'REVOKED');
  await pumpUntil(db, ctx, () => {
    const ex = listExecutions(db)[0];
    return ex && ex.state === 'WAITING_FOR_APPROVAL';
  });
  const ex = listExecutions(db)[0];
  const perm = findOpenPermissionRequest(db, ex.id);
  assert.ok(perm, 'permission request must stay open (not auto-approved)');
  assert.equal(perm.grant_value, null);
  const audit = db.prepare("SELECT COUNT(*) AS c FROM transition_log WHERE entity_type='grant' AND entity_id=? AND to_state='REVOKED'").get(grantId).c;
  assert.equal(audit, 1);
});

test('Test 9: result is immutable', async () => {
  const { db } = makeDb();
  const ctx = makeCtx();
  const { candidateId } = seedCandidateViaCommand(db, ctx, { text: 'immutable' });
  approveCandidate(db, { candidateId, actor: USER_ACTOR, scenario: 'SUCCESS', cfg: ctx.cfg });
  await pumpUntil(db, ctx, () => {
    const ex = listExecutions(db)[0];
    return ex && ex.state === 'RESULT_AVAILABLE';
  });
  const result = findResultByExecution(db, listExecutions(db)[0].id);
  assert.ok(result);
  assert.throws(() => db.prepare('UPDATE results SET summary = ? WHERE id = ?').run('hacked', result.id), /immutable/);
  assert.throws(() => db.prepare('DELETE FROM results WHERE id = ?').run(result.id), /immutable/);
  const after = findResult(db, result.id);
  assert.equal(after.summary, result.summary);
});

test('Test 10: worker cannot complete task, only user review can', async () => {
  const { db } = makeDb();
  const ctx = makeCtx();
  const { candidateId } = seedCandidateViaCommand(db, ctx, { text: 'review test' });
  const { taskId } = approveCandidate(db, {
    candidateId, actor: USER_ACTOR, scenario: 'SUCCESS', cfg: ctx.cfg,
  });
  await pumpUntil(db, ctx, () => {
    const ex = listExecutions(db)[0];
    return ex && ex.state === 'RESULT_AVAILABLE';
  });
  const task = findTask(db, taskId);
  assert.equal(task.state, 'RESULT_AVAILABLE');
  const result = findResultByExecution(db, listExecutions(db)[0].id);
  assert.throws(() => completeReview(db, {
    resultId: result.id, actor: { actorType: 'FAKE_WORKER', actorId: 'fake-worker' },
  }), /only USER/);
  const { applyTransition } = require('../src/services/state-machine');
  const { TASK_TRANSITIONS } = require('../src/domain/states');
  assert.throws(() => applyTransition(db, {
    table: 'tasks', entityType: 'task', id: taskId, from: 'RESULT_AVAILABLE', to: 'COMPLETED',
    transitions: TASK_TRANSITIONS, version: task.version, actor: { actorType: 'FAKE_WORKER', actorId: 'fake-worker' },
    reason: 'worker self-completes',
  }), /not allowed/);
  completeReview(db, { resultId: result.id, actor: USER_ACTOR });
  const done = findTask(db, taskId);
  assert.equal(done.state, 'COMPLETED');
});

test('CRASH_ONCE_THEN_SUCCESS recovers on retry', async () => {
  const { db } = makeDb();
  const ctx = makeCtx();
  const { candidateId } = seedCandidateViaCommand(db, ctx, { text: 'crash once' });
  approveCandidate(db, {
    candidateId, actor: USER_ACTOR, scenario: 'CRASH_ONCE_THEN_SUCCESS', cfg: ctx.cfg,
  });
  await pumpUntil(db, ctx, () => {
    const ex = listExecutions(db)[0];
    return ex && ex.state === 'RESULT_AVAILABLE';
  });
  const ex = listExecutions(db)[0];
  assert.equal(ex.attempt, 2);
  assert.equal(ex.state, 'RESULT_AVAILABLE');
  const crashed = db.prepare("SELECT COUNT(*) AS c FROM transition_log WHERE entity_type='execution' AND to_state='QUEUED' AND reason='worker crashed, queued for retry'").get().c;
  assert.equal(crashed, 1);
});

test('TIMEOUT scenario fails via watchdog', async () => {
  const { db } = makeDb();
  const ctx = makeCtx({ cfg: { executionTimeoutMs: 60 } });
  const { candidateId } = seedCandidateViaCommand(db, ctx, { text: 'timeout test' });
  approveCandidate(db, {
    candidateId, actor: USER_ACTOR, scenario: 'TIMEOUT', timeoutMs: 60, cfg: ctx.cfg,
  });
  await pumpUntil(db, ctx, () => {
    const ex = listExecutions(db)[0];
    return ex && ex.state === 'RUNNING';
  });
  await pumpUntil(db, ctx, () => {
    const ex = listExecutions(db)[0];
    return ex && ex.state === 'FAILED';
  }, 8000);
  const ex = listExecutions(db)[0];
  assert.equal(ex.error, 'execution timed out');
});

test('permission ask path: user decision forwarded to worker', async () => {
  const { db } = makeDb();
  const ctx = makeCtx();
  const { candidateId } = seedCandidateViaCommand(db, ctx, { text: 'ask perm' });
  approveCandidate(db, {
    candidateId, actor: USER_ACTOR, scenario: 'WAIT_FOR_APPROVAL',
    capabilities: { network: 'ask' }, cfg: ctx.cfg,
  });
  await pumpUntil(db, ctx, () => {
    const ex = listExecutions(db)[0];
    return ex && ex.state === 'WAITING_FOR_APPROVAL';
  });
  const ex = listExecutions(db)[0];
  const perm = findOpenPermissionRequest(db, ex.id);
  assert.ok(perm);
  assert.equal(perm.grant_value, 'ask');
  decidePermissionRequest(db, {
    executionId: ex.id, permissionId: perm.id, decision: 'allow', actor: USER_ACTOR,
  });
  await pumpUntil(db, ctx, () => {
    const e2 = db.prepare('SELECT * FROM executions WHERE id = ?').get(ex.id);
    return e2.state === 'RESULT_AVAILABLE';
  });
  assert.ok(findResultByExecution(db, ex.id));
});

test('permission deny path: auto-deny by grant fails execution', async () => {
  const { db } = makeDb();
  const ctx = makeCtx();
  const { candidateId } = seedCandidateViaCommand(db, ctx, { text: 'deny perm' });
  approveCandidate(db, {
    candidateId, actor: USER_ACTOR, scenario: 'WAIT_FOR_APPROVAL',
    capabilities: { network: 'deny' }, cfg: ctx.cfg,
  });
  await pumpUntil(db, ctx, () => {
    const ex = listExecutions(db)[0];
    return ex && ex.state === 'FAILED';
  });
  const ex = listExecutions(db)[0];
  assert.ok(ex.error.includes('permission denied by grant'));
});

