'use strict';

function getIngestState(db, gatewayId) {
  return db.prepare('SELECT * FROM ingest_state WHERE gateway_id = ?').get(gatewayId) || null;
}

function upsertIngestState(db, { gatewayId, lastSequence, lastFile }) {
  db.prepare(`INSERT INTO ingest_state (gateway_id, last_sequence, last_file, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(gateway_id) DO UPDATE SET
      last_sequence = excluded.last_sequence,
      last_file = excluded.last_file,
      updated_at = excluded.updated_at`)
    .run(gatewayId, lastSequence, lastFile, new Date().toISOString());
}

module.exports = { getIngestState, upsertIngestState };
