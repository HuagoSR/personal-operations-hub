'use strict';

function insertPermissionRequest(db, { executionId, capability, grantValue, highRisk }) {
  const res = db.prepare(`INSERT INTO permission_requests
    (execution_id, capability, grant_value, high_risk)
    VALUES (?, ?, ?, ?)`)
    .run(executionId, capability, grantValue || null, highRisk ? 1 : 0);
  return Number(res.lastInsertRowid);
}

function findPermissionRequest(db, id) {
  return db.prepare('SELECT * FROM permission_requests WHERE id = ?').get(id) || null;
}

function findOpenPermissionRequest(db, executionId) {
  return db.prepare("SELECT * FROM permission_requests WHERE execution_id = ? AND state = 'OPEN' ORDER BY id DESC LIMIT 1")
    .get(executionId) || null;
}

function findLatestPermissionRequest(db, executionId) {
  return db.prepare('SELECT * FROM permission_requests WHERE execution_id = ? ORDER BY id DESC LIMIT 1')
    .get(executionId) || null;
}

function listPermissionRequests(db, executionId) {
  return db.prepare('SELECT * FROM permission_requests WHERE execution_id = ? ORDER BY id').all(executionId);
}

function decide(db, id, { decision, state, decidedByType, decidedById }) {
  db.prepare(`UPDATE permission_requests SET state = ?, decision = ?, decided_by_type = ?, decided_by_id = ?, decided_at = ?
    WHERE id = ? AND state = 'OPEN'`)
    .run(state, decision, decidedByType, decidedById, new Date().toISOString(), id);
}

module.exports = { insertPermissionRequest, findPermissionRequest, findOpenPermissionRequest, findLatestPermissionRequest, listPermissionRequests, decide };
