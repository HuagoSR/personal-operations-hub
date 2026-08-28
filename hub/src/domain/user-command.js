'use strict';

function insertUserCommand(db, c) {
  const res = db.prepare(`INSERT INTO user_commands
    (conversation_id, text, project_id, actor_type, actor_id)
    VALUES (?, ?, ?, ?, ?)`)
    .run(c.conversationId || null, c.text, c.projectId || null, c.actorType, c.actorId);
  return Number(res.lastInsertRowid);
}

function findUserCommand(db, id) {
  return db.prepare('SELECT * FROM user_commands WHERE id = ?').get(id) || null;
}

function listUserCommands(db, limit = 200) {
  return db.prepare('SELECT * FROM user_commands ORDER BY id DESC LIMIT ?').all(limit);
}

function markConverted(db, id, candidateId) {
  db.prepare("UPDATE user_commands SET state = 'CONVERTED', candidate_id = ? WHERE id = ? AND state = 'NEW'")
    .run(candidateId, id);
}

module.exports = { insertUserCommand, findUserCommand, listUserCommands, markConverted };
