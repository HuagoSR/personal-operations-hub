'use strict';

function insertConversation(db, c) {
  const res = db.prepare('INSERT INTO conversations (project_id, title, kind) VALUES (?, ?, ?)')
    .run(c.projectId || null, c.title || null, c.kind || 'PROJECT');
  return Number(res.lastInsertRowid);
}

function findConversation(db, id) {
  return db.prepare('SELECT * FROM conversations WHERE id = ?').get(id) || null;
}

function listConversations(db, { projectId, kind, limit = 100 } = {}) {
  const conds = [];
  const args = [];
  if (projectId !== undefined) { conds.push('project_id = ?'); args.push(projectId); }
  if (kind) { conds.push('kind = ?'); args.push(kind); }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  args.push(limit);
  return db.prepare(`SELECT * FROM conversations ${where} ORDER BY id LIMIT ?`).all(...args);
}

function findOrCreateGlobalConversation(db) {
  const existing = db.prepare("SELECT * FROM conversations WHERE kind = 'GLOBAL_HUB' LIMIT 1").get();
  if (existing) return existing;
  const id = insertConversation(db, { kind: 'GLOBAL_HUB', title: 'Global Hub' });
  return findConversation(db, id);
}

function insertMessage(db, m) {
  const res = db.prepare(`INSERT INTO conversation_messages
    (conversation_id, role, kind, content, ref_type, ref_id, actor_type, actor_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(m.conversationId, m.role, m.kind || 'TEXT', m.content,
      m.refType || null, m.refId === undefined ? null : m.refId, m.actorType, m.actorId);
  return Number(res.lastInsertRowid);
}

function listMessages(db, conversationId, { afterId = 0, limit = 500 } = {}) {
  return db.prepare(`SELECT * FROM conversation_messages
    WHERE conversation_id = ? AND id > ? ORDER BY id LIMIT ?`)
    .all(conversationId, afterId, limit);
}

function findMessage(db, id) {
  return db.prepare('SELECT * FROM conversation_messages WHERE id = ?').get(id) || null;
}

module.exports = { insertConversation, findConversation, listConversations, findOrCreateGlobalConversation, insertMessage, listMessages, findMessage };
