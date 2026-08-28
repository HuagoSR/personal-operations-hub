'use strict';

function insertQuestion(db, { executionId, question }) {
  const res = db.prepare('INSERT INTO execution_questions (execution_id, question) VALUES (?, ?)')
    .run(executionId, question);
  return Number(res.lastInsertRowid);
}

function findQuestion(db, id) {
  return db.prepare('SELECT * FROM execution_questions WHERE id = ?').get(id) || null;
}

function findOpenQuestion(db, executionId) {
  return db.prepare("SELECT * FROM execution_questions WHERE execution_id = ? AND state = 'OPEN' ORDER BY id DESC LIMIT 1")
    .get(executionId) || null;
}

function findLatestQuestion(db, executionId) {
  return db.prepare('SELECT * FROM execution_questions WHERE execution_id = ? ORDER BY id DESC LIMIT 1')
    .get(executionId) || null;
}

function listQuestions(db, executionId) {
  return db.prepare('SELECT * FROM execution_questions WHERE execution_id = ? ORDER BY id').all(executionId);
}

function markAnswered(db, id, answer) {
  db.prepare(`UPDATE execution_questions SET state = 'ANSWERED', answer = ?, answered_at = ?
    WHERE id = ? AND state = 'OPEN'`)
    .run(answer, new Date().toISOString(), id);
}

module.exports = { insertQuestion, findQuestion, findOpenQuestion, findLatestQuestion, listQuestions, markAnswered };
