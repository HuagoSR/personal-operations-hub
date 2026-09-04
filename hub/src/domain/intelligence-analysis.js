'use strict';

function insertAnalysis(db, a) {
  const res = db.prepare(`INSERT INTO intelligence_analyses
    (job_id, episode_id, source_type, status, schema_version, prompt_version, provider, model,
     input_hash, output_json, confidence, latency_ms, token_usage_json, estimated_cost, error, completed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(a.jobId, a.episodeId, a.sourceType || 'wechat', a.status || 'COMPLETED',
      a.schemaVersion, a.promptVersion, a.provider || null, a.model || null,
      a.inputHash || null, a.outputJson || null,
      a.confidence === undefined ? null : a.confidence,
      a.latencyMs || null,
      a.tokenUsage ? JSON.stringify(a.tokenUsage) : null,
      a.estimatedCost === undefined ? null : a.estimatedCost,
      a.error || null, a.completedAt || new Date().toISOString());
  return Number(res.lastInsertRowid);
}

function findAnalysis(db, id) {
  return db.prepare('SELECT * FROM intelligence_analyses WHERE id = ?').get(id) || null;
}

function latestAnalysisForEpisode(db, episodeId) {
  return db.prepare('SELECT * FROM intelligence_analyses WHERE episode_id = ? ORDER BY id DESC LIMIT 1').get(episodeId) || null;
}

function analysesForEpisode(db, episodeId, limit = 20) {
  return db.prepare('SELECT * FROM intelligence_analyses WHERE episode_id = ? ORDER BY id DESC LIMIT ?').all(episodeId, limit);
}

module.exports = { insertAnalysis, findAnalysis, latestAnalysisForEpisode, analysesForEpisode };
