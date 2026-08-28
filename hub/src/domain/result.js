'use strict';

function insertResult(db, r) {
  const res = db.prepare(`INSERT INTO results
    (execution_id, task_id, worker, summary, diff_json, tests_json, artifacts_json, evidence_json,
     actor_type, actor_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(r.executionId, r.taskId, r.worker, r.summary,
      r.diff ? JSON.stringify(r.diff) : null,
      r.tests ? JSON.stringify(r.tests) : null,
      r.artifacts ? JSON.stringify(r.artifacts) : null,
      r.evidence ? JSON.stringify(r.evidence) : null,
      r.actorType, r.actorId);
  return Number(res.lastInsertRowid);
}

function findResult(db, id) {
  return db.prepare('SELECT * FROM results WHERE id = ?').get(id) || null;
}

function findResultByExecution(db, executionId) {
  return db.prepare('SELECT * FROM results WHERE execution_id = ?').get(executionId) || null;
}

function listResults(db, { taskId, limit = 200 } = {}) {
  if (taskId) {
    return db.prepare('SELECT * FROM results WHERE task_id = ? ORDER BY id DESC LIMIT ?').all(taskId, limit);
  }
  return db.prepare('SELECT * FROM results ORDER BY id DESC LIMIT ?').all(limit);
}

module.exports = { insertResult, findResult, findResultByExecution, listResults };
