'use strict';

function insertJob(db, { episodeId, maxAttempts }) {
  const res = db.prepare(`INSERT INTO intelligence_jobs (episode_id, status, attempts, max_attempts)
    VALUES (?, 'PENDING', 0, ?)`)
    .run(episodeId, maxAttempts === undefined ? 3 : maxAttempts);
  return Number(res.lastInsertRowid);
}

function findJobByEpisode(db, episodeId) {
  return db.prepare('SELECT * FROM intelligence_jobs WHERE episode_id = ?').get(episodeId) || null;
}

function findJob(db, id) {
  return db.prepare('SELECT * FROM intelligence_jobs WHERE id = ?').get(id) || null;
}

function claimRunnableJobs(db, nowIso, limit = 5) {
  return db.prepare(`SELECT * FROM intelligence_jobs
    WHERE status IN ('PENDING', 'RETRYABLE')
      AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
    ORDER BY id LIMIT ?`).all(nowIso, limit);
}

function markJobRunning(db, id, nowIso) {
  db.prepare(`UPDATE intelligence_jobs SET status = 'RUNNING', attempts = attempts + 1, last_error = NULL, next_attempt_at = NULL
    WHERE id = ?`).run(id);
}

function markJobDone(db, id, { status, processedAt, error }) {
  db.prepare('UPDATE intelligence_jobs SET status = ?, processed_at = ?, last_error = ? WHERE id = ?')
    .run(status, processedAt, error || null, id);
}

function failJobRetryable(db, id, { error, nextAttemptAt, maxAttempts, attempts }) {
  const status = attempts >= maxAttempts ? 'FAILED' : 'RETRYABLE';
  db.prepare('UPDATE intelligence_jobs SET status = ?, next_attempt_at = ?, last_error = ? WHERE id = ?')
    .run(status, attempts >= maxAttempts ? null : nextAttemptAt, String(error).slice(0, 400), id);
  return status;
}

module.exports = {
  insertJob, findJobByEpisode, findJob, claimRunnableJobs,
  markJobRunning, markJobDone, failJobRetryable,
};
