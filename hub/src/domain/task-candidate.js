'use strict';

function insertCandidate(db, c) {
  const res = db.prepare(`INSERT OR IGNORE INTO task_candidates
    (origin_type, origin_id, title, description, project_id, source_event_id, reason,
     state, actor_type, actor_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'OPEN', ?, ?)`)
    .run(c.originType, c.originId, c.title, c.description || null,
      c.projectId || null, c.sourceEventId || null, c.reason || null,
      c.actorType, c.actorId);
  if (res.changes === 0) return null;
  return Number(res.lastInsertRowid);
}

function findCandidate(db, id) {
  return db.prepare('SELECT * FROM task_candidates WHERE id = ?').get(id) || null;
}

function findCandidateByOrigin(db, originType, originId) {
  return db.prepare('SELECT * FROM task_candidates WHERE origin_type = ? AND origin_id = ?')
    .get(originType, originId) || null;
}

function listCandidates(db, { state, limit = 200 } = {}) {
  if (state) {
    return db.prepare('SELECT * FROM task_candidates WHERE state = ? ORDER BY id DESC LIMIT ?').all(state, limit);
  }
  return db.prepare('SELECT * FROM task_candidates ORDER BY id DESC LIMIT ?').all(limit);
}

module.exports = { insertCandidate, findCandidate, findCandidateByOrigin, listCandidates };
