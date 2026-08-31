'use strict';
const { tx } = require('./tx');
const { applyTransition } = require('./state-machine');
const { appendDomainEvent, appendTransition } = require('./audit');
const { ACTORS } = require('../domain/actors');
const { TASK_TRANSITIONS, EXECUTION_TRANSITIONS, APPROVAL_TRANSITIONS } = require('../domain/states');
const { dispatchId } = require('../domain/ids');
const { InvalidTransitionError, NotFoundError, BadRequestError, VersionConflictError } = require('../domain/errors');
const { findTask } = require('../domain/task');
const { findExecution, listExecutions } = require('../domain/execution');
const { insertResult, findResultByExecution } = require('../domain/result');
const { findQuestion, markAnswered } = require('../domain/execution-question');
const { findPermissionRequest, decide } = require('../domain/permission-request');
const { findActiveGrantForTask, findGrant, insertGrant } = require('../domain/execution-grant');
const { findApproval, findPendingApprovalForCandidate } = require('../domain/approval');
const { appendOutbox } = require('../domain/outbox-event');
const { findOrCreateGlobalConversation, findConversation, insertMessage } = require('../domain/conversation');

function conversationForTask(db, task) {
  if (task.conversation_id) {
    const conv = findConversation(db, task.conversation_id);
    if (conv) return conv;
  }
  return findOrCreateGlobalConversation(db);
}

function syncTaskOnExecutionStart(db, task, actor) {
  if (task.state === 'OPEN' || task.state === 'REVIEW') {
    applyTransition(db, {
      table: 'tasks', entityType: 'task', id: task.id, from: task.state, to: 'EXECUTING',
      transitions: TASK_TRANSITIONS, version: task.version, actor,
      reason: 'execution started',
    });
  } else if (task.state !== 'EXECUTING') {
    throw new InvalidTransitionError('task', task.state, 'EXECUTING');
  }
}

function startExecution(db, execution, actor) {
  return tx(db, () => {
    const task = findTask(db, execution.task_id);
    if (!task) throw new NotFoundError('task', execution.task_id);
    applyTransition(db, {
      table: 'executions', entityType: 'execution', id: execution.id, from: execution.state, to: 'RUNNING',
      transitions: EXECUTION_TRANSITIONS, version: execution.version, actor,
      reason: 'worker started',
      set: [['attempt = attempt + 1'], ['started_at = ?', new Date().toISOString()], ['next_attempt_at = NULL']],
    });
    syncTaskOnExecutionStart(db, task, actor);
    appendDomainEvent(db, {
      eventType: 'EXECUTION_STARTED', entityType: 'execution', entityId: execution.id, actor,
      payload: { worker: execution.worker, scenario: execution.scenario, attempt: execution.attempt + 1 },
    });
  });
}

function finishExecution(db, execution, { result, actor }) {
  return tx(db, () => {
    const task = findTask(db, execution.task_id);
    applyTransition(db, {
      table: 'executions', entityType: 'execution', id: execution.id,
      from: execution.state, to: 'RESULT_AVAILABLE',
      transitions: EXECUTION_TRANSITIONS, version: execution.version, actor,
      reason: 'worker finished', set: [['finished_at = ?', new Date().toISOString()], ['error = NULL']],
    });
    const resultId = insertResult(db, {
      executionId: execution.id, taskId: execution.task_id, worker: execution.worker,
      summary: result.summary, diff: result.diff || null, tests: result.tests || null,
      artifacts: result.artifacts || null, evidence: result.evidence || null,
      facts: result.facts || null,
      actorType: actor.actorType, actorId: actor.actorId,
    });
    if (task.state === 'EXECUTING') {
      applyTransition(db, {
        table: 'tasks', entityType: 'task', id: task.id, from: 'EXECUTING', to: 'RESULT_AVAILABLE',
        transitions: TASK_TRANSITIONS, version: task.version, actor,
        reason: 'execution result available',
      });
    }
    appendDomainEvent(db, {
      eventType: 'RESULT_CREATED', entityType: 'result', entityId: resultId, actor,
      payload: { executionId: execution.id, taskId: execution.task_id },
    });
    const conv = conversationForTask(db, task);
    insertMessage(db, {
      conversationId: conv.id, role: 'SYSTEM', kind: 'RESULT_CARD',
      content: `执行 #${execution.id} 完成，结果 #${resultId} 待审阅`,
      refType: 'result', refId: resultId, actorType: actor.actorType, actorId: actor.actorId,
    });
    return resultId;
  });
}

