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
const { runSandboxedCapture } = require('../workers/exec/runner');

const sessions = new Map();

async function collectGitEvidence(ctx, profile) {
  const ws = profile.workspace;
  try {
    if (!fs.existsSync(path.join(ws, '.git'))) return null;
  } catch (e) { return null; }
  const opts = { workspace: ws, homeDir: profile.home_dir, network: 'command-deny' };
  const run = (cmd) => runSandboxedCapture(opts, cmd, 15000);
  const head = await run(['git', 'rev-parse', 'HEAD']);
  if (!head.ok || !head.stdout.trim()) return null;
  const commitHash = head.stdout.trim();
  const baseTag = (ctx.cfg && ctx.cfg.selfDevBaseTag) || 'phase6d-known-good';
  const base = await run(['git', 'rev-parse', baseTag]);
  const baseCommit = base.ok && base.stdout.trim() ? base.stdout.trim() : null;
  const numstat = await run(['git', 'diff', '--numstat', baseCommit || 'HEAD~1', 'HEAD']);
  const subject = await run(['git', 'log', '-1', '--format=%s', 'HEAD']);
  const changedFiles = [];
  let additions = 0;
  let deletions = 0;
  for (const line of numstat.stdout.split('\n')) {
    const m = line.match(/^(\d+|-)\t(\d+|-)\t(.*)$/);
    if (!m || !m[3]) continue;
    changedFiles.push({ path: m[3], additions: m[1] === '-' ? 0 : parseInt(m[1], 10), deletions: m[2] === '-' ? 0 : parseInt(m[2], 10) });
  }
  for (const f of changedFiles) {
    if (f.path.endsWith('.md') || f.path.endsWith('.json')) continue;
    additions += f.additions;
    deletions += f.deletions;
  }
  return {
    commitHash,
    baseCommit,
    commitSubject: subject.ok ? subject.stdout.trim() : null,
    changedFiles: changedFiles.slice(0, 200),
    diffStat: { files: changedFiles.length, additions, deletions },
  };
}

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
  const existing = profileRow(db, execution.id);
  let profileDir;
  let homeDir;
  if (existing && existing.profile_dir && existing.home_dir) {
    profileDir = existing.profile_dir;
    homeDir = existing.home_dir;
  } else {
    const dataRoot = path.resolve(ctx.cfg.workerProfileRoot || path.join(ctx.cfg.dataDir, 'workers'));
    profileDir = path.join(dataRoot, execution.worker, `ex-${execution.id}`);
    homeDir = path.join(profileDir, 'home');
    fs.mkdirSync(homeDir, { recursive: true });
  }
  const networkMode = networkModeFor(grant);
  const profile = {
    execution_id: execution.id,
    worker: execution.worker,
    profile_dir: profileDir,
    home_dir: homeDir,
    network_mode: networkMode,
    workspace: resolveWorkspace(ctx, grant),
    status: 'RUNNING',
    session_id: existing ? existing.session_id : null,
    task_prompt: existing ? existing.task_prompt : null,
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
  if (!['QUEUED', 'RUNNING', 'WAITING_FOR_USER', 'WAITING_FOR_APPROVAL'].includes(execution.state)) return;
  const grant = execution.grant_id ? findGrant(db, execution.grant_id) : null;
  if (!grant || grant.state !== 'ACTIVE') {
    failExecutionWithError(db, execution, 'execution grant missing or revoked', workerActor(execution.worker));
    return;
  }
  const recovering = execution.state.startsWith('WAITING');
  if (recovering && sessions.has(execution.id)) return;
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
      const profile = profileRow(db, execution.id);
      const prompt = (profile && profile.task_prompt) || `${task.title}\n${task.description || ''}`.trim();
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
  } else {
    try {
      if (!session.task) {
        const task = findTask(db, execution.task_id);
        const prompt = `${task.title}\n${task.description || ''}`.trim();
        const profile = profileRow(db, execution.id);
        if (recovering) {
          expirePendingRows(db, execution.id);
          await session.startTask(task, prompt);
        } else if (profile && profile.session_id) {
          session.profile.session_id = profile.session_id;
          await session.resumeTask(task, prompt);
        } else {
          await session.startTask(task, prompt);
        }
      }
      if (recovering && !session.done && !session.failed) {
        const current = findExecution(db, execution.id);
        tx(db, () => {
          applyTransition(db, {
            table: 'executions', entityType: 'execution', id: current.id,
            from: current.state, to: 'RUNNING',
            transitions: EXECUTION_TRANSITIONS, version: current.version, actor: workerActor(execution.worker),
            reason: 'resumed after hub restart',
          });
        });
      }
      await session.pump();
    } catch (e) {
      failExecutionWithError(db, findExecution(db, execution.id), e.message.slice(0, 400), workerActor(execution.worker));
      sessions.delete(execution.id);
      return;
    }
    const current = findExecution(db, execution.id);
    if (session.done) {
      const gitFacts = await collectGitEvidence(ctx, session.profile);
      finishExecutionWithResult(db, current, session.buildResult(gitFacts || undefined), workerActor(execution.worker));
      sessions.delete(execution.id);
    } else if (session.failed) {
      failExecutionWithError(db, current, session.failed.slice(0, 400), workerActor(execution.worker));
      sessions.delete(execution.id);
    } else {
      upsertProfile(db, Object.assign({}, session.profile, { status: current.state, last_activity_at: new Date().toISOString() }));
    }
  }
}

function expirePendingRows(db, executionId) {
  const perms = db.prepare("UPDATE permission_requests SET state = 'EXPIRED', decided_at = ? WHERE execution_id = ? AND state = 'OPEN'")
    .run(new Date().toISOString(), executionId).changes;
  const questions = db.prepare("UPDATE execution_questions SET state = 'EXPIRED', answered_at = ? WHERE execution_id = ? AND state = 'OPEN'")
    .run(new Date().toISOString(), executionId).changes;
  if (perms > 0 || questions > 0) {
    appendDomainEvent(db, {
      eventType: 'RESTART_RECOVERY_EXPIRED_PENDING', entityType: 'execution', entityId: executionId,
      actor: { actorType: 'HUB', actorId: 'hub-v01' },
      payload: { expiredPermissions: perms, expiredQuestions: questions },
    });
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
