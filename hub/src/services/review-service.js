'use strict';
const { tx } = require('./tx');
const { applyTransition } = require('./state-machine');
const { appendDomainEvent } = require('./audit');
const { ACTORS } = require('../domain/actors');
const { TASK_TRANSITIONS } = require('../domain/states');
const { BadRequestError, InvalidTransitionError, NotFoundError } = require('../domain/errors');
const { findResult } = require('../domain/result');
const { findTask } = require('../domain/task');
const { findOrCreateGlobalConversation, insertMessage } = require('../domain/conversation');

function completeReview(db, { resultId, actor }) {
  if (actor.actorType !== ACTORS.USER) {
    throw new BadRequestError('only USER can complete task review');
  }
  const result = findResult(db, resultId);
  if (!result) throw new NotFoundError('result', resultId);
  const task = findTask(db, result.task_id);
  if (!task) throw new NotFoundError('task', result.task_id);
  if (task.state !== 'REVIEW' && task.state !== 'RESULT_AVAILABLE') {
    throw new InvalidTransitionError('task', task.state, 'COMPLETED');
  }
  return tx(db, () => {
    if (task.state === 'RESULT_AVAILABLE') {
      applyTransition(db, {
        table: 'tasks', entityType: 'task', id: task.id, from: 'RESULT_AVAILABLE', to: 'REVIEW',
        transitions: TASK_TRANSITIONS, version: task.version, actor, reason: 'result under review',
      });
    }
    applyTransition(db, {
      table: 'tasks', entityType: 'task', id: task.id, from: 'REVIEW', to: 'COMPLETED',
      transitions: TASK_TRANSITIONS, version: task.version + 1, actor, reason: 'review completed by user',
    });
    appendDomainEvent(db, {
      eventType: 'TASK_REVIEWED', entityType: 'task', entityId: task.id, actor,
      payload: { resultId, decision: 'complete' },
    });
    const conv = findOrCreateGlobalConversation(db);
    insertMessage(db, {
      conversationId: conv.id, role: 'SYSTEM', kind: 'STATUS',
      content: `任务 #${task.id} 已确认完成`,
      refType: 'task', refId: task.id, actorType: actor.actorType, actorId: actor.actorId,
    });
  });
}

module.exports = { completeReview };
