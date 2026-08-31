'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { makeDb, makeCtx, pumpUntil, seedCandidateViaCommand, USER_ACTOR } = require('./helpers');
const { openDatabase, migrate } = require('../src/db');
const { ensureSystemEntities } = require('../src/services/bootstrap');
const { approveCandidate } = require('../src/services/candidate-service');
const { findTask } = require('../src/domain/task');
const { listExecutions } = require('../src/domain/execution');
const { findResultByExecution } = require('../src/domain/result');
const { insertConversation, findOrCreateGlobalConversation } = require('../src/domain/conversation');
const { listProjects } = require('../src/domain/project');
const { createServer } = require('../src/api/server');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'src', 'migrations');

function startApp(db, ctx) {
  const server = createServer(db, ctx, ctx.cfg);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` }));
  });
}

async function req(base, method, p, body) {
  const res = await fetch(base + p, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

test('6A bootstrap: Hub Project + General conversation + single Global Hub, idempotent', () => {
  const { db } = makeDb();
  const b1 = ensureSystemEntities(db);
  const b2 = ensureSystemEntities(db);
  assert.equal(b1.globalConversation.id, b2.globalConversation.id);
  assert.equal(b1.hubProject.id, b2.hubProject.id);
  assert.equal(b1.hubGeneralConversation.id, b2.hubGeneralConversation.id);
  assert.equal(b1.hubProject.project_type, 'SYSTEM_HUB');
  assert.equal(b1.hubProject.name, 'Hub');
  assert.equal(b1.hubGeneralConversation.is_default, 1);
  assert.equal(b1.hubGeneralConversation.project_id, b1.hubProject.id);
  const globals = db.prepare("SELECT * FROM conversations WHERE kind = 'GLOBAL_HUB'").all();
  assert.equal(globals.length, 1);
  assert.equal(listProjects(db).filter((p) => p.name === 'Hub').length, 1);
});

test('6A duplicate GLOBAL_HUB rejected by unique index', () => {
  const { db } = makeDb();
  findOrCreateGlobalConversation(db);
  assert.throws(() => insertConversation(db, { kind: 'GLOBAL_HUB', title: 'dupe' }));
});

test('6A migration 005 merges legacy duplicate GLOBAL_HUB conversations and backfills links', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-mig-'));
  const db = openDatabase(path.join(dir, 'hub.db'));
  db.exec('CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)');
  for (const f of ['001_init.sql', '002_worker_profiles.sql', '003_worker_permission_external.sql', '004_execution_resume.sql']) {
    db.exec(fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8'));
    db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)')
      .run(parseInt(f.split('_')[0], 10), f, new Date().toISOString());
  }
  const insertConv = (kind, title) => Number(db.prepare('INSERT INTO conversations (project_id, title, kind) VALUES (NULL, ?, ?)').run(title, kind).lastInsertRowid);
  const c1 = insertConv('GLOBAL_HUB', 'Global Hub');
  const c2 = insertConv('GLOBAL_HUB', null);
  const c3 = insertConv('GLOBAL_HUB', null);
  db.prepare(`INSERT INTO conversation_messages (conversation_id, role, kind, content, actor_type, actor_id)
    VALUES (?, 'USER', 'TEXT', 'in c2', 'USER', 'owner'), (?, 'USER', 'TEXT', 'in c3', 'USER', 'owner')`).run(c2, c3);
  const cmdId = Number(db.prepare(`INSERT INTO user_commands (conversation_id, text, project_id, actor_type, actor_id)
    VALUES (?, 'legacy cmd', NULL, 'USER', 'owner')`).run(c2).lastInsertRowid);
  const candId = Number(db.prepare(`INSERT INTO task_candidates (origin_type, origin_id, title, actor_type, actor_id)
    VALUES ('USER_COMMAND', ?, 'legacy task', 'USER', 'owner')`).run(`cmd-${cmdId}`).lastInsertRowid);
  db.prepare('UPDATE user_commands SET candidate_id = ? WHERE id = ?').run(candId, cmdId);
  const taskId = Number(db.prepare(`INSERT INTO tasks (candidate_id, title, description, project_id) VALUES (?, 'legacy task', NULL, NULL)`).run(candId).lastInsertRowid);
  const grantId = Number(db.prepare(`INSERT INTO execution_grants (task_id, task_version, worker, capabilities_json, issued_by_type, issued_by_id)
    VALUES (?, 1, 'fake-worker', '{}', 'USER', 'owner')`).run(taskId).lastInsertRowid);
  const execId = Number(db.prepare(`INSERT INTO executions (task_id, grant_id, worker, scenario, execution_dispatch_id)
    VALUES (?, ?, 'fake-worker', 'SUCCESS', 'legacy-dsp-1')`).run(taskId, grantId).lastInsertRowid);

  migrate(db, MIGRATIONS_DIR);

  const globals = db.prepare("SELECT * FROM conversations WHERE kind = 'GLOBAL_HUB'").all();
  assert.equal(globals.length, 1);
  assert.equal(globals[0].id, c1);
  assert.equal(db.prepare('SELECT COUNT(*) c FROM conversation_messages WHERE conversation_id = ?').get(c1).c, 2);
  assert.equal(db.prepare('SELECT conversation_id FROM user_commands WHERE id = ?').get(cmdId).conversation_id, c1);
  assert.equal(db.prepare('SELECT conversation_id FROM tasks WHERE id = ?').get(taskId).conversation_id, c1);
  assert.equal(db.prepare('SELECT conversation_id FROM executions WHERE id = ?').get(execId).conversation_id, c1);
});

test('6A approve binds task to command conversation; execution inherits; result gets facts_json', async () => {
  const { db } = makeDb();
  const ctx = makeCtx();
  const r = seedCandidateViaCommand(db, ctx, { text: 'bind conv task' });
  const globalConv = findOrCreateGlobalConversation(db);
  const res = approveCandidate(db, {
    candidateId: r.candidateId, actor: USER_ACTOR, scenario: 'SUCCESS', worker: 'fake-worker', cfg: ctx.cfg,
  });
  const task = findTask(db, res.taskId);
  assert.equal(task.conversation_id, globalConv.id);
  await pumpUntil(db, ctx, () => {
    const ex = listExecutions(db)[0];
    return ex && ex.state === 'RESULT_AVAILABLE';
  });
  const ex = listExecutions(db)[0];
  assert.equal(ex.conversation_id, globalConv.id);
  const result = findResultByExecution(db, ex.id);
  assert.ok(result, 'result exists');
  const facts = JSON.parse(result.facts_json);
  assert.equal(facts.testsRun.status, 'pass');
  assert.deepEqual(facts.diffStat, { files: 0, additions: 0, deletions: 0 });
  const timelineMsg = db.prepare('SELECT COUNT(*) c FROM conversation_messages WHERE conversation_id = ? AND kind = ?')
    .get(globalConv.id, 'RESULT_CARD').c;
  assert.ok(timelineMsg >= 1);
});

test('6A timeline API aggregates messages/tasks/executions/results; bootstrap status API works', async () => {
  const { db } = makeDb();
  const ctx = makeCtx();
  const app = await startApp(db, ctx);
  try {
    let r = await req(app.base, 'GET', '/api/bootstrap/status');
    assert.equal(r.status, 200);
    assert.ok(r.data.hubProject);
    assert.equal(r.data.hubProject.project_type, 'SYSTEM_HUB');
    const globalConvId = r.data.globalConversation.id;

    r = await req(app.base, 'POST', '/api/user-commands', { text: 'timeline task' });
    assert.equal(r.status, 201);
    r = await req(app.base, 'POST', `/api/candidates/${r.data.candidateId}/approve`, { scenario: 'SUCCESS' });
    assert.equal(r.status, 200);
    await pumpUntil(db, ctx, () => {
      const ex = listExecutions(db)[0];
      return ex && ex.state === 'RESULT_AVAILABLE';
    });

    r = await req(app.base, 'GET', `/api/conversations/${globalConvId}/timeline`);
    assert.equal(r.status, 200);
    const types = r.data.items.map((i) => i.type);
    for (const t of ['message', 'task', 'execution', 'result']) {
      assert.ok(types.includes(t), `timeline contains ${t}`);
    }
    const resultItem = r.data.items.find((i) => i.type === 'result');
    const facts = JSON.parse(resultItem.data.facts_json);
    assert.equal(facts.testsRun.status, 'pass');

    r = await req(app.base, 'GET', '/api/conversations/9999/timeline');
    assert.equal(r.status, 404);
  } finally {
    app.server.close();
  }
});
