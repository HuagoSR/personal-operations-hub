'use strict';
const { tx } = require('./tx');
const { appendDomainEvent } = require('./audit');
const { ACTORS } = require('../domain/actors');
const { claimPending, markDispatched, markFailed, markDead } = require('../domain/outbox-event');
const { insertExecution, findExecutionByDispatchId, listRunnableExecutions } = require('../domain/execution');
const fakeWorker = require('../workers/fake-worker');

const HUB_ACTOR = { actorType: ACTORS.HUB, actorId: 'hub-v01' };

function backoffFor(attempts, cfg) {
  const arr = cfg.outboxBackoffMs;
  return arr[Math.min(Math.max(attempts - 1, 0), arr.length - 1)];
}

function dispatchOutboxEvent(db, ev, ctx) {
  if (ev.event_type !== 'WORKER_DISPATCH_REQUESTED') {
    markDead(db, ev.id, `unknown outbox event type ${ev.event_type}`);
    return;
  }
  let payload;
  try {
    payload = JSON.parse(ev.payload_json);
  } catch (e) {
    markDead(db, ev.id, `bad payload: ${e.message}`);
    return;
  }
  tx(db, () => {
    const existing = findExecutionByDispatchId(db, payload.dispatchId);
    if (existing) return;
    const taskRow = db.prepare('SELECT conversation_id FROM tasks WHERE id = ?').get(payload.taskId);
    const exId = insertExecution(db, {
      taskId: payload.taskId,
      grantId: payload.grantId,
      worker: payload.worker,
      scenario: payload.scenario,
      executionDispatchId: payload.dispatchId,
      timeoutMs: payload.timeoutMs,
      deadlineAt: payload.deadlineAt,
      resumeFromExecution: payload.continueThreadId || null,
      conversationId: taskRow ? taskRow.conversation_id : null,
    });
    if (payload.continueThreadId) {
      const parentProfile = db.prepare('SELECT * FROM worker_profiles WHERE execution_id = ?').get(payload.continueThreadId);
      if (parentProfile) {
        db.prepare(`INSERT OR REPLACE INTO worker_profiles
          (execution_id, worker, profile_dir, home_dir, session_id, worker_port, worker_pid, task_prompt, network_mode, status, last_activity_at)
          VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?, 'PREPARED', ?)`)
          .run(exId, parentProfile.worker, parentProfile.profile_dir, parentProfile.home_dir,
            parentProfile.session_id, payload.prompt || null, parentProfile.network_mode, new Date().toISOString());
      }
    }
    appendDomainEvent(db, {
      eventType: 'EXECUTION_CREATED', entityType: 'execution', entityId: exId, actor: HUB_ACTOR,
      payload: { dispatchId: payload.dispatchId, taskId: payload.taskId, continueThreadId: payload.continueThreadId || null },
    });
  });
  markDispatched(db, ev.id, payload.dispatchId);
}

function consumeOutboxOnce(db, ctx) {
  const rows = claimPending(db, ctx.clock.iso(), 10);
  for (const ev of rows) {
    try {
      dispatchOutboxEvent(db, ev, ctx);
    } catch (e) {
      if (ev.attempts >= ev.max_attempts) {
        markDead(db, ev.id, e.message);
        appendDomainEvent(db, {
          eventType: 'OUTBOX_DEAD', entityType: 'outbox', entityId: ev.id, actor: HUB_ACTOR,
          payload: { error: e.message },
        });
      } else {
        markFailed(db, ev.id, e.message, new Date(ctx.clock.ms() + backoffFor(ev.attempts, ctx.cfg)).toISOString());
      }
    }
  }
  return rows.length;
}

async function pumpOnce(db, ctx) {
  const rows = listRunnableExecutions(db, ctx.clock.iso());
  for (const ex of rows) {
    try {
      if (ex.worker === 'fake-worker') {
        const res = fakeWorker.step(db, ex, ctx);
        if (res && ctx.logger) ctx.logger.debug(`pump execution=${ex.id} action=${res}`);
      } else {
        const runtime = ctx.workerRuntime || require('./worker-runtime');
        await runtime.pumpExecution(db, ctx, ex);
      }
    } catch (e) {
      if (ctx.logger) ctx.logger.warn(`pump error execution=${ex.id} err=${e.message}`);
    }
  }
  return rows.length;
}

module.exports = { consumeOutboxOnce, dispatchOutboxEvent, pumpOnce };
