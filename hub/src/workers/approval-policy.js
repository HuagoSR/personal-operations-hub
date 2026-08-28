'use strict';
const { tx } = require('../services/tx');
const { applyTransition } = require('../services/state-machine');
const { appendDomainEvent } = require('../services/audit');
const { ACTORS } = require('../domain/actors');
const { EXECUTION_TRANSITIONS } = require('../domain/states');
const { findExecution } = require('../domain/execution');
const { insertPermissionRequest, findPermissionRequest, decide } = require('../domain/permission-request');
const { insertQuestion, findQuestion, markAnswered } = require('../domain/execution-question');
const grantService = require('../services/grant-service');

const WORKER_ACTORS = {
  'opencode': { actorType: ACTORS.FAKE_WORKER, actorId: 'opencode-worker' },
  'codex': { actorType: ACTORS.FAKE_WORKER, actorId: 'codex-worker' },
};

function workerActor(workerType) {
  return WORKER_ACTORS[workerType] || { actorType: ACTORS.FAKE_WORKER, actorId: workerType || 'worker' };
}

function decideWorkerPermission(db, { executionId, grant, capability, worker, metadata }) {
  const actor = workerActor(worker);
  const ev = grantService.evaluate(grant, capability);
  return tx(db, () => {
    const permId = insertPermissionRequest(db, {
      executionId, capability, grantValue: ev.grantValue, highRisk: ev.highRisk,
    });
    appendDomainEvent(db, {
      eventType: 'PERMISSION_REQUESTED', entityType: 'execution', entityId: executionId, actor,
      payload: { permissionId: permId, capability, grantValue: ev.grantValue, highRisk: ev.highRisk, worker, metadata: metadata || null },
    });
    if (ev.highRisk || !ev.autoDecision || ev.autoDecision === null || ev.autoDecision === undefined) {
      const execution = findExecution(db, executionId);
      if (execution.state === 'RUNNING') {
        applyTransition(db, {
          table: 'executions', entityType: 'execution', id: executionId,
          from: 'RUNNING', to: 'WAITING_FOR_APPROVAL',
          transitions: EXECUTION_TRANSITIONS, version: execution.version, actor,
          reason: `permission request pending: ${capability}`,
        });
      }
      return { decision: 'ASK_USER', permissionId: permId };
    }
    if (ev.autoDecision === 'ALLOW') {
      decide(db, permId, { decision: 'allow', state: 'ALLOWED', decidedByType: ACTORS.HUB, decidedById: 'hub-v01' });
      appendDomainEvent(db, {
        eventType: 'PERMISSION_DECIDED', entityType: 'execution', entityId: executionId,
        actor: { actorType: ACTORS.HUB, actorId: 'hub-v01' },
        payload: { permissionId: permId, capability, decision: 'allow', automatic: true },
      });
      return { decision: 'ALLOW', permissionId: permId };
    }
    decide(db, permId, { decision: 'deny', state: 'DENIED', decidedByType: ACTORS.HUB, decidedById: 'hub-v01' });
    appendDomainEvent(db, {
      eventType: 'PERMISSION_DECIDED', entityType: 'execution', entityId: executionId,
      actor: { actorType: ACTORS.HUB, actorId: 'hub-v01' },
      payload: { permissionId: permId, capability, decision: 'deny', automatic: true },
    });
    return { decision: 'DENY', permissionId: permId };
  });
}

function workerAsksQuestion(db, { executionId, question, worker, externalId }) {
  const actor = workerActor(worker);
  return tx(db, () => {
    const qId = insertQuestion(db, { executionId, question });
    const execution = findExecution(db, executionId);
    if (execution.state === 'RUNNING') {
      applyTransition(db, {
        table: 'executions', entityType: 'execution', id: executionId,
        from: 'RUNNING', to: 'WAITING_FOR_USER',
        transitions: EXECUTION_TRANSITIONS, version: execution.version, actor,
        reason: 'worker asked a question',
      });
    }
    appendDomainEvent(db, {
      eventType: 'QUESTION_ASKED', entityType: 'execution', entityId: executionId, actor,
      payload: { questionId: qId, externalId: externalId || null },
    });
    return qId;
  });
}

function answerWorkerQuestion(db, { executionId, questionId, answer, actor }) {
  return tx(db, () => {
    const execution = findExecution(db, executionId);
    if (execution.state !== 'WAITING_FOR_USER') return { error: 'INVALID_TRANSITION' };
    const q = findQuestion(db, questionId);
    if (!q || q.execution_id !== executionId) return { error: 'NOT_FOUND' };
    if (q.state !== 'OPEN') return { error: 'VERSION_CONFLICT' };
    markAnswered(db, questionId, answer);
    applyTransition(db, {
      table: 'executions', entityType: 'execution', id: executionId,
      from: 'WAITING_FOR_USER', to: 'RUNNING',
      transitions: EXECUTION_TRANSITIONS, version: execution.version, actor,
      reason: 'user answered worker question',
    });
    appendDomainEvent(db, {
      eventType: 'QUESTION_ANSWERED', entityType: 'execution', entityId: executionId, actor,
      payload: { questionId },
    });
    return { ok: true, questionId };
  });
}

function userDecidesPermission(db, { executionId, permissionId, decision, actor, ctx }) {
  return tx(db, () => {
    const execution = findExecution(db, executionId);
    if (!execution || execution.state !== 'WAITING_FOR_APPROVAL') {
      return { error: 'INVALID_TRANSITION' };
    }
    const perm = findPermissionRequest(db, permissionId);
    if (!perm || perm.execution_id !== executionId || perm.state !== 'OPEN') {
      return { error: perm ? 'VERSION_CONFLICT' : 'NOT_FOUND' };
    }
    decide(db, permissionId, {
      decision, state: decision === 'allow' ? 'ALLOWED' : 'DENIED',
      decidedByType: actor.actorType, decidedById: actor.actorId,
    });
    applyTransition(db, {
      table: 'executions', entityType: 'execution', id: executionId,
      from: 'WAITING_FOR_APPROVAL', to: 'RUNNING',
      transitions: EXECUTION_TRANSITIONS, version: execution.version, actor,
      reason: `permission ${decision}`,
    });
    appendDomainEvent(db, {
      eventType: 'PERMISSION_DECIDED', entityType: 'execution', entityId: executionId, actor,
      payload: { permissionId, capability: perm.capability, decision },
    });
    return { ok: true, permissionId, decision, capability: perm.capability };
  });
}

module.exports = {
  workerActor,
  decideWorkerPermission,
  workerAsksQuestion,
  answerWorkerQuestion,
  userDecidesPermission,
};
