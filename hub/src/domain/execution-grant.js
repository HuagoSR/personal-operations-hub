'use strict';

function insertGrant(db, g) {
  const res = db.prepare(`INSERT INTO execution_grants
    (task_id, task_version, worker, workspace, capabilities_json, state,
     issued_by_type, issued_by_id)
    VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?, ?)`)
    .run(g.taskId, g.taskVersion, g.worker, g.workspace || null,
      JSON.stringify(g.capabilities), g.issuedByType, g.issuedById);
  return Number(res.lastInsertRowid);
}

function findGrant(db, id) {
  return db.prepare('SELECT * FROM execution_grants WHERE id = ?').get(id) || null;
}

function listGrants(db, { taskId, state, limit = 200 } = {}) {
  const conds = [];
  const args = [];
  if (taskId) { conds.push('task_id = ?'); args.push(taskId); }
  if (state) { conds.push('state = ?'); args.push(state); }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  args.push(limit);
  return db.prepare(`SELECT * FROM execution_grants ${where} ORDER BY id DESC LIMIT ?`).all(...args);
}

function findActiveGrantForTask(db, taskId) {
  return db.prepare("SELECT * FROM execution_grants WHERE task_id = ? AND state = 'ACTIVE' ORDER BY id DESC LIMIT 1")
    .get(taskId) || null;
}

module.exports = { insertGrant, findGrant, listGrants, findActiveGrantForTask };
