'use strict';

function insertEpisode(db, e) {
  const res = db.prepare(`INSERT INTO message_episodes (chat_id, chat_type, status, window_start, window_end, message_count)
    VALUES (?, ?, 'OPEN', ?, ?, 0)`)
    .run(e.chatId, e.chatType || null, e.windowStart, e.windowStart);
  return Number(res.lastInsertRowid);
}

function findOpenEpisodeForChat(db, chatId) {
  return db.prepare("SELECT * FROM message_episodes WHERE chat_id = ? AND status = 'OPEN' ORDER BY id DESC LIMIT 1").get(chatId) || null;
}

function findEpisode(db, id) {
  return db.prepare('SELECT * FROM message_episodes WHERE id = ?').get(id) || null;
}

function appendMessage(db, { episodeId, rawMessageId, seq, atIso }) {
  db.prepare('INSERT OR IGNORE INTO episode_messages (episode_id, raw_message_id, seq) VALUES (?, ?, ?)')
    .run(episodeId, rawMessageId, seq);
  db.prepare('UPDATE message_episodes SET message_count = message_count + 1, window_end = ? WHERE id = ? AND status = ?')
    .run(atIso, episodeId, 'OPEN');
}

function messagesOfEpisode(db, episodeId) {
  return db.prepare(`SELECT em.seq, rm.* FROM episode_messages em
    JOIN raw_messages rm ON rm.id = em.raw_message_id
    WHERE em.episode_id = ? ORDER BY em.seq`).all(episodeId);
}

function closeEpisode(db, episodeId, atIso) {
  db.prepare("UPDATE message_episodes SET status = 'CLOSED', closed_at = ?, window_end = COALESCE(window_end, ?) WHERE id = ? AND status = 'OPEN'")
    .run(atIso, atIso, episodeId);
}

function markEpisodeAnalyzed(db, episodeId) {
  db.prepare("UPDATE message_episodes SET status = 'ANALYZED' WHERE id = ? AND status = 'CLOSED'").run(episodeId);
}

module.exports = {
  insertEpisode, findOpenEpisodeForChat, findEpisode,
  appendMessage, messagesOfEpisode, closeEpisode, markEpisodeAnalyzed,
};
