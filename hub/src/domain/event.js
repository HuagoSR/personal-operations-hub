'use strict';

function insertEvent(db, ev) {
  const res = db.prepare(`INSERT INTO events
    (event_type, priority_hint, source, project_id, actor_type, actor_id, metadata_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(ev.eventType, ev.priorityHint || 'normal', ev.source,
      ev.projectId || null, ev.actorType, ev.actorId,
      ev.metadata ? JSON.stringify(ev.metadata) : null);
  return Number(res.lastInsertRowid);
}

function linkRawMessage(db, eventId, rawMessageId) {
  db.prepare('INSERT OR IGNORE INTO event_raw_messages (event_id, raw_message_id) VALUES (?, ?)')
    .run(eventId, rawMessageId);
}

function findEvent(db, id) {
  return db.prepare('SELECT * FROM events WHERE id = ?').get(id) || null;
}

function listEvents(db, { projectId, limit = 100 } = {}) {
  if (projectId) {
    return db.prepare('SELECT * FROM events WHERE project_id = ? ORDER BY id DESC LIMIT ?').all(projectId, limit);
  }
  return db.prepare('SELECT * FROM events ORDER BY id DESC LIMIT ?').all(limit);
}

function rawMessagesOfEvent(db, eventId) {
  return db.prepare(`SELECT rm.* FROM raw_messages rm
    JOIN event_raw_messages erm ON erm.raw_message_id = rm.id
    WHERE erm.event_id = ? ORDER BY rm.id`).all(eventId);
}

module.exports = { insertEvent, linkRawMessage, findEvent, listEvents, rawMessagesOfEvent };
