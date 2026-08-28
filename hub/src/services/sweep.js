'use strict';
const { tx } = require('./tx');
const { applyTransition } = require('./state-machine');
const { appendDomainEvent } = require('./audit');
const { ACTORS } = require('../domain/actors');
const { APPROVAL_TRANSITIONS, CANDIDATE_TRANSITIONS } = require('../domain/states');
const { listPendingExpiredApprovals } = require('../domain/approval');
const { findCandidate } = require('../domain/task-candidate');
const { listTimedOutExecutions } = require('../domain/execution');
const { failExecution } = require('./execution-service');

const SYSTEM_ACTOR = { actorType: ACTORS.SYSTEM, actorId: 'system' };

function expireApprovals(db, ctx) {
  const rows = listPendingExpiredApprovals(db, ctx.clock.iso());
  let count = 0;
  for (const a of rows) {
    try {
      tx(db, () => {
        applyTransition(db, {
          table: 'approvals', entityType: 'approval', id: a.id, from: 'PENDING', to: 'EXPIRED',
          transitions: APPROVAL_TRANSITIONS, version: a.version, actor: SYSTEM_ACTOR,
          reason: 'approval ttl expired',
        });
        const c = findCandidate(db, a.candidate_id);
        if (c && c.state === 'OPEN') {
          applyTransition(db, {
            table: 'task_candidates', entityType: 'candidate', id: c.id, from: 'OPEN', to: 'EXPIRED',
            transitions: CANDIDATE_TRANSITIONS, version: c.version, actor: SYSTEM_ACTOR,
            reason: 'approval ttl expired',
          });
        }
        appendDomainEvent(db, {
          eventType: 'APPROVAL_EXPIRED', entityType: 'approval', entityId: a.id, actor: SYSTEM_ACTOR,
          payload: { candidateId: a.candidate_id },
        });
        count++;
      });
    } catch (e) {
      if (ctx.logger) ctx.logger.warn(`sweep approval=${a.id} err=${e.message}`);
    }
  }
  return count;
}

function expireTimeouts(db, ctx) {
  const rows = listTimedOutExecutions(db, ctx.clock.iso());
  let count = 0;
  for (const ex of rows) {
    try {
      failExecution(db, ex, { error: 'execution timed out', actor: SYSTEM_ACTOR });
      count++;
    } catch (e) {
      if (ctx.logger) ctx.logger.warn(`sweep timeout execution=${ex.id} err=${e.message}`);
    }
  }
  return count;
}

function sweepOnce(db, ctx) {
  const approvals = expireApprovals(db, ctx);
  const timeouts = expireTimeouts(db, ctx);
  return { approvals, timeouts };
}

module.exports = { sweepOnce };
