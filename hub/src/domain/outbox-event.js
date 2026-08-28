'use strict';

function appendOutbox(db, e) {
  const res = db.prepare(`INSERT INTO outbox_events
    (event_type, entity_type, entity_id, payload_json, max_attempts)
    VALUES (?, ?, ?, ?, ?)`)
    .run(e.eventType, e.entityType || null, e.entityId === undefined ? null : e.entityId,
      JSON.stringify(e.payload), e.maxAttempts || 5);
  return Number(res.lastInsertRowid);
}

function findOutbox(db, id) {
  return db.prepare('SELECT * FROM outbox_events WHERE id = ?').get(id) || null;
}

function claimPending(db, nowIso, limit = 10) {
  const rows = db.prepare(`SELECT * FROM outbox_events
    WHERE state IN ('PENDING', 'FAILED')
      AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
    ORDER BY id LIMIT ?`).all(nowIso, limit);
  for (const row of rows) {
    db.prepare('UPDATE outbox_events SET attempts = attempts + 1 WHERE id = ?').run(row.id);
  }
  return rows;
}

function markDispatched(db, id, dispatchId) {
  db.prepare(`UPDATE outbox_events SET state = 'DISPATCHED', dispatch_id = ?, processed_at = ?,
    last_error = NULL, next_attempt_at = NULL WHERE id = ?`)
    .run(dispatchId, new Date().toISOString(), id);
}

function markFailed(db, id, error, nextAttemptAt) {
  db.prepare(`UPDATE outbox_events SET state = 'FAILED', last_error = ?, next_attempt_at = ? WHERE id = ?`)
    .run(error, nextAttemptAt, id);
}

function markDead(db, id, error) {
  db.prepare(`UPDATE outbox_events SET state = 'DEAD', last_error = ?, processed_at = ? WHERE id = ?`)
    .run(error, new Date().toISOString(), id);
}

function listOutbox(db, { state, limit = 200 } = {}) {
  if (state) {
    return db.prepare('SELECT * FROM outbox_events WHERE state = ? ORDER BY id DESC LIMIT ?').all(state, limit);
  }
  return db.prepare('SELECT * FROM outbox_events ORDER BY id DESC LIMIT ?').all(limit);
}

module.exports = { appendOutbox, findOutbox, claimPending, markDispatched, markFailed, markDead, listOutbox };
