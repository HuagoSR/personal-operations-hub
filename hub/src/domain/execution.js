'use strict';

function insertExecution(db, e) {
  const res = db.prepare(`INSERT INTO executions
    (task_id, grant_id, worker, scenario, execution_dispatch_id, state, timeout_ms, deadline_at, resume_from_execution, conversation_id)
    VALUES (?, ?, ?, ?, ?, 'QUEUED', ?, ?, ?, ?)`)
    .run(e.taskId, e.grantId || null, e.worker, e.scenario, e.executionDispatchId,
      e.timeoutMs || null, e.deadlineAt || null, e.resumeFromExecution || null, e.conversationId || null);
  return Number(res.lastInsertRowid);
}

function findExecution(db, id) {
  return db.prepare('SELECT * FROM executions WHERE id = ?').get(id) || null;
}

function findExecutionByDispatchId(db, dispatchId) {
  return db.prepare('SELECT * FROM executions WHERE execution_dispatch_id = ?').get(dispatchId) || null;
}

function listExecutions(db, { state, taskId, limit = 200 } = {}) {
  const conds = [];
  const args = [];
  if (state) { conds.push('state = ?'); args.push(state); }
  if (taskId) { conds.push('task_id = ?'); args.push(taskId); }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  args.push(limit);
  return db.prepare(`SELECT * FROM executions ${where} ORDER BY id DESC LIMIT ?`).all(...args);
}

function listRunnableExecutions(db, nowIso) {
  return db.prepare(`SELECT * FROM executions
    WHERE state IN ('QUEUED', 'RUNNING', 'WAITING_FOR_USER', 'WAITING_FOR_APPROVAL')
      AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
    ORDER BY id`).all(nowIso);
}

function listTimedOutExecutions(db, nowIso) {
  return db.prepare(`SELECT * FROM executions
    WHERE state = 'RUNNING' AND deadline_at IS NOT NULL AND deadline_at < ?`)
    .all(nowIso);
}

module.exports = { insertExecution, findExecution, findExecutionByDispatchId, listExecutions, listRunnableExecutions, listTimedOutExecutions };
