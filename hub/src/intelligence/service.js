'use strict';
const crypto = require('crypto');
const { tx } = require('../services/tx');
const { appendDomainEvent } = require('../services/audit');
const { insertEpisode, findOpenEpisodeForChat, closeEpisode, messagesOfEpisode } = require('../domain/intelligence-episode');
const {
  insertJob, findJobByEpisode, findJob, claimRunnableJobs, markJobRunning, markJobDone, failJobRetryable,
} = require('../domain/intelligence-job');
const { insertAnalysis, latestAnalysisForEpisode } = require('../domain/intelligence-analysis');
const { egressAllowed, buildContext } = require('./context-builder');
const { episodeForMessageInTx } = require('./episode-builder');
const { validateAnalysisOutput } = require('./validate');
const { ANALYSIS_SCHEMA_VERSION } = require('./schema');
const { PROMPT_VERSION, buildMessages } = require('./prompt');
const { createClient } = require('./client');

const ACTOR = { actorType: 'HUB', actorId: 'intelligence' };

function inputHashOf(json) {
  return crypto.createHash('sha256').update(JSON.stringify(json)).digest('hex');
}

// Enqueue one analysis job for an episode (idempotent: one job per episode).
function enqueueEpisodeForAnalysis(db, { episodeId, maxAttempts }) {
  const existing = findJobByEpisode(db, episodeId);
  if (existing) return existing;
  const id = insertJob(db, { episodeId, maxAttempts });
  appendDomainEvent(db, {
    eventType: 'INTELLIGENCE_JOB_ENQUEUED', entityType: 'intelligence_job', entityId: id, actor: ACTOR,
    payload: { episodeId },
  });
  return findJob(db, id);
}

// Convenience: ensure a CLOSED episode exists for a chat (used by tests / future ingest hook),
// then enqueue it. Deterministic and idempotent.
function analyzeInboxBatch(db, { chatId, chatType, messageIds, atIso, cfg }) {
  return tx(db, () => {
    let episode = findOpenEpisodeForChat(db, chatId);
    if (episode) closeEpisode(db, episode.id, atIso);
    const id = insertEpisode(db, { chatId, chatType, windowStart: atIso, status: 'CLOSED' });
    return enqueueEpisodeForAnalysis(db, { episodeId: id, maxAttempts: cfg.outboxMaxAttempts });
  });
}

// Live hook: call INSIDE the ingest transaction for every inbox-relevant message.
// Appends the message to its deterministic episode; when that append closes a
// previous episode (idle/max split), enqueue it for analysis (idempotent).
function onInboxMessageIngested(db, cfg, { rawMessageId, chatId, chatType, collectedAt }) {
  if ((cfg.intelligenceDenyEgressChats || []).includes(chatId)) return { skipped: 'denied-chat' };
  const { episode, closedEpisodeId } = episodeForMessageInTx(db, {
    chatId, chatType, rawMessageId, atIso: collectedAt,
    idleMs: cfg.episodeIdleMs, maxMessages: cfg.episodeMaxMessages,
  });
  if (closedEpisodeId) enqueueEpisodeForAnalysis(db, { episodeId: closedEpisodeId });
  return { episodeId: episode.id, closedEpisodeId };
}

// Periodic sweep: close episodes idle beyond the window and enqueue them (idempotent).
function sweepEpisodesOnce(db, cfg) {
  const now = Date.now();
  const cutoff = new Date(now - (cfg.episodeIdleMs || 600000)).toISOString();
  const open = db.prepare(`SELECT * FROM message_episodes WHERE status = 'OPEN' AND window_end < ?`).all(cutoff);
  let closed = 0;
  let enqueued = 0;
  for (const ep of open) {
    const r = tx(db, () => {
      const cur = db.prepare('SELECT * FROM message_episodes WHERE id = ?').get(ep.id);
      if (!cur || cur.status !== 'OPEN') return { closed: false };
      closeEpisode(db, ep.id, new Date(now).toISOString());
      enqueueEpisodeForAnalysis(db, { episodeId: ep.id });
      return { closed: true };
    });
    if (r.closed) { closed++; enqueued++; }
  }
  return { closed, enqueued };
}

