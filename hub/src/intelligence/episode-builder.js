'use strict';
const { tx } = require('../services/tx');
const {
  insertEpisode, findOpenEpisodeForChat, findEpisode,
  appendMessage, messagesOfEpisode, closeEpisode,
} = require('../domain/intelligence-episode');

// Deterministic episode builder: same chat + idle window + max messages.
// Messages are appended in ingest order; the caller passes atIso (collected_at).

function episodeForMessageInTx(db, { chatId, chatType, rawMessageId, atIso, idleMs, maxMessages }) {
  let episode = findOpenEpisodeForChat(db, chatId);
  let closedEpisodeId = null;
  if (episode) {
    const lastAt = episode.window_end || episode.window_start;
    const idle = Date.parse(atIso) - Date.parse(lastAt);
    if (idle > idleMs || episode.message_count >= maxMessages) {
      closeEpisode(db, episode.id, atIso);
      closedEpisodeId = episode.id;
      episode = null;
    }
  }
  if (!episode) {
    const id = insertEpisode(db, { chatId, chatType, windowStart: atIso });
    episode = findEpisode(db, id);
  }
  const seq = episode.message_count + 1;
  appendMessage(db, { episodeId: episode.id, rawMessageId, seq, atIso });
  return { episode: findEpisode(db, episode.id), closedEpisodeId };
}

// Standalone wrapper (own transaction) for callers outside an existing tx.
function episodeForMessage(db, args) {
  return tx(db, () => episodeForMessageInTx(db, args).episode);
}

module.exports = { episodeForMessage, episodeForMessageInTx };
