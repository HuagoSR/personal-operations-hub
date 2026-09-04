'use strict';
const crypto = require('crypto');
const { messagesOfEpisode } = require('../domain/intelligence-episode');

// DataEgressPolicy: B + C + D (D023).
// C = only inbox-relevant episodes reach analysis (enforced upstream at job creation).
// B = identities are replaced with stable pseudonyms per episode.
// D = sensitive chats never egress at all (config deny list).

function hash6(s) {
  return crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 6);
}

function egressAllowed(db, { chatId, denyEgressChats }) {
  const deny = denyEgressChats || [];
  if (deny.includes(chatId)) return false;
  return true;
}

// Builds the pseudonymized model input for an episode.
// Returns { chatId (never sent), label, chatType, mentioned, messages: [{i, minutes, sender, text, messageType}] }
function buildContext(db, { episode, messages, projects, relatedTasks, denyEgressChats }) {
  const msgs = messages || messagesOfEpisode(db, episode.id);
  const firstAt = Date.parse(episode.window_start);
  const senderMap = new Map();
  let senderSeq = 0;
  const items = [];
  let mentioned = false;
  for (const m of msgs) {
    if (!senderMap.has(m.sender_id)) senderMap.set(m.sender_id, `sender_${++senderSeq}`);
    if (m.is_mentioned) mentioned = true;
    const minutes = Math.max(0, Math.round((Date.parse(m.collected_at || episode.window_start) - firstAt) / 60000));
    items.push({
      i: items.length + 1,
      minutes,
      sender: senderMap.get(m.sender_id),
      text: String(m.text || '').slice(0, 2000),
    });
  }
  const chatLabel = episode.chat_id ? `chat_${hash6(episode.chat_id)}` : 'chat_unknown';
  return {
    chat_type: episode.chat_type || 'unknown',
    chat_label: chatLabel,
    mentioned,
    messages: items,
    projects: (projects || []).map((p) => ({ id: p.id, name: p.name, description: p.description })),
    related_tasks: (relatedTasks || []).slice(0, 5).map((t) => ({ id: t.id, title: t.title, state: t.state })),
    egress_mode: 'pseudonymized',
  };
}

module.exports = { egressAllowed, buildContext };
