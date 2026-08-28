'use strict';

function appendTransition(db, { entityType, entityId, fromState, toState, actor, reason, metadata }) {
  db.prepare(`INSERT INTO transition_log
    (entity_type, entity_id, from_state, to_state, actor_type, actor_id, reason, metadata_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(entityType, entityId, fromState !== undefined ? fromState : null, toState,
      actor.actorType, actor.actorId, reason || null,
      metadata ? JSON.stringify(metadata) : null, new Date().toISOString());
}

function appendDomainEvent(db, { eventType, entityType, entityId, actor, payload }) {
  db.prepare(`INSERT INTO domain_events
    (event_type, entity_type, entity_id, actor_type, actor_id, payload_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(eventType, entityType || null, entityId === undefined ? null : entityId,
      actor.actorType, actor.actorId, payload ? JSON.stringify(payload) : null,
      new Date().toISOString());
}

module.exports = { appendTransition, appendDomainEvent };
