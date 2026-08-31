'use strict';
const { tx } = require('../services/tx');
const { applyTransition } = require('../services/state-machine');
const { appendDomainEvent } = require('../services/audit');
const { EXECUTION_TRANSITIONS } = require('../domain/states');
const { ACTORS } = require('../domain/actors');
const executionService = require('../services/execution-service');
const grantService = require('../services/grant-service');
const { insertQuestion, findOpenQuestion, findLatestQuestion } = require('../domain/execution-question');
const {
  insertPermissionRequest, findOpenPermissionRequest, findLatestPermissionRequest, decide,
} = require('../domain/permission-request');
const { findGrant } = require('../domain/execution-grant');

const WORKER_ACTOR = { actorType: ACTORS.FAKE_WORKER, actorId: 'fake-worker' };

function fakeResult(execution, extraEvidence) {
  return {
    summary: `FakeWorker 完成场景 ${execution.scenario}（模拟结果）`,
    tests: [
      { name: 'fake-smoke-test', status: 'pass' },
      { name: 'fake-unit-tests', status: 'pass', count: 3 },
    ],
    artifacts: [
      { name: 'fake-log.txt', uri: `fake://execution/${execution.id}/log.txt`, content_type: 'text/plain', size: 42 },
    ],
    evidence: Object.assign({
      scenario: execution.scenario,
      attempts: execution.attempt,
      worker: execution.worker,
      simulated: true,
    }, extraEvidence || {}),
    facts: {
      changedFiles: [],
      diffStat: { files: 0, additions: 0, deletions: 0 },
      testsRun: { name: 'fake-unit-tests', status: 'pass', count: 3 },
      commitHash: null,
    },
  };
}

function finishSuccess(db, execution, extraEvidence) {
  executionService.finishExecution(db, execution, {
    result: fakeResult(execution, extraEvidence),
    actor: WORKER_ACTOR,
  });
  return 'finished';
}

function fail(db, execution, error) {
  executionService.failExecution(db, execution, { error, actor: WORKER_ACTOR });
  return 'failed';
}

function waitForUserStep(db, execution) {
  const openQ = findOpenQuestion(db, execution.id);
  if (openQ) return null;
  const latest = findLatestQuestion(db, execution.id);
  if (latest && latest.state === 'ANSWERED') {
    return finishSuccess(db, execution, { answered: true, answer: latest.answer });
  }
  tx(db, () => {
    const qId = insertQuestion(db, {
      executionId: execution.id,
      question: 'FakeWorker 需要确认：是否继续执行（模拟提问）？',
    });
    applyTransition(db, {
      table: 'executions', entityType: 'execution', id: execution.id,
      from: 'RUNNING', to: 'WAITING_FOR_USER',
      transitions: EXECUTION_TRANSITIONS, version: execution.version, actor: WORKER_ACTOR,
      reason: 'worker asked a question',
    });
    appendDomainEvent(db, {
      eventType: 'QUESTION_ASKED', entityType: 'execution', entityId: execution.id, actor: WORKER_ACTOR,
      payload: { questionId: qId },
    });
  });
  return 'waiting_for_user';
}

function waitForApprovalStep(db, execution) {
  const openPerm = findOpenPermissionRequest(db, execution.id);
  if (openPerm) return null;
  const latest = findLatestPermissionRequest(db, execution.id);
  if (latest && latest.state === 'ALLOWED') {
    return finishSuccess(db, execution, { permission: 'network', granted: true });
  }
  if (latest && latest.state === 'DENIED') {
    return fail(db, execution, `permission denied: ${latest.capability}`);
  }
  const grant = execution.grant_id ? findGrant(db, execution.grant_id) : null;
  const capability = 'network';
  const ev = grantService.evaluate(grant, capability);
  let permId;
  tx(db, () => {
    permId = insertPermissionRequest(db, {
      executionId: execution.id, capability,
      grantValue: ev.grantValue, highRisk: ev.highRisk,
    });
    appendDomainEvent(db, {
      eventType: 'PERMISSION_REQUESTED', entityType: 'execution', entityId: execution.id, actor: WORKER_ACTOR,
      payload: { permissionId: permId, capability, grantValue: ev.grantValue, highRisk: ev.highRisk, revoked: ev.revoked },
    });
  });
  if (ev.autoDecision === 'ALLOW') {
    decide(db, permId, {
      decision: 'allow', state: 'ALLOWED',
      decidedByType: ACTORS.HUB, decidedById: 'hub-v01',
    });
    appendDomainEvent(db, {
      eventType: 'PERMISSION_DECIDED', entityType: 'execution', entityId: execution.id,
      actor: { actorType: ACTORS.HUB, actorId: 'hub-v01' },
      payload: { permissionId: permId, capability, decision: 'allow', automatic: true },
    });
    return finishSuccess(db, execution, { permission: capability, granted: true, automatic: true });
  }
  if (ev.autoDecision === 'DENY') {
    decide(db, permId, {
      decision: 'deny', state: 'DENIED',
      decidedByType: ACTORS.HUB, decidedById: 'hub-v01',
    });
    appendDomainEvent(db, {
      eventType: 'PERMISSION_DECIDED', entityType: 'execution', entityId: execution.id,
      actor: { actorType: ACTORS.HUB, actorId: 'hub-v01' },
      payload: { permissionId: permId, capability, decision: 'deny', automatic: true },
    });
    return fail(db, execution, `permission denied by grant: ${capability}`);
  }
  tx(db, () => {
    applyTransition(db, {
      table: 'executions', entityType: 'execution', id: execution.id,
      from: 'RUNNING', to: 'WAITING_FOR_APPROVAL',
      transitions: EXECUTION_TRANSITIONS, version: execution.version, actor: WORKER_ACTOR,
      reason: `permission request pending: ${capability}`,
    });
  });
  return 'waiting_for_approval';
}

function crashOnceStep(db, execution, ctx) {
  if (execution.attempt === 1) {
    executionService.crashExecution(db, execution, {
      actor: WORKER_ACTOR,
      retryMs: ctx.cfg.workerCrashRetryMs,
    });
    return 'crashed_once';
  }
  if (execution.attempt >= ctx.cfg.workerCrashMaxAttempts) {
    return fail(db, execution, 'worker crashed repeatedly, retry limit reached');
  }
  return finishSuccess(db, execution, { recoveredAfterCrash: true });
}

function step(db, execution, ctx) {
  if (execution.state === 'QUEUED') {
    executionService.startExecution(db, execution, WORKER_ACTOR);
    return 'started';
  }
  if (execution.state !== 'RUNNING') return null;
  switch (execution.scenario) {
    case 'SUCCESS': return finishSuccess(db, execution, null);
    case 'FAIL': return fail(db, execution, 'worker failed (scenario FAIL)');
    case 'WAIT_FOR_USER': return waitForUserStep(db, execution);
    case 'WAIT_FOR_APPROVAL': return waitForApprovalStep(db, execution);
    case 'CRASH_ONCE_THEN_SUCCESS': return crashOnceStep(db, execution, ctx);
    case 'TIMEOUT': return null;
    default: return null;
  }
}

module.exports = { step, WORKER_ACTOR, fakeResult };
