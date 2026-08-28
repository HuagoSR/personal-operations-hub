'use strict';
const path = require('path');
const { openDatabase, migrate } = require('../src/db');
const { load, resolveDbPath } = require('../src/config');

const ROOT = path.join(__dirname, '..');
const cfg = load(process.env.HUB_CONFIG || path.join(ROOT, 'config', 'config.json'));
const db = openDatabase(resolveDbPath(cfg, ROOT));
migrate(db, path.join(ROOT, 'src', 'migrations'));

const counts = {};
for (const t of ['raw_messages', 'events', 'inbox_items', 'task_candidates', 'approvals', 'tasks',
  'execution_grants', 'executions', 'results', 'transition_log', 'domain_events', 'outbox_events']) {
  counts[t] = db.prepare(`SELECT COUNT(*) AS c FROM ${t}`).get().c;
}
const byState = (table) => {
  const out = {};
  for (const row of db.prepare(`SELECT state, COUNT(*) AS c FROM ${table} GROUP BY state`).all()) {
    out[row.state] = row.c;
  }
  return out;
};
const ingest = db.prepare('SELECT * FROM ingest_state').all();
const sample = {
  at: new Date().toISOString(),
  counts,
  tasksByState: byState('tasks'),
  executionsByState: byState('executions'),
  candidatesByState: byState('task_candidates'),
  approvalsByState: byState('approvals'),
  outboxByState: byState('outbox_events'),
  inboxByState: byState('inbox_items'),
  ingestState: ingest,
};
process.stdout.write(JSON.stringify(sample) + '\n');
db.close();
