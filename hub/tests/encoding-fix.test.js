'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { makeDb, makeCtx } = require('./helpers');
const { openDatabase, migrate } = require('../src/db');
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

test('6A-fix: invalid UTF-8 request body returns 400 and stores nothing', async () => {
  const { db } = makeDb();
  const ctx = makeCtx();
  const app = await startApp(db, ctx);
  try {
    const gbkBytes = Buffer.from([0xc4, 0xe3, 0xba, 0xc3]);
    const res = await fetch(app.base + '/api/user-commands', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: Buffer.concat([
        Buffer.from('{"text":"'),
        gbkBytes,
        Buffer.from('"}'),
      ]),
    });
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.equal(data.error.code, 'BAD_REQUEST');
    assert.match(data.error.message, /UTF-8/);
    assert.equal(db.prepare('SELECT COUNT(*) c FROM user_commands').get().c, 0);
  } finally {
    app.server.close();
  }
});

test('6A-fix: dense-question-mark text is rejected with encoding hint', async () => {
  const { db } = makeDb();
  const ctx = makeCtx();
  const app = await startApp(db, ctx);
  try {
    const r = await req(app.base, 'POST', '/api/user-commands', { text: '修复 evaluate_board ???????????????????????' });
    assert.equal(r.status, 400);
    assert.equal(r.data.error.code, 'BAD_REQUEST');
    assert.match(r.data.error.message, /编码/);
    assert.equal(db.prepare('SELECT COUNT(*) c FROM user_commands').get().c, 0);
  } finally {
    app.server.close();
  }
});

test('6A-fix: normal Chinese and occasional question marks pass', async () => {
  const { db } = makeDb();
  const ctx = makeCtx();
  const app = await startApp(db, ctx);
  try {
    let r = await req(app.base, 'POST', '/api/user-commands', { text: '检查 evaluate_board 的问题' });
    assert.equal(r.status, 201);
    r = await req(app.base, 'POST', '/api/user-commands', { text: 'What? Really? Fix it?' });
    assert.equal(r.status, 201);
  } finally {
    app.server.close();
  }
});

test('6A-fix: migration 006 marks only dense-question-mark rows', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hub-mig6-'));
  const db = openDatabase(path.join(dir, 'hub.db'));
  db.exec('CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL)');
  for (const f of ['001_init.sql', '002_worker_profiles.sql', '003_worker_permission_external.sql', '004_execution_resume.sql', '005_project_conversation_foundation.sql']) {
    db.exec(fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf8'));
    db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)')
      .run(parseInt(f.split('_')[0], 10), f, new Date().toISOString());
  }
  db.prepare("INSERT INTO conversations (project_id, title, kind) VALUES (NULL, 'Global Hub', 'GLOBAL_HUB')").run();
  db.prepare("INSERT INTO user_commands (conversation_id, text, actor_type, actor_id) VALUES (NULL, '正常中文命令', 'USER', 'owner')").run();
  db.prepare("INSERT INTO user_commands (conversation_id, text, actor_type, actor_id) VALUES (NULL, '?? evaluate_board ?????????????????', 'USER', 'owner')").run();
  db.prepare("INSERT INTO conversation_messages (conversation_id, role, kind, content, actor_type, actor_id) VALUES (1, 'USER', 'TEXT', '?? get_score ??????????', 'USER', 'owner')").run();
  db.prepare("INSERT INTO conversation_messages (conversation_id, role, kind, content, actor_type, actor_id) VALUES (1, 'USER', 'TEXT', 'What? Really? Fix it?', 'USER', 'owner')").run();
  db.prepare("INSERT INTO task_candidates (origin_type, origin_id, title, actor_type, actor_id) VALUES ('USER_COMMAND', 'cmd-1', '?? evaluate_board ?????????????????', 'USER', 'owner')").run();
  db.prepare("INSERT INTO task_candidates (origin_type, origin_id, title, actor_type, actor_id) VALUES ('USER_COMMAND', 'cmd-2', '正常标题', 'USER', 'owner')").run();
  db.prepare("INSERT INTO tasks (candidate_id, title, description) VALUES (1, '?? evaluate_board ?????????????????', NULL)").run();
  db.prepare("INSERT INTO tasks (candidate_id, title, description) VALUES (2, '正常任务', NULL)").run();

  migrate(db, MIGRATIONS_DIR);

  assert.equal(db.prepare("SELECT text FROM user_commands WHERE text = '正常中文命令'").get().text, '正常中文命令');
  assert.equal(db.prepare("SELECT text FROM user_commands WHERE text LIKE '[中文损坏]%'").get().text, '[中文损坏] ?? evaluate_board ?????????????????');
  assert.equal(db.prepare("SELECT content FROM conversation_messages WHERE content LIKE '[中文损坏]%'").all().length, 1);
  assert.equal(db.prepare("SELECT content FROM conversation_messages WHERE content = 'What? Really? Fix it?'").get().content, 'What? Really? Fix it?');
  assert.equal(db.prepare("SELECT title FROM task_candidates WHERE title LIKE '[中文损坏]%'").all().length, 1);
  assert.equal(db.prepare("SELECT title FROM task_candidates WHERE title = '正常标题'").get().title, '正常标题');
  assert.equal(db.prepare("SELECT title FROM tasks WHERE title LIKE '[中文损坏]%'").all().length, 1);
});

test('6A-fix: web assets are valid UTF-8 with intact Chinese markers', () => {
  const webDir = path.join(__dirname, '..', 'src', 'web');
  const markers = {
    'index.html': '',
    'inbox.html': '',
    'tasks.html': '任务候选',
    'approvals.html': '',
    'executions.html': '执行记录',
    'results.html': '',
    'projects.html': '系统项目',
    'project.html': '新建会话',
    'conversations.html': '新会话标题',
    'conversation.html': '生成任务候选',
    'app.js': '',
    'md.js': '',
    'i18n.js': '个人助手',
    'style.css': '',
  };
  for (const [name, marker] of Object.entries(markers)) {
    const buf = fs.readFileSync(path.join(webDir, name));
    let text;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
    } catch (e) {
      assert.fail(`${name} is not valid UTF-8`);
    }
    assert.ok(!text.includes('\uFFFD'), `${name} contains replacement characters`);
    assert.ok(!text.includes('鏂颁'), `${name} contains GBK-misread mojibake`);
    if (marker) assert.ok(text.includes(marker), `${name} is missing expected text: ${marker}`);
  }
});
