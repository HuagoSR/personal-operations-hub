'use strict';
const fs = require('fs');
const path = require('path');
const { tx } = require('./tx');
const { appendDomainEvent, appendTransition } = require('./audit');
const { actor } = require('../domain/actors');
const { insertRawMessage, findRawMessageByKey } = require('../domain/raw-message');
const { insertEvent, linkRawMessage } = require('../domain/event');
const { insertInboxItem } = require('../domain/inbox-item');
const { getIngestState, upsertIngestState } = require('../domain/ingest-state');

function ingestRecord(db, rec, { inboxRule }) {
  const key = `${rec.gateway_id}:${rec.chat_id}:${rec.local_id}`;
  if (findRawMessageByKey(db, key)) return { key, duplicate: true };
  const rawId = insertRawMessage(db, {
    idempotencyKey: key,
    source: rec.source || 'wechat',
    gatewayId: rec.gateway_id || null,
    sourceMessageId: rec.message_id !== undefined ? String(rec.message_id) : null,
    sequence: rec.sequence,
    chatId: rec.chat_id || null,
    chatType: rec.chat_type || null,
    chatName: rec.chat_name || null,
    senderId: rec.sender_id || null,
    senderName: rec.sender_name || null,
    messageType: rec.message_type !== undefined ? String(rec.message_type) : null,
    text: rec.text || '',
    isMentioned: rec.is_mentioned === true,
    reply: rec.reply || null,
    wechatTimestamp: rec.wechat_timestamp || null,
    collectedAt: rec.collected_at || null,
    raw: rec,
  });
  const sourceActor = actor('WECHAT_SOURCE', rec.gateway_id || 'wechat-gateway');
  appendDomainEvent(db, {
    eventType: 'RAW_MESSAGE_INGESTED', entityType: 'raw_message', entityId: rawId, actor: sourceActor,
    payload: { source: rec.source, sequence: rec.sequence, mentioned: rec.is_mentioned === true },
  });
  appendTransition(db, {
    entityType: 'raw_message', entityId: rawId, fromState: null, toState: 'INGESTED',
    actor: sourceActor, reason: 'spool record ingested',
  });
  const hubActor = actor('HUB');
  const eventId = insertEvent(db, {
    eventType: 'wechat_message',
    priorityHint: rec.is_mentioned === true ? 'mentioned' : 'normal',
    source: rec.source || 'wechat',
    metadata: {
      chatId: rec.chat_id, chatType: rec.chat_type, messageType: rec.message_type,
      senderId: rec.sender_id, sequence: rec.sequence,
    },
    actorType: hubActor.actorType, actorId: hubActor.actorId,
  });
  linkRawMessage(db, eventId, rawId);
  appendDomainEvent(db, {
    eventType: 'EVENT_CREATED', entityType: 'event', entityId: eventId, actor: hubActor,
    payload: { eventType: 'wechat_message', priorityHint: rec.is_mentioned === true ? 'mentioned' : 'normal' },
  });
  let inboxId = null;
  const relevant = inboxRule === 'all'
    || (inboxRule === 'mentioned_or_direct' && (rec.is_mentioned === true || rec.chat_type === 'direct'));
  if (relevant) {
    inboxId = insertInboxItem(db, { eventId });
    if (inboxId) {
      appendDomainEvent(db, {
        eventType: 'INBOX_ITEM_CREATED', entityType: 'inbox', entityId: inboxId, actor: hubActor,
        payload: { eventId },
      });
    }
  }
  return { key, duplicate: false, rawId, eventId, inboxId };
}

function ingestOnce(db, { spoolDir, inboxRule, logger }) {
  if (!fs.existsSync(spoolDir)) return { files: 0, ingested: 0, duplicates: 0, errors: 0 };
  const files = fs.readdirSync(spoolDir).filter((f) => f.endsWith('.jsonl')).sort();
  let ingested = 0;
  let duplicates = 0;
  let errors = 0;
  const states = {};
  for (const row of db.prepare('SELECT * FROM ingest_state').all()) {
    states[row.gateway_id] = { lastSequence: row.last_sequence, lastFile: row.last_file };
  }
  for (const f of files) {
    const known = Object.values(states);
    if (known.length > 0 && known.every((s) => s.lastFile && f < s.lastFile)) continue;
    let content;
    try {
      content = fs.readFileSync(path.join(spoolDir, f), 'utf8');
    } catch (e) {
      errors++;
      if (logger) logger.warn(`spool read failed file=${f} err=${e.message}`);
      continue;
    }
    const lines = content.split('\n');
    let gid = null;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      let rec;
      try {
        rec = JSON.parse(line);
      } catch (e) {
        if (i === lines.length - 1) break;
        errors++;
        if (logger) logger.warn(`spool parse error file=${f} line=${i + 1}`);
        continue;
      }
      if (!rec || typeof rec.sequence !== 'number' || !rec.chat_id || !rec.gateway_id) {
        errors++;
        if (logger) logger.warn(`spool record missing fields file=${f} line=${i + 1}`);
        continue;
      }
      gid = rec.gateway_id;
      if (!states[gid]) {
        const s = getIngestState(db, gid);
        states[gid] = s ? { lastSequence: s.last_sequence, lastFile: s.last_file } : { lastSequence: 0, lastFile: null };
      }
      try {
        tx(db, () => {
          const r = ingestRecord(db, rec, { inboxRule });
          if (r.duplicate) duplicates++;
          else ingested++;
        });
      } catch (e) {
        errors++;
        if (logger) logger.warn(`ingest failed file=${f} seq=${rec.sequence} err=${e.message}`);
        continue;
      }
      if (rec.sequence > states[gid].lastSequence) states[gid].lastSequence = rec.sequence;
    }
    for (const g of Object.keys(states)) {
      upsertIngestState(db, { gatewayId: g, lastSequence: states[g].lastSequence, lastFile: f });
    }
  }
  return { files: files.length, ingested, duplicates, errors };
}

module.exports = { ingestOnce, ingestRecord };
