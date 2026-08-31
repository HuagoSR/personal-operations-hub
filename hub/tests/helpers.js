'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { openDatabase, migrate } = require('../src/db');
const { DEFAULTS } = require('../src/config');
const { Logger } = require('../src/logger');

function makeDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-t-'));
  const db = openDatabase(path.join(dir, 'hub.db'));
  migrate(db, path.join(__dirname, '..', 'src', 'migrations'));
  return { db, dir };
}

function makeCtx(overrides = {}) {
  const cfg = Object.assign({}, DEFAULTS, {
    workerStepDelayMs: 0,
    workerCrashRetryMs: 5,
    workerCrashMaxAttempts: 3,
    executionTimeoutMs: 600000,
    outboxBackoffMs: [1, 2, 4],
    outboxMaxAttempts: 3,
    approvalDefaultTtlMs: 600000,
  }, overrides.cfg || {});
  const logger = new Logger({ level: 'ERROR' });
  return {
    cfg,
    logger,
    clock: overrides.clock || {
      iso: () => new Date().toISOString(),
      ms: () => Date.now(),
    },
  };
}

function makeFixtureSpool(dir, records) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, '2026-08-26.jsonl');
  fs.writeFileSync(file, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return file;
}

function spoolRecord(overrides = {}) {
  return Object.assign({
    schema_version: 1,
    source: 'wechat',
    gateway_id: 'test-gw-01',
    chat_type: 'group',
    chat_id: 'testchat@chatroom',
    chat_name: 'test group',
    sender_id: 'wxid_test',
    sender_name: 'tester',
    message_id: '1',
    local_id: 1,
    message_type: '1',
    text: 'hello',
    is_mentioned: false,
    reply: null,
    wechat_timestamp: '2026-08-26T09:00:00+00:00',
    collected_at: '2026-08-26T09:00:10.000Z',
    sequence: 1,
  }, overrides);
}

async function pumpUntil(db, ctx, predicate, timeoutMs = 5000) {
  const { consumeOutboxOnce, pumpOnce } = require('../src/services/dispatcher');
  const { sweepOnce } = require('../src/services/sweep');
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    consumeOutboxOnce(db, ctx);
    await pumpOnce(db, ctx);
    sweepOnce(db, ctx);
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, 5));
  }
  return predicate();
}

function seedCandidateViaCommand(db, ctx, { text = 'test task', ttlMs, projectId } = {}) {
  const { createUserCommand } = require('../src/services/user-command-service');
  return createUserCommand(db, {
    text, projectId: projectId || null,
    actor: { actorType: 'USER', actorId: 'owner' },
    ttlMs: ttlMs === undefined ? ctx.cfg.approvalDefaultTtlMs : ttlMs,
  });
}

const USER_ACTOR = { actorType: 'USER', actorId: 'owner' };

module.exports = { makeDb, makeCtx, makeFixtureSpool, spoolRecord, pumpUntil, seedCandidateViaCommand, USER_ACTOR };