function failExecution(db, execution, { error, actor }) {
  return tx(db, () => {
    applyTransition(db, {
      table: 'executions', entityType: 'execution', id: execution.id,
      from: execution.state, to: 'FAILED',
      transitions: EXECUTION_TRANSITIONS, version: execution.version, actor,
      reason: 'worker failed',
      set: [['finished_at = ?', new Date().toISOString()], ['error = ?', error]],
    });
    appendDomainEvent(db, {
      eventType: 'EXECUTION_FAILED', entityType: 'execution', entityId: execution.id, actor,
      payload: { error },
    });
    const task = findTask(db, execution.task_id);
    const conv = task ? conversationForTask(db, task) : findOrCreateGlobalConversation(db);
    insertMessage(db, {
      conversationId: conv.id, role: 'SYSTEM', kind: 'STATUS',
      content: `执行 #${execution.id} 失败：${error}`,
      refType: 'execution', refId: execution.id, actorType: actor.actorType, actorId: actor.actorId,
    });
  });
}

function crashExecution(db, execution, { actor, retryMs }) {
  return tx(db, () => {
    applyTransition(db, {
      table: 'executions', entityType: 'execution', id: execution.id,
      from: execution.state, to: 'QUEUED',
      transitions: EXECUTION_TRANSITIONS, version: execution.version, actor,
      reason: 'worker crashed, queued for retry',
      set: [
        ['next_attempt_at = ?', new Date(Date.now() + retryMs).toISOString()],
        ['error = ?', 'simulated worker crash'],
      ],
    });
    appendDomainEvent(db, {
      eventType: 'EXECUTION_CRASHED', entityType: 'execution', entityId: execution.id, actor,
      payload: { retryMs },
    });
  });
}

function answerQuestion(db, { executionId, questionId, answer, actor }) {
  return tx(db, () => {
    const execution = findExecution(db, executionId);
    if (!execution) throw new NotFoundError('execution', executionId);
    if (execution.state !== 'WAITING_FOR_USER') {
      throw new InvalidTransitionError('execution', execution.state, 'RUNNING');
    }
    const question = findQuestion(db, questionId);
    if (!question || question.execution_id !== executionId) throw new NotFoundError('question', questionId);
    if (question.state !== 'OPEN') throw new VersionConflictError('question', questionId);
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
  });
}

