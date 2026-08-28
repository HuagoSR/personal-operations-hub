'use strict';
const { tx } = require('./tx');
const { applyTransition } = require('./state-machine');
const { appendDomainEvent } = require('./audit');
const { GRANT_TRANSITIONS } = require('../domain/states');
const { NotFoundError } = require('../domain/errors');
const { findGrant } = require('../domain/execution-grant');

function revokeGrant(db, { grantId, actor, reason }) {
  const grant = findGrant(db, grantId);
  if (!grant) throw new NotFoundError('grant', grantId);
  if (grant.state !== 'ACTIVE') {
    return grant;
  }
  return tx(db, () => {
    applyTransition(db, {
      table: 'execution_grants', entityType: 'grant', id: grantId,
      from: 'ACTIVE', to: 'REVOKED',
      transitions: GRANT_TRANSITIONS, version: grant.version, actor,
      reason: reason || 'grant revoked',
      set: [
        ['revoked_at = ?', new Date().toISOString()],
        ['revoked_by_type = ?', actor.actorType],
        ['revoked_by_id = ?', actor.actorId],
        ['revoke_reason = ?', reason || null],
      ],
    });
    appendDomainEvent(db, {
      eventType: 'GRANT_REVOKED', entityType: 'grant', entityId: grantId, actor,
      payload: { reason: reason || null },
    });
    return findGrant(db, grantId);
  });
}

module.exports = { revokeGrant };
