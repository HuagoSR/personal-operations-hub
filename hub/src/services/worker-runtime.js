'use strict';
const fs = require('fs');
const path = require('path');
const { tx } = require('./tx');
const { applyTransition } = require('./state-machine');
const { appendDomainEvent } = require('./audit');
const { EXECUTION_TRANSITIONS } = require('../domain/states');
const { findExecution } = require('../domain/execution');
const { findTask } = require('../domain/task');
const { findGrant } = require('../domain/execution-grant');
const {
  finishExecutionWithResult, failExecutionWithError,
} = require('../workers/interface');
const { workerActor } = require('../workers/approval-policy');
const { OpenCodeWorkerSession } = require('../workers/opencode-worker');
const { CodexWorkerSession } = require('../workers/codex-worker');

const sessions = new Map();

function profileRow(db, executionId) {
  return db.prepare('SELECT * FROM worker_profiles WHERE execution_id = ?').get(executionId) || null;
}

function upsertProfile(db, row) {
  db.prepare(`INSERT INTO worker_profiles
    (execution_id, worker, profile_dir, home_dir, session_id, worker_port, worker_pid,
     task_prompt, network_mode, status, last_activity_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(execution_id) DO UPDATE SET
      session_id = excluded.session_id,
      worker_port = excluded.worker_port,
      worker_pid = excluded.worker_pid,
      status = excluded.status,
      last_activity_at = excluded.last_activity_at`)
    .run(row.execution_id, row.worker, row.profile_dir, row.home_dir, row.session_id || null,
      row.worker_port || null, row.worker_pid || null, row.task_prompt || null,
      row.network_mode, row.status, row.last_activity_at || new Date().toISOString());
}

function resolveWorkspace(ctx, grant) {
  const allowed = ctx.cfg.workerAllowedRoots || ['/home/huagosr/worker-sandbox'];
  const candidate = (grant && grant.workspace) || ctx.cfg.workerDefaultWorkspace;
  if (!candidate) throw new Error('real worker requires a workspace (set hub config workerDefaultWorkspace or project workspace_path)');
  const abs = path.resolve(candidate);
  if (!allowed.some((root) => abs === root || abs.startsWith(root + '/'))) {
    throw new Error(`workspace ${abs} is outside allowed worker roots`);
  }
  return abs;
}

function makeSession(db, ctx, execution, grant) {
  const cached = sessions.get(execution.id);
  if (cached && cached.profile.worker === execution.worker) return cached;
  const dataRoot = path.resolve(ctx.cfg.workerProfileRoot || path.join(ctx.cfg.dataDir, 'workers'));
  const profileDir = path.join(dataRoot, execution.worker, `ex-${execution.id}`);
  const homeDir = path.join(profileDir, 'home');
  fs.mkdirSync(homeDir, { recursive: true });
  const networkMode = networkModeFor(grant);
  const profile = {
    execution_id: execution.id,
    worker: execution.worker,
    profile_dir: profileDir,
    home_dir: homeDir,
    network_mode: networkMode,
    workspace: resolveWorkspace(ctx, grant),
    status: 'RUNNING',
  };
  let session;
  if (execution.worker === 'opencode') {
    session = new OpenCodeWorkerSession(db, ctx, execution, grant, profile);
  } else if (execution.worker === 'codex') {
    session = new CodexWorkerSession(db, ctx, execution, grant, profile);
  } else {
    throw new Error(`unknown worker type ${execution.worker}`);
  }
  sessions.set(execution.id, session);
  return session;
}

function networkModeFor(grant) {
  if (!grant) return 'allow';
  const caps = JSON.parse(grant.capabilities_json);
  return caps.network === 'deny' ? 'command-deny' : 'allow';
}

