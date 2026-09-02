'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { makeDb, makeCtx, USER_ACTOR } = require('./helpers');
const { createServiceFacade } = require('../src/services/facade');
const { createServer } = require('../src/api/server');
const { ensureSystemEntities } = require('../src/services/bootstrap');
const { insertConversation } = require('../src/domain/conversation');

function seedTask(db, { state, execState, title }) {
  const cand = Number(db.prepare("INSERT INTO task_candidates (origin_type, origin_id, title, actor_type, actor_id) VALUES ('TEST', 't-' || (SELECT COUNT(*)+1 FROM task_candidates), ?, 'USER', 'owner')").run(title).lastInsertRowid);
  const taskId = Number(db.prepare('INSERT INTO tasks (candidate_id, title, description, project_id, conversation_id, state, version) VALUES (?, ?, NULL, NULL, NULL, ?, 1)').run(cand, title, state).lastInsertRowid);
  let ex = null;
  if (execState) {
    ex = Number(db.prepare(`INSERT INTO executions (task_id, grant_id, worker, scenario, execution_dispatch_id, state, version)
      VALUES (?, NULL, 'fake-worker', 'SUCCESS', 'dsp-' || ?, ?, 1)`).run(taskId, taskId, execState).lastInsertRowid);
  }
  return { taskId, execId: ex };
}

function startApp(db, ctx) {
  const server = createServer(db, ctx, ctx.cfg);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` }));
  });
}

test('6D: taskBuckets classifies tasks by state and latest execution', () => {
  const { db } = makeDb();
  const ctx = makeCtx();
  const c1 = seedTask(db, { state: 'COMPLETED', execState: 'RESULT_AVAILABLE', title: 't-completed' });
  const c2 = seedTask(db, { state: 'CANCELLED', execState: null, title: 't-cancelled' });
  const c3 = seedTask(db, { state: 'EXECUTING', execState: 'FAILED', title: 't-failed' });
  const c4 = seedTask(db, { state: 'EXECUTING', execState: 'WAITING_FOR_APPROVAL', title: 't-waiting' });
  const c5 = seedTask(db, { state: 'RESULT_AVAILABLE', execState: 'RESULT_AVAILABLE', title: 't-result' });
  const c6 = seedTask(db, { state: 'OPEN', execState: null, title: 't-running' });
  const c7 = seedTask(db, { state: 'EXECUTING', execState: 'RUNNING', title: 't-running2' });
  const S = createServiceFacade(db, ctx);
  const b = S.taskBuckets();
  const ids = (arr) => arr.map((x) => x.task.id);
  assert.ok(ids(b.completed).includes(c1.taskId));
  assert.ok(ids(b.cancelled).includes(c2.taskId));
  assert.ok(ids(b.failed).includes(c3.taskId));
  assert.ok(ids(b.waitingForMe).includes(c4.taskId));
  assert.ok(ids(b.resultAvailable).includes(c5.taskId));
  assert.ok(ids(b.running).includes(c6.taskId) && ids(b.running).includes(c7.taskId));
  assert.ok(!ids(b.resultAvailable).includes(c3.taskId));
});

test('6D: attentionList aggregates pending approvals, open permissions and open questions', () => {
  const { db } = makeDb();
  const ctx = makeCtx();
  const cand = Number(db.prepare("INSERT INTO task_candidates (origin_type, origin_id, title, actor_type, actor_id) VALUES ('USER_COMMAND', 'cmd-a', '需要批准的任务', 'USER', 'owner')").run().lastInsertRowid);
  db.prepare("INSERT INTO approvals (approval_type, candidate_id, state, version, actor_type, actor_id) VALUES ('TASK_APPROVAL', ?, 'PENDING', 1, 'USER', 'owner')").run(cand);
  const taskId = Number(db.prepare("INSERT INTO tasks (candidate_id, title, description, project_id, state, version) VALUES (?, 't', NULL, NULL, 'EXECUTING', 1)").run(cand).lastInsertRowid);
  const ex = Number(db.prepare("INSERT INTO executions (task_id, grant_id, worker, scenario, execution_dispatch_id, state, version) VALUES (?, NULL, 'codex', 'SUCCESS', 'dsp-q', 'WAITING_FOR_APPROVAL', 1)").run(taskId).lastInsertRowid);
  db.prepare("INSERT INTO permission_requests (execution_id, capability, grant_value, high_risk, state) VALUES (?, 'network', 'ask', 1, 'OPEN')").run(ex);
  db.prepare("INSERT INTO execution_questions (execution_id, question, state) VALUES (?, '是否继续？', 'OPEN')").run(ex);
  const S = createServiceFacade(db, ctx);
  const a = S.attentionList();
  assert.equal(a.count, 3);
  assert.equal(a.candidateApprovals.length, 1);
  assert.equal(a.candidateApprovals[0].candidate_title, '需要批准的任务');
  assert.equal(a.openPermissions.length, 1);
  assert.equal(a.openPermissions[0].high_risk, 1);
  assert.equal(a.openPermissions[0].task_title, 't');
  assert.equal(a.openQuestions.length, 1);
  assert.equal(a.openQuestions[0].task_title, 't');
  assert.deepEqual(a.applyRequests, []);
});

test('6D: dashboard includes recentActivity and projectActivity', () => {
  const { db } = makeDb();
  const ctx = makeCtx();
  ensureSystemEntities(db);
  const S = createServiceFacade(db, ctx);
  const d = S.dashboard();
  assert.ok(Array.isArray(d.recentActivity));
  assert.ok(Array.isArray(d.projectActivity));
  const hubRow = d.projectActivity.find((r) => r.project && r.project.name === 'Hub');
  assert.ok(hubRow, 'hub project activity row');
  assert.equal(typeof hubRow.taskCounts, 'object');
});

test('6D: API routes for buckets and attention', async () => {
  const { db } = makeDb();
  const ctx = makeCtx();
  const app = await startApp(db, ctx);
  try {
    let r = await fetch(app.base + '/api/tasks/buckets').then((x) => x.json());
    assert.ok(r.running && r.completed && r.failed, 'buckets shape');
    r = await fetch(app.base + '/api/attention').then((x) => x.json());
    assert.equal(typeof r.count, 'number');
    assert.ok(Array.isArray(r.candidateApprovals));
  } finally {
    app.server.close();
  }
});