function budgetState(db, ctx) {
  const { cfg } = ctx;
  const now = ctx.clock.iso();
  const day = now.slice(0, 10);
  const month = now.slice(0, 7);
  const row = db.prepare(`SELECT COALESCE(SUM(estimated_cost), 0) AS total FROM intelligence_analyses
    WHERE status = 'COMPLETED' AND estimated_cost IS NOT NULL`).get();
  const total = row.total;
  const dayRow = db.prepare(`SELECT COALESCE(SUM(estimated_cost), 0) AS total FROM intelligence_analyses
    WHERE status = 'COMPLETED' AND estimated_cost IS NOT NULL AND substr(created_at,1,10) = ?`).get(day);
  const monthRow = db.prepare(`SELECT COALESCE(SUM(estimated_cost), 0) AS total FROM intelligence_analyses
    WHERE status = 'COMPLETED' AND estimated_cost IS NOT NULL AND substr(created_at,1,7) = ?`).get(month);
  return {
    total: Number(total || 0),
    today: Number(dayRow.total || 0),
    month: Number(monthRow.total || 0),
    dayLimit: cfg.intelligenceBudgetDailyUsd,
    monthLimit: cfg.intelligenceBudgetMonthlyUsd,
    blocked: Number(monthRow.total || 0) >= cfg.intelligenceBudgetMonthlyUsd
      || Number(dayRow.total || 0) >= cfg.intelligenceBudgetDailyUsd,
  };
}

