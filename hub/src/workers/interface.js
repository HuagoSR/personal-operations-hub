'use strict';
const {
  TASK_TRANSITIONS, EXECUTION_TRANSITIONS,
  DEFAULT_CAPABILITIES, HIGH_RISK_CAPABILITIES, CAPABILITIES,
} = require('../domain/states');
const { applyTransition } = require('../services/state-machine');
const { appendDomainEvent, appendTransition } = require('../services/audit');
const { ACTORS } = require('../domain/actors');
const { tx } = require('../services/tx');
const { insertExecution } = require('../domain/execution');
const { findTask } = require('../domain/task');
const { insertResult } = require('../domain/result');
const { findOrCreateGlobalConversation, insertMessage } = require('../domain/conversation');

const FAKE_WORKER_ACTOR = { actorType: ACTORS.FAKE_WORKER, actorId: 'fake-worker' };

function finishExecutionWithResult(db, execution, result, actor) {
  return tx(db, () => {
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
      actorType: actor.actorType, actorId: actor.actorId,
    });
    const task = findTask(db, execution.task_id);
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
    const conv = findOrCreateGlobalConversation(db);
    insertMessage(db, {
      conversationId: conv.id, role: 'SYSTEM', kind: 'RESULT_CARD',
      content: `execution #${execution.id} finished, result #${resultId} ready for review`,
      refType: 'result', refId: resultId, actorType: actor.actorType, actorId: actor.actorId,
    });
    return resultId;
  });
}

function failExecutionWithError(db, execution, error, actor) {
  return tx(db, () => {
    let current = execution;
    if (current.state === 'FAILED' || current.state === 'CANCELLED') return;
    if (current.state === 'QUEUED') {
      applyTransition(db, {
        table: 'executions', entityType: 'execution', id: current.id,
        from: 'QUEUED', to: 'RUNNING',
        transitions: EXECUTION_TRANSITIONS, version: current.version, actor,
        reason: 'worker start attempt',
        set: [['attempt = attempt + 1'], ['started_at = ?', new Date().toISOString()]],
      });
      current = Object.assign({}, current, { state: 'RUNNING', version: current.version + 1 });
    }
    applyTransition(db, {
      table: 'executions', entityType: 'execution', id: current.id,
      from: current.state, to: 'FAILED',
      transitions: EXECUTION_TRANSITIONS, version: current.version, actor,
      reason: 'worker failed',
      set: [['finished_at = ?', new Date().toISOString()], ['error = ?', error]],
    });
    appendDomainEvent(db, {
      eventType: 'EXECUTION_FAILED', entityType: 'execution', entityId: execution.id, actor,
      payload: { error },
    });
    const conv = findOrCreateGlobalConversation(db);
    insertMessage(db, {
      conversationId: conv.id, role: 'SYSTEM', kind: 'STATUS',
      content: `execution #${execution.id} failed: ${error}`,
      refType: 'execution', refId: execution.id, actorType: actor.actorType, actorId: actor.actorId,
    });
  });
}

module.exports = {
  FAKE_WORKER_ACTOR,
  finishExecutionWithResult,
  failExecutionWithError,
  CAPABILITIES,
  HIGH_RISK_CAPABILITIES,
  DEFAULT_CAPABILITIES,
};
