'use strict';

function insertApproval(db, a) {
  const res = db.prepare(`INSERT INTO approvals
    (approval_type, candidate_id, state, expires_at, actor_type, actor_id)
    VALUES (?, ?, 'PENDING', ?, ?, ?)`)
    .run(a.approvalType, a.candidateId, a.expiresAt || null, a.actorType, a.actorId);
  return Number(res.lastInsertRowid);
}

function findApproval(db, id) {
  return db.prepare('SELECT * FROM approvals WHERE id = ?').get(id) || null;
}

function findPendingApprovalForCandidate(db, candidateId) {
  return db.prepare("SELECT * FROM approvals WHERE candidate_id = ? AND state = 'PENDING' ORDER BY id DESC LIMIT 1")
    .get(candidateId) || null;
}

function listApprovals(db, { state, limit = 200 } = {}) {
  if (state) {
    return db.prepare('SELECT * FROM approvals WHERE state = ? ORDER BY id DESC LIMIT ?').all(state, limit);
  }
  return db.prepare('SELECT * FROM approvals ORDER BY id DESC LIMIT ?').all(limit);
}

function listPendingExpiredApprovals(db, nowIso) {
  return db.prepare("SELECT * FROM approvals WHERE state = 'PENDING' AND expires_at IS NOT NULL AND expires_at < ?")
    .all(nowIso);
}

module.exports = { insertApproval, findApproval, findPendingApprovalForCandidate, listApprovals, listPendingExpiredApprovals };
