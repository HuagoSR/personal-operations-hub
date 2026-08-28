'use strict';

function insertRawMessage(db, rec) {
  db.prepare(`INSERT OR IGNORE INTO raw_messages
    (idempotency_key, source, gateway_id, source_message_id, sequence, chat_id, chat_type,
     chat_name, sender_id, sender_name, message_type, text, is_mentioned, reply_json,
     wechat_timestamp, collected_at, raw_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(
      rec.idempotencyKey,
      rec.source,
      rec.gatewayId || null,
      rec.sourceMessageId || null,
      rec.sequence === undefined ? null : rec.sequence,
      rec.chatId || null,
      rec.chatType || null,
      rec.chatName || null,
      rec.senderId || null,
      rec.senderName || null,
      rec.messageType || null,
      rec.text || '',
      rec.isMentioned ? 1 : 0,
      rec.reply ? JSON.stringify(rec.reply) : null,
      rec.wechatTimestamp || null,
      rec.collectedAt || null,
      JSON.stringify(rec.raw || rec)
    );
  return db.prepare('SELECT id FROM raw_messages WHERE idempotency_key = ?').get(rec.idempotencyKey).id;
}

function findRawMessageByKey(db, key) {
  return db.prepare('SELECT * FROM raw_messages WHERE idempotency_key = ?').get(key) || null;
}

function findRawMessage(db, id) {
  return db.prepare('SELECT * FROM raw_messages WHERE id = ?').get(id) || null;
}

function listRawMessages(db, limit = 100) {
  return db.prepare('SELECT * FROM raw_messages ORDER BY id DESC LIMIT ?').all(limit);
}

module.exports = { insertRawMessage, findRawMessageByKey, findRawMessage, listRawMessages };