function decidePermissionRequest(db, { executionId, permissionId, decision, actor }) {
  if (decision !== 'allow' && decision !== 'deny') throw new BadRequestError(`decision must be allow or deny, got ${decision}`);
  return tx(db, () => {
    const execution = findExecution(db, executionId);
    if (!execution) throw new NotFoundError('execution', executionId);
    if (execution.state !== 'WAITING_FOR_APPROVAL') {
      throw new InvalidTransitionError('execution', execution.state, 'RUNNING');
    }
    const perm = findPermissionRequest(db, permissionId);
    if (!perm || perm.execution_id !== executionId) throw new NotFoundError('permission', permissionId);
    if (perm.state !== 'OPEN') throw new VersionConflictError('permission', permissionId);
    decide(db, permissionId, {
      decision,
      state: decision === 'allow' ? 'ALLOWED' : 'DENIED',
      decidedByType: actor.actorType,
      decidedById: actor.actorId,
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
  });
}

function requestAnotherExecution(db, { taskId, scenario, timeoutMs, actor, grantId, cfg }) {
  return tx(db, () => {
    const task = findTask(db, taskId);
    if (!task) throw new NotFoundError('task', taskId);
    if (!['EXECUTING', 'RESULT_AVAILABLE', 'REVIEW'].includes(task.state)) {
      throw new InvalidTransitionError('task', task.state, 'EXECUTING');
    }
    const grant = grantId ? findGrant(db, grantId) : findActiveGrantForTask(db, taskId);
    if (!grant || grant.state !== 'ACTIVE') throw new BadRequestError('no active execution grant for task');
    const dspId = dispatchId();
    const timeout = timeoutMs || cfg.executionTimeoutMs;
    const deadlineAt = new Date(Date.now() + timeout).toISOString();
    appendOutbox(db, {
      eventType: 'WORKER_DISPATCH_REQUESTED', entityType: 'task', entityId: taskId,
      payload: {
        taskId, grantId: grant.id, dispatchId: dspId, worker: grant.worker,
        scenario, timeoutMs: timeout, deadlineAt,
      },
      maxAttempts: cfg.outboxMaxAttempts,
    });
    appendDomainEvent(db, {
      eventType: 'WORKER_DISPATCH_REQUESTED', entityType: 'task', entityId: taskId, actor,
      payload: { dispatchId, scenario },
    });
    return dspId;
  });
}

function cancelTask(db, { taskId, actor, reason }) {
  return tx(db, () => {
    const task = findTask(db, taskId);
    if (!task) throw new NotFoundError('task', taskId);
    if (task.state === 'COMPLETED' || task.state === 'CANCELLED') {
      throw new InvalidTransitionError('task', task.state, 'CANCELLED');
    }
    applyTransition(db, {
      table: 'tasks', entityType: 'task', id: taskId, from: task.state, to: 'CANCELLED',
      transitions: TASK_TRANSITIONS, version: task.version, actor, reason: reason || 'cancelled by user',
    });
    for (const ex of listExecutions(db, { taskId })) {
      if (['QUEUED', 'RUNNING', 'WAITING_FOR_USER', 'WAITING_FOR_APPROVAL'].includes(ex.state)) {
        applyTransition(db, {
          table: 'executions', entityType: 'execution', id: ex.id, from: ex.state, to: 'CANCELLED',
          transitions: EXECUTION_TRANSITIONS, version: ex.version, actor, reason: 'task cancelled',
        });
      }
    }
    const approval = findPendingApprovalForCandidate(db, task.candidate_id);
    if (approval) {
      applyTransition(db, {
        table: 'approvals', entityType: 'approval', id: approval.id, from: 'PENDING', to: 'CANCELLED',
        transitions: APPROVAL_TRANSITIONS, version: approval.version, actor, reason: 'task cancelled',
      });
    }
    appendDomainEvent(db, { eventType: 'TASK_CANCELLED', entityType: 'task', entityId: taskId, actor });
  });
}

function hasResultForExecution(db, executionId) {
  return findResultByExecution(db, executionId) !== null;
}

function createFollowupExecution(db, { executionId, text, actor, cfg, grantOverrides }) {
  const parent = findExecution(db, executionId);
  if (!parent) throw new NotFoundError('execution', executionId);
  if (!['opencode', 'codex'].includes(parent.worker)) throw new BadRequestError('followup only supported for real workers');
  if (!['RESULT_AVAILABLE', 'FAILED'].includes(parent.state)) {
    throw new BadRequestError(`cannot follow up on execution in state ${parent.state}`);
  }
  if (!text || !String(text).trim()) throw new BadRequestError('followup text required');
  const parentGrant = findGrant(db, parent.grant_id);
  if (!parentGrant || parentGrant.state !== 'ACTIVE') throw new BadRequestError('no active grant for followup');
  let grantId = parentGrant.id;
  if (grantOverrides && typeof grantOverrides === 'object' && Object.keys(grantOverrides).length > 0) {
    const caps = Object.assign({}, JSON.parse(parentGrant.capabilities_json), grantOverrides);
    const task = findTask(db, parent.task_id);
    grantId = insertGrant(db, {
      taskId: parent.task_id, taskVersion: task.version, worker: parentGrant.worker,
      workspace: parentGrant.workspace, capabilities: caps,
      issuedByType: actor.actorType, issuedById: actor.actorId,
    });
    appendDomainEvent(db, {
      eventType: 'GRANT_ISSUED', entityType: 'grant', entityId: grantId, actor,
      payload: { taskId: parent.task_id, worker: parentGrant.worker, followupOf: executionId, capabilities: caps },
    });
  }
  const dspId = dispatchId();
  const timeout = cfg.executionTimeoutMs;
  const deadlineAt = new Date(Date.now() + timeout).toISOString();
  return tx(db, () => {
    appendOutbox(db, {
      eventType: 'WORKER_DISPATCH_REQUESTED', entityType: 'task', entityId: parent.task_id,
      payload: {
        taskId: parent.task_id, grantId, dispatchId: dspId, worker: parent.worker,
        scenario: 'SUCCESS', timeoutMs: timeout, deadlineAt,
        continueThreadId: executionId, prompt: String(text).trim(),
      },
      maxAttempts: cfg.outboxMaxAttempts,
    });
    appendDomainEvent(db, {
      eventType: 'WORKER_FOLLOWUP_REQUESTED', entityType: 'execution', entityId: executionId, actor,
      payload: { dispatchId: dspId, taskId: parent.task_id, grantId },
    });
    return dspId;
  });
}

module.exports = {
  startExecution,
  finishExecution,
  failExecution,
  crashExecution,
  answerQuestion,
  decidePermissionRequest,
  requestAnotherExecution,
  createFollowupExecution,
  cancelTask,
  hasResultForExecution,
};
