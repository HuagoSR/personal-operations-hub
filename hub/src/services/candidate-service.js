'use strict';
const { tx } = require('./tx');
const { applyTransition } = require('./state-machine');
const { appendDomainEvent, appendTransition } = require('./audit');
const {
  CANDIDATE_TRANSITIONS, APPROVAL_TRANSITIONS, INBOX_TRANSITIONS,
  DEFAULT_CAPABILITIES, SCENARIOS,
} = require('../domain/states');
const { dispatchId } = require('../domain/ids');
const {
  InvalidTransitionError, NotFoundError, BadRequestError,
  ApprovalExpiredError, DuplicateError,
} = require('../domain/errors');
const { findEvent } = require('../domain/event');
const { findInboxItem } = require('../domain/inbox-item');
const { insertCandidate, findCandidate, findCandidateByOrigin } = require('../domain/task-candidate');
const { insertApproval, findPendingApprovalForCandidate } = require('../domain/approval');
const { insertTask, findTask } = require('../domain/task');
const { insertGrant } = require('../domain/execution-grant');
const { appendOutbox } = require('../domain/outbox-event');
const { findUserCommand, markConverted } = require('../domain/user-command');
const { findOrCreateGlobalConversation, findConversation, insertMessage } = require('../domain/conversation');
const { actor } = require('../domain/actors');

function insertCandidateWithApproval(db, { originType, originId, title, description, projectId, sourceEventId, reason, creator, ttlMs }) {
  const expiresAt = ttlMs ? new Date(Date.now() + ttlMs).toISOString() : null;
  const candidateId = insertCandidate(db, {
    originType, originId, title, description: description || null,
    projectId: projectId || null, sourceEventId: sourceEventId || null,
    reason: reason || null, actorType: creator.actorType, actorId: creator.actorId,
  });
  appendTransition(db, {
    entityType: 'candidate', entityId: candidateId, fromState: null, toState: 'OPEN',
    actor: creator, reason: 'candidate created',
  });
  const approvalId = insertApproval(db, {
    approvalType: 'TASK_APPROVAL', candidateId, expiresAt,
    actorType: creator.actorType, actorId: creator.actorId,
  });
  appendDomainEvent(db, {
    eventType: 'TASK_CANDIDATE_CREATED', entityType: 'candidate', entityId: candidateId, actor: creator,
    payload: { originType, originId, approvalId },
  });
  return { candidateId, approvalId };
}

function createCandidateFromInbox(db, { inboxId, title, description, projectId, actor: creator, ttlMs }) {
  const inbox = findInboxItem(db, inboxId);
  if (!inbox) throw new NotFoundError('inbox', inboxId);
  if (!['NEW', 'READ'].includes(inbox.state)) {
    throw new InvalidTransitionError('inbox', inbox.state, 'CONVERTED');
  }
  const ev = findEvent(db, inbox.event_id);
  if (!ev) throw new NotFoundError('event', inbox.event_id);
  const originId = `event-${ev.id}`;
  if (findCandidateByOrigin(db, 'WECHAT_EVENT', originId)) {
    throw new DuplicateError(`candidate for ${originId} already exists`);
  }
  return tx(db, () => {
    const { candidateId, approvalId } = insertCandidateWithApproval(db, {
      originType: 'WECHAT_EVENT', originId,
      title: title || `微信消息任务（事件 ${ev.id}）`,
      description: description || null,
      projectId: projectId || null,
      sourceEventId: ev.id,
      reason: 'created from inbox event',
      creator,
      ttlMs,
    });
    applyTransition(db, {
      table: 'inbox_items', entityType: 'inbox', id: inboxId, from: inbox.state, to: 'CONVERTED',
      transitions: INBOX_TRANSITIONS, version: inbox.version, actor: creator, reason: 'converted to task candidate',
    });
    return { candidateId, approvalId };
  });
}

function createCandidateFromUserCommand(db, { commandId, creator, ttlMs }) {
  const originId = `cmd-${commandId}`;
  const existing = findCandidateByOrigin(db, 'USER_COMMAND', originId);
  if (existing) return { candidateId: existing.id, created: false };
  const cmd = findUserCommand(db, commandId);
  if (!cmd) throw new NotFoundError('command', commandId);
  return tx(db, () => {
    const { candidateId, approvalId } = insertCandidateWithApproval(db, {
      originType: 'USER_COMMAND', originId,
      title: cmd.text.length > 80 ? cmd.text.slice(0, 80) + '…' : cmd.text,
      description: cmd.text,
      projectId: cmd.project_id || null,
      reason: 'created from user command',
      creator,
      ttlMs,
    });
    markConverted(db, commandId, candidateId);
    return { candidateId, approvalId, created: true };
  });
}

