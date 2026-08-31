'use strict';

function insertTask(db, t) {
  const res = db.prepare(`INSERT INTO tasks
    (candidate_id, title, description, project_id, conversation_id)
    VALUES (?, ?, ?, ?, ?)`)
    .run(t.candidateId || null, t.title, t.description || null, t.projectId || null, t.conversationId || null);
  return Number(res.lastInsertRowid);
}

function findTask(db, id) {
  return db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) || null;
}

function listTasks(db, { state, projectId, limit = 200 } = {}) {
  const conds = [];
  const args = [];
  if (state) { conds.push('state = ?'); args.push(state); }
  if (projectId) { conds.push('project_id = ?'); args.push(projectId); }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  args.push(limit);
  return db.prepare(`SELECT * FROM tasks ${where} ORDER BY id DESC LIMIT ?`).all(...args);
}

function executionsOfTask(db, taskId) {
  return db.prepare('SELECT * FROM executions WHERE task_id = ? ORDER BY id').all(taskId);
}

function resultsOfTask(db, taskId) {
  return db.prepare('SELECT * FROM results WHERE task_id = ? ORDER BY id').all(taskId);
}

module.exports = { insertTask, findTask, listTasks, executionsOfTask, resultsOfTask };
