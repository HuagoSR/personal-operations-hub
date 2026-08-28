'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { openDatabase, migrate } = require('../src/db');
const { ingestOnce } = require('../src/services/ingest');
const { consumeOutboxOnce, pumpOnce } = require('../src/services/dispatcher');
const { sweepOnce } = require('../src/services/sweep');
const { createServer } = require('../src/api/server');
const { Logger } = require('../src/logger');

async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-smoke-'));
  const spoolDir = path.join(dir, 'spool');
  fs.mkdirSync(spoolDir, { recursive: true });
  fs.writeFileSync(path.join(spoolDir, '2026-08-26.jsonl'), [
    JSON.stringify({ schema_version: 1, source: 'wechat', gateway_id: 'smoke-gw', chat_type: 'group', chat_id: 'c1@chatroom', chat_name: 'smoke group', sender_id: 's1', sender_name: 'a', message_id: '1', local_id: 1, message_type: '1', text: 'hello', is_mentioned: true, reply: null, wechat_timestamp: '2026-08-26T09:00:00+00:00', collected_at: '2026-08-26T09:00:10.000Z', sequence: 1 }),
    JSON.stringify({ schema_version: 1, source: 'wechat', gateway_id: 'smoke-gw', chat_type: 'direct', chat_id: 's2', chat_name: 's2', sender_id: 's2', sender_name: 'b', message_id: '2', local_id: 2, message_type: '1', text: 'dm', is_mentioned: false, reply: null, wechat_timestamp: '2026-08-26T09:01:00+00:00', collected_at: '2026-08-26T09:01:10.000Z', sequence: 2 }),
  ].map(String).join('\n') + '\n');

  const db = openDatabase(path.join(dir, 'hub.db'));
  migrate(db, path.join(__dirname, '..', 'src', 'migrations'));
  const ctx = {
    logger: new Logger({ level: 'ERROR' }),
    clock: { iso: () => new Date().toISOString(), ms: () => Date.now() },
    cfg: {
      approvalDefaultTtlMs: 600000, executionTimeoutMs: 60000, outboxMaxAttempts: 3,
      outboxBackoffMs: [1, 2, 4], workerCrashRetryMs: 5, workerCrashMaxAttempts: 3,
    },
  };

  const r1 = ingestOnce(db, { spoolDir, inboxRule: 'mentioned_or_direct', logger: ctx.logger });
  console.log('ingest:', JSON.stringify(r1));
  const inboxCount = db.prepare('SELECT COUNT(*) AS c FROM inbox_items').get().c;
  console.log('inbox items (expect 2: mentioned + direct):', inboxCount);

  const server = createServer(db, ctx, ctx.cfg);
  await new Promise((res) => server.listen(0, '127.0.0.1', res));
  const base = `http://127.0.0.1:${server.address().port}`;

  let r = await (await fetch(base + '/api/dashboard')).json();
  console.log('dashboard inbox:', r.inbox);

  r = await (await fetch(base + '/api/user-commands', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: 'smoke task' }),
  })).json();
  const candidateId = r.candidateId;

  r = await (await fetch(base + `/api/candidates/${candidateId}/approve`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scenario: 'WAIT_FOR_USER', grant: { network: 'allow' } }),
  })).json();
  console.log('approved:', JSON.stringify(r));

  const until = async (pred, ms = 5000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      consumeOutboxOnce(db, ctx);
      pumpOnce(db, ctx);
      sweepOnce(db, ctx);
      if (pred()) return true;
      await new Promise((res) => setTimeout(res, 10));
    }
    return pred();
  };

  await until(() => {
    const ex = db.prepare('SELECT * FROM executions').get();
    return ex && ex.state === 'WAITING_FOR_USER';
  });
  const ex = db.prepare('SELECT * FROM executions').get();
  console.log('execution state (expect WAITING_FOR_USER):', ex.state);

  const q = db.prepare("SELECT * FROM execution_questions WHERE state = 'OPEN'").get();
  const ans = await fetch(base + `/api/executions/${ex.id}/questions/${q.id}/answer`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ answer: '继续' }),
  });
  console.log('answer status:', ans.status);

  await until(() => {
    const e2 = db.prepare('SELECT * FROM executions WHERE id = ?').get(ex.id);
    return e2.state === 'RESULT_AVAILABLE';
  });
  const results = await (await fetch(base + '/api/results')).json();
  console.log('results:', results.length);
  const rev = await fetch(base + `/api/results/${results[0].id}/review`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'complete' }),
  });
  console.log('review status:', rev.status);
  const task = db.prepare('SELECT * FROM tasks').get();
  console.log('task state (expect COMPLETED):', task.state);

  const trans = db.prepare('SELECT COUNT(*) AS c FROM transition_log').get().c;
  const events = db.prepare('SELECT COUNT(*) AS c FROM domain_events').get().c;
  console.log('transition_log rows:', trans, 'domain_events:', events);
  console.log('SMOKE OK');
  server.close();
  db.close();
}

main().catch((e) => { console.error('SMOKE FAILED', e); process.exit(1); });
