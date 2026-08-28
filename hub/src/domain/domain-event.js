'use strict';

function listByType(db, eventType, limit = 500) {
  return db.prepare('SELECT * FROM domain_events WHERE event_type = ? ORDER BY id DESC LIMIT ?')
    .all(eventType, limit);
}

function listAll(db, limit = 500) {
  return db.prepare('SELECT * FROM domain_events ORDER BY id DESC LIMIT ?').all(limit);
}

module.exports = { listByType, listAll };