// Run a single job end to end (context -> egress check -> client -> validate -> persist).
// clientOverride is an optional injectable client for tests.
async function runJob(db, ctx, job, clientOverride) {
  const episodeId = job.episode_id;
  const episode = db.prepare('SELECT * FROM message_episodes WHERE id = ?').get(episodeId);
  const messages = messagesOfEpisode(db, episodeId);
  if (!episode || !messages.length) {
    markJobDone(db, job.id, { status: 'FAILED', processedAt: ctx.clock.iso(), error: 'episode missing or empty' });
    return null;
  }
  const chatId = messages[0].chat_id;
  if (!egressAllowed(db, { chatId, denyEgressChats: ctx.cfg.intelligenceDenyEgressChats })) {
    markJobDone(db, job.id, { status: 'FAILED', processedAt: ctx.clock.iso(), error: 'egress denied for chat' });
    appendDomainEvent(db, {
      eventType: 'INTELLIGENCE_EGRESS_DENIED', entityType: 'intelligence_job', entityId: job.id, actor: ACTOR,
      payload: { episodeId },
    });
    return null;
  }
  const projects = db.prepare('SELECT id, name, description FROM projects ORDER BY sort_order, id').all();
  const relatedTasks = db.prepare(`SELECT DISTINCT t.id, t.title, t.state FROM tasks t
    WHERE t.state IN ('OPEN','EXECUTING') ORDER BY t.id DESC LIMIT 20`).all();
  const context = buildContext(db, { episode, messages, projects, relatedTasks });
  const messagesModel = buildMessages(context);
  const inputHash = inputHashOf(context);
  const existing = db.prepare('SELECT id FROM intelligence_analyses WHERE input_hash = ? AND status = ? LIMIT 1').get(inputHash, 'COMPLETED');
  if (existing) {
    markJobDone(db, job.id, { status: 'COMPLETED', processedAt: ctx.clock.iso(), error: 'duplicate input skipped' });
    return db.prepare('SELECT * FROM intelligence_analyses WHERE id = ?').get(existing.id);
  }
  const client = clientOverride || createClient(ctx.cfg, {});
  const model = ctx.cfg.intelligenceModel;
  const result = await client.analyze({ messages: messagesModel, model });
  const completedAt = ctx.clock.iso();
  const schemaVersion = ANALYSIS_SCHEMA_VERSION;
  const promptVersion = PROMPT_VERSION;
  if (!result.ok) {
    const analysisId = insertAnalysis(db, {
      jobId: job.id, episodeId, status: 'FAILED', schemaVersion, promptVersion,
      provider: client.provider, model,
      inputHash, latencyMs: result.latencyMs, tokenUsage: result.usage, estimatedCost: null,
      error: String(result.error || 'provider error').slice(0, 400), completedAt,
    });
    markJobDone(db, job.id, { status: 'FAILED', processedAt: completedAt, error: result.error });
    appendDomainEvent(db, {
      eventType: 'INTELLIGENCE_ANALYSIS_FAILED', entityType: 'intelligence_analysis', entityId: analysisId, actor: ACTOR,
      payload: { episodeId, jobId: job.id, error: String(result.error).slice(0, 200) },
    });
    return null;
  }
  const parsed = validateAnalysisOutput(result.output);
  if (!parsed.ok) {
    const analysisId = insertAnalysis(db, {
      jobId: job.id, episodeId, status: 'FAILED', schemaVersion, promptVersion,
      provider: client.provider, model,
      inputHash, latencyMs: result.latencyMs, tokenUsage: result.usage, estimatedCost: null,
      error: `schema invalid: ${parsed.error}`, completedAt,
    });
    markJobDone(db, job.id, { status: 'FAILED', processedAt: completedAt, error: `schema invalid: ${parsed.error}` });
    appendDomainEvent(db, {
      eventType: 'INTELLIGENCE_SCHEMA_FAILED', entityType: 'intelligence_analysis', entityId: analysisId, actor: ACTOR,
      payload: { episodeId, error: parsed.error },
    });
    return null;
  }
  const analysisId = insertAnalysis(db, {
    jobId: job.id, episodeId, status: 'COMPLETED', schemaVersion, promptVersion,
    provider: client.provider, model,
    inputHash, outputJson: JSON.stringify(parsed.value), confidence: parsed.value.confidence,
    latencyMs: result.latencyMs, tokenUsage: result.usage, estimatedCost: result.estimatedCost, completedAt,
  });
  markJobDone(db, job.id, { status: 'COMPLETED', processedAt: completedAt });
  appendDomainEvent(db, {
    eventType: 'INTELLIGENCE_ANALYSIS_COMPLETED', entityType: 'intelligence_analysis', entityId: analysisId, actor: ACTOR,
    payload: { episodeId, jobId: job.id, confidence: parsed.value.confidence },
  });
  return db.prepare('SELECT * FROM intelligence_analyses WHERE id = ?').get(analysisId);
}

// Process due jobs once. Never throws into caller loops; failures persist per job.
async function processIntelligenceOnce(db, ctx) {
  if (!ctx.cfg.intelligenceEnabled) return { processed: 0, disabled: true };
  const budget = budgetState(db, ctx);
  if (budget.blocked) return { processed: 0, budgetBlocked: true, budget };
  const jobs = claimRunnableJobs(db, ctx.clock.iso(), 5);
  let processed = 0;
  for (const job of jobs) {
    markJobRunning(db, job.id, ctx.clock.iso());
    try {
      await runJob(db, ctx, { ...job, id: job.id });
      processed++;
    } catch (e) {
      const current = findJob(db, job.id);
      const attempts = current ? current.attempts : 1;
      failJobRetryable(db, job.id, {
        error: e.message || String(e),
        nextAttemptAt: new Date(Date.now() + (ctx.cfg.outboxBackoffMs || [1000, 2000])[Math.min(attempts, 1)]).toISOString(),
        maxAttempts: current ? current.max_attempts : 3,
        attempts,
      });
      processed++;
    }
  }
  return { processed, budget };
}

module.exports = {
  enqueueEpisodeForAnalysis,
  onInboxMessageIngested,
  sweepEpisodesOnce,
  runJob,
  processIntelligenceOnce,
  budgetState,
  inputHashOf,
  ACTOR,
};