function markRunning(db, execution, actor, timeoutMs) {
  const task = findTask(db, execution.task_id);
  applyTransition(db, {
    table: 'executions', entityType: 'execution', id: execution.id,
    from: execution.state, to: 'RUNNING',
    transitions: EXECUTION_TRANSITIONS, version: execution.version, actor,
    reason: 'worker started',
    set: [
      ['attempt = attempt + 1'], ['started_at = ?', new Date().toISOString()],
      ['next_attempt_at = NULL'], ['deadline_at = ?', new Date(Date.now() + timeoutMs).toISOString()],
    ],
  });
  const { TASK_TRANSITIONS } = require('../domain/states');
  if (task.state === 'OPEN' || task.state === 'REVIEW') {
    applyTransition(db, {
      table: 'tasks', entityType: 'task', id: task.id, from: task.state, to: 'EXECUTING',
      transitions: TASK_TRANSITIONS, version: task.version, actor,
      reason: 'execution started',
    });
  }
}

async function pumpExecution(db, ctx, execution) {
  if (execution.worker === 'fake-worker' || execution.worker === WORKER_TYPES_FAKE) return;
  if (!['QUEUED', 'RUNNING'].includes(execution.state)) return;
  const grant = execution.grant_id ? findGrant(db, execution.grant_id) : null;
  if (!grant || grant.state !== 'ACTIVE') {
    failExecutionWithError(db, execution, 'execution grant missing or revoked', workerActor(execution.worker));
    return;
  }
  let session;
  try {
    session = makeSession(db, ctx, execution, grant);
  } catch (e) {
    failExecutionWithError(db, execution, e.message.slice(0, 300), workerActor(execution.worker));
    return;
  }

  if (execution.state === 'QUEUED') {
    try {
      const task = findTask(db, execution.task_id);
      const prompt = `${task.title}\n${task.description || ''}`.trim();
      const actor = workerActor(execution.worker);
      tx(db, () => {
        markRunning(db, execution, actor, ctx.cfg.workerTimeoutMs || 1800000);
        upsertProfile(db, Object.assign({}, session.profile, { task_prompt: prompt }));
      });
      await session.startTask(task, prompt);
      upsertProfile(db, Object.assign({}, session.profile, { status: 'RUNNING', last_activity_at: new Date().toISOString() }));
    } catch (e) {
      failExecutionWithError(db, findExecution(db, execution.id), e.message.slice(0, 300), workerActor(execution.worker));
      sessions.delete(execution.id);
      return;
    }
  } else if (execution.state === 'RUNNING') {
    try {
      if (!session.task) {
        const task = findTask(db, execution.task_id);
        const prompt = `${task.title}\n${task.description || ''}`.trim();
        const profile = profileRow(db, execution.id);
        if (profile && profile.session_id) {
          session.profile.session_id = profile.session_id;
          await session.resumeTask(task, prompt);
        } else {
          await session.startTask(task, prompt);
        }
      }
      await session.pump();
    } catch (e) {
      failExecutionWithError(db, findExecution(db, execution.id), e.message.slice(0, 400), workerActor(execution.worker));
      sessions.delete(execution.id);
      return;
    }
    const current = findExecution(db, execution.id);
    if (session.done) {
      finishExecutionWithResult(db, current, session.buildResult(), workerActor(execution.worker));
      sessions.delete(execution.id);
    } else if (session.failed) {
      failExecutionWithError(db, current, session.failed.slice(0, 400), workerActor(execution.worker));
      sessions.delete(execution.id);
    } else {
      upsertProfile(db, Object.assign({}, session.profile, { status: current.state, last_activity_at: new Date().toISOString() }));
    }
  }
}

const WORKER_TYPES_FAKE = 'fake-worker';

async function forwardDecision(ctx, executionId, decision) {
  const session = sessions.get(executionId);
  if (!session) return { forwarded: false };
  await session.respondToApproval(decision);
  return { forwarded: true };
}

async function forwardAnswer(ctx, executionId, answer) {
  const session = sessions.get(executionId);
  if (!session) return { forwarded: false };
  await session.respondToQuestion(null, answer);
  return { forwarded: true };
}

async function cancelWorker(db, ctx, execution) {
  const session = sessions.get(execution.id);
  if (session) {
    await session.cancel();
    sessions.delete(execution.id);
  }
}

function shutdownAll() {
  for (const session of sessions.values()) {
    try { session.cancel(); } catch (e) { }
  }
  sessions.clear();
}

module.exports = { pumpExecution, forwardDecision, forwardAnswer, cancelWorker, shutdownAll, sessions };
