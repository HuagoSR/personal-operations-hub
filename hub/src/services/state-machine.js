'use strict';
const { InvalidTransitionError, NotFoundError, VersionConflictError } = require('../domain/errors');
const { appendTransition } = require('./audit');

function applyTransition(db, opts) {
  const { table, entityType, id, from, to, transitions, version, actor, reason, metadata, set = [] } = opts;
  const allowed = transitions[from] || [];
  if (!allowed.includes(to)) throw new InvalidTransitionError(entityType, from, to);
  const sets = ['state = ?', 'version = version + 1', 'updated_at = ?'];
  const args = [to, new Date().toISOString()];
  for (const entry of set) {
    if (entry.length === 2) { sets.push(entry[0]); args.push(entry[1]); }
    else if (entry.length === 1) { sets.push(entry[0]); }
  }
  const res = db.prepare(`UPDATE ${table} SET ${sets.join(', ')} WHERE id = ? AND state = ? AND version = ?`)
    .run(...args, id, from, version);
  if (res.changes === 0) {
    const row = db.prepare(`SELECT state, version FROM ${table} WHERE id = ?`).get(id);
    if (!row) throw new NotFoundError(entityType, id);
    throw new VersionConflictError(entityType, id);
  }
  appendTransition(db, {
    entityType,
    entityId: id,
    fromState: from,
    toState: to,
    actor,
    reason,
    metadata,
  });
}

module.exports = { applyTransition };
