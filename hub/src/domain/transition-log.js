'use strict';

function listByEntity(db, entityType, entityId, limit = 500) {
  return db.prepare(`SELECT * FROM transition_log WHERE entity_type = ? AND entity_id = ?
    ORDER BY id LIMIT ?`).all(entityType, entityId, limit);
}

function listAll(db, limit = 500) {
  return db.prepare('SELECT * FROM transition_log ORDER BY id DESC LIMIT ?').all(limit);
}

module.exports = { listByEntity, listAll };