function rejectCandidate(db, { candidateId, actor: decider, reason }) {
  const c = findCandidate(db, candidateId);
  if (!c) throw new NotFoundError('candidate', candidateId);
  if (c.state !== 'OPEN') throw new InvalidTransitionError('candidate', c.state, 'REJECTED');
  const approval = findPendingApprovalForCandidate(db, candidateId);
  if (!approval) throw new BadRequestError('no pending approval for candidate');
  return tx(db, () => {
    applyTransition(db, {
      table: 'approvals', entityType: 'approval', id: approval.id, from: 'PENDING', to: 'REJECTED',
      transitions: APPROVAL_TRANSITIONS, version: approval.version, actor: decider,
      reason: reason || 'rejected by user',
      set: [['decision = ?', 'reject'], ['decided_at = ?', new Date().toISOString()]],
    });
    applyTransition(db, {
      table: 'task_candidates', entityType: 'candidate', id: candidateId, from: 'OPEN', to: 'REJECTED',
      transitions: CANDIDATE_TRANSITIONS, version: c.version, actor: decider,
      reason: reason || 'rejected by user', set: [['decided_at = ?', new Date().toISOString()]],
    });
    appendDomainEvent(db, {
      eventType: 'TASK_CANDIDATE_REJECTED', entityType: 'candidate', entityId: candidateId, actor: decider,
      payload: { reason: reason || null },
    });
  });
}

function approveCandidate(db, {
  candidateId, actor: decider, title, description, projectId, capabilities, scenario,
  worker = 'fake-worker', timeoutMs, workspace, cfg,
}) {
  const c = findCandidate(db, candidateId);
  if (!c) throw new NotFoundError('candidate', candidateId);
  if (c.state !== 'OPEN') throw new InvalidTransitionError('candidate', c.state, 'CONVERTED');
  const approval = findPendingApprovalForCandidate(db, candidateId);
  if (!approval) throw new BadRequestError('no pending approval for candidate');
  if (approval.expires_at && approval.expires_at < new Date().toISOString()) {
    throw new ApprovalExpiredError(approval.id, approval.expires_at);
  }
  if (!SCENARIOS.includes(scenario)) throw new BadRequestError(`unknown scenario ${scenario}`);
  if (!['fake-worker', 'opencode', 'codex'].includes(worker)) throw new BadRequestError(`unknown worker ${worker}`);
  const caps = Object.assign({}, DEFAULT_CAPABILITIES, capabilities || {});
  const cmdRow = db.prepare('SELECT conversation_id FROM user_commands WHERE candidate_id = ? LIMIT 1').get(candidateId);
  const conversationId = cmdRow ? cmdRow.conversation_id : null;

  return tx(db, () => {
    applyTransition(db, {
      table: 'approvals', entityType: 'approval', id: approval.id, from: 'PENDING', to: 'APPROVED',
      transitions: APPROVAL_TRANSITIONS, version: approval.version, actor: decider, reason: 'task approved',
      set: [['decision = ?', 'approve'], ['decided_at = ?', new Date().toISOString()]],
    });
    applyTransition(db, {
      table: 'task_candidates', entityType: 'candidate', id: candidateId, from: 'OPEN', to: 'CONVERTED',
      transitions: CANDIDATE_TRANSITIONS, version: c.version, actor: decider, reason: 'approved',
      set: [['decided_at = ?', new Date().toISOString()]],
    });
    const taskId = insertTask(db, {
      candidateId, title: title || c.title, description: description || c.description,
      projectId: projectId || c.project_id, conversationId,
    });
    appendTransition(db, {
      entityType: 'task', entityId: taskId, fromState: null, toState: 'OPEN', actor: decider, reason: 'task created',
    });
    const taskRow = findTask(db, taskId);
    const grantId = insertGrant(db, {
      taskId, taskVersion: taskRow.version, worker,
      workspace: workspace || null, capabilities: caps,
      issuedByType: decider.actorType, issuedById: decider.actorId,
    });
    appendDomainEvent(db, {
      eventType: 'GRANT_ISSUED', entityType: 'grant', entityId: grantId, actor: decider,
      payload: { taskId, worker, capabilities: caps },
    });
    const dspId = dispatchId();
    const timeout = timeoutMs || cfg.executionTimeoutMs;
    const deadlineAt = new Date(Date.now() + timeout).toISOString();
    appendOutbox(db, {
      eventType: 'WORKER_DISPATCH_REQUESTED', entityType: 'task', entityId: taskId,
      payload: {
        taskId, grantId, dispatchId: dspId, worker, scenario, timeoutMs: timeout, deadlineAt,
      },
      maxAttempts: cfg.outboxMaxAttempts,
    });
    appendDomainEvent(db, {
      eventType: 'TASK_CANDIDATE_APPROVED', entityType: 'candidate', entityId: candidateId, actor: decider,
      payload: { taskId, grantId, dispatchId: dspId },
    });
    const conv = conversationId ? findConversation(db, conversationId) : findOrCreateGlobalConversation(db);
    insertMessage(db, {
      conversationId: conv.id, role: 'SYSTEM', kind: 'STATUS',
      content: `任务 #${taskId} 已批准，已派发 FakeWorker 执行（场景 ${scenario}）`,
      refType: 'task', refId: taskId, actorType: decider.actorType, actorId: decider.actorId,
    });
    return { taskId, grantId, dispatchId: dspId };
  });
}

module.exports = {
  insertCandidateWithApproval,
  createCandidateFromInbox,
  createCandidateFromUserCommand,
  rejectCandidate,
  approveCandidate,
};
