'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const { makeDb, makeCtx, makeFixtureSpool, spoolRecord } = require('./helpers');
const { ingestOnce } = require('../src/services/ingest');
const { applyTransition } = require('../src/services/state-machine');
const { TASK_TRANSITIONS } = require('../src/domain/states');
const { insertTask, findTask } = require('../src/domain/task');
const { listRawMessages } = require('../src/domain/raw-message');
const { listEvents } = require('../src/domain/event');

test('invalid transition is rejected', () => {
  const { db } = makeDb();
  const id = insertTask(db, { title: 't' });
  assert.throws(() => applyTransition(db, {
    table: 'tasks', entityType: 'task', id, from: 'OPEN', to: 'COMPLETED',
    transitions: TASK_TRANSITIONS, version: 1, actor: { actorType: 'USER', actorId: 'owner' },
    reason: 'bad',
  }), /not allowed/);
  assert.equal(findTask(db, id).state, 'OPEN');
});

test('version conflict rejects stale update', () => {
  const { db } = makeDb();
  const id = insertTask(db, { title: 't' });
  applyTransition(db, {
    table: 'tasks', entityType: 'task', id, from: 'OPEN', to: 'EXECUTING',
    transitions: TASK_TRANSITIONS, version: 1, actor: { actorType: 'USER', actorId: 'owner' },
    reason: 'first',
  });
  assert.throws(() => applyTransition(db, {
    table: 'tasks', entityType: 'task', id, from: 'OPEN', to: 'EXECUTING',
    transitions: TASK_TRANSITIONS, version: 1, actor: { actorType: 'USER', actorId: 'owner' },
    reason: 'stale',
  }), /version mismatch/);
  assert.equal(findTask(db, id).state, 'EXECUTING');
});

test('transition log and domain events are append-only', () => {
  const { db } = makeDb();
  const id = insertTask(db, { title: 't' });
  applyTransition(db, {
    table: 'tasks', entityType: 'task', id, from: 'OPEN', to: 'EXECUTING',
    transitions: TASK_TRANSITIONS, version: 1, actor: { actorType: 'USER', actorId: 'owner' },
    reason: 'start',
  });
  const logId = db.prepare('SELECT id FROM transition_log LIMIT 1').get().id;
  assert.throws(() => db.prepare('UPDATE transition_log SET to_state = ? WHERE id = ?').run('X', logId), /append-only/);
  assert.throws(() => db.prepare('DELETE FROM transition_log WHERE id = ?').run(logId), /append-only/);
  const { appendDomainEvent } = require('../src/services/audit');
  appendDomainEvent(db, {
    eventType: 'TEST_EVENT', entityType: 'task', entityId: id,
    actor: { actorType: 'USER', actorId: 'owner' }, payload: { x: 1 },
  });
  const evId = db.prepare('SELECT id FROM domain_events LIMIT 1').get().id;
  assert.throws(() => db.prepare('DELETE FROM domain_events WHERE id = ?').run(evId), /append-only/);
  assert.throws(() => db.prepare('UPDATE domain_events SET payload_json = ? WHERE id = ?').run('{}', evId), /append-only/);
});

test('ingest tolerates partial trailing line and resumes incrementally', () => {
  const { db, dir } = makeDb();
  const ctx = makeCtx();
  const spoolDir = path.join(dir, 'spool');
  const f1 = makeFixtureSpool(spoolDir, [spoolRecord({ local_id: 1, sequence: 1, text: 'one' })]);
  ingestOnce(db, { spoolDir, inboxRule: 'all', logger: ctx.logger });
  assert.equal(listRawMessages(db).length, 1);
  const f2 = path.join(spoolDir, '2026-08-27.jsonl');
  fs.writeFileSync(f2,
    JSON.stringify(spoolRecord({ local_id: 2, sequence: 2, text: 'two', chat_type: 'direct' })) + '\n'
    + '{"schema_version":1,"source":"wechat","gateway_id":"test-gw-01","chat_id":"x",');
  const r = ingestOnce(db, { spoolDir, inboxRule: 'all', logger: ctx.logger });
  assert.equal(r.ingested, 1);
  assert.equal(listRawMessages(db).length, 2);
  assert.equal(listEvents(db).length, 2);
  fs.appendFileSync(f2, '"local_id":3,"sequence":3}\n');
  ingestOnce(db, { spoolDir, inboxRule: 'all', logger: ctx.logger });
  assert.equal(listRawMessages(db).length, 3);
});

test('gateway sequence reset is protected by idempotency key', () => {
  const { db, dir } = makeDb();
  const ctx = makeCtx();
  const spoolDir = path.join(dir, 'spool');
  makeFixtureSpool(spoolDir, [
    spoolRecord({ local_id: 1, sequence: 1, text: 'a' }),
    spoolRecord({ local_id: 2, sequence: 2, text: 'b' }),
  ]);
  ingestOnce(db, { spoolDir, inboxRule: 'all', logger: ctx.logger });
  const f2 = path.join(spoolDir, '2026-08-28.jsonl');
  fs.writeFileSync(f2,
    JSON.stringify(spoolRecord({ local_id: 1, sequence: 1, text: 'a-replay' })) + '\n'
    + JSON.stringify(spoolRecord({ local_id: 3, sequence: 2, text: 'c' })) + '\n');
  const r = ingestOnce(db, { spoolDir, inboxRule: 'all', logger: ctx.logger });
  assert.equal(r.ingested, 1);
  assert.equal(r.duplicates, 3);
  assert.equal(listRawMessages(db).length, 3);
  const keys = db.prepare('SELECT idempotency_key FROM raw_messages ORDER BY id').all().map((x) => x.idempotency_key);
  assert.deepEqual(keys, ['test-gw-01:testchat@chatroom:1', 'test-gw-01:testchat@chatroom:2', 'test-gw-01:testchat@chatroom:3']);
});
