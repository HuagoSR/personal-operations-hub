'use strict';

function insertInboxItem(db, { eventId }) {
  const res = db.prepare('INSERT OR IGNORE INTO inbox_items (event_id) VALUES (?)').run(eventId);
  if (res.changes === 0) return null;
  return Number(res.lastInsertRowid);
}

function findInboxItem(db, id) {
  return db.prepare('SELECT * FROM inbox_items WHERE id = ?').get(id) || null;
}

function findInboxItemByEvent(db, eventId) {
  return db.prepare('SELECT * FROM inbox_items WHERE event_id = ?').get(eventId) || null;
}

function listInboxItems(db, { state, limit = 200 } = {}) {
  if (state) {
    return db.prepare(`SELECT i.*, e.event_type, e.priority_hint, e.source FROM inbox_items i
      JOIN events e ON e.id = i.event_id
      WHERE i.state = ? ORDER BY i.id DESC LIMIT ?`).all(state, limit);
  }
  return db.prepare(`SELECT i.*, e.event_type, e.priority_hint, e.source FROM inbox_items i
    JOIN events e ON e.id = i.event_id
    ORDER BY i.id DESC LIMIT ?`).all(limit);
}

module.exports = { insertInboxItem, findInboxItem, findInboxItemByEvent, listInboxItems };
