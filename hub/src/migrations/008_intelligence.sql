-- 008: Hub Intelligence Foundation (Analysis Plane) - episodes, jobs, analyses, feedback

CREATE TABLE message_episodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id TEXT NOT NULL,
  chat_type TEXT,
  status TEXT NOT NULL DEFAULT 'OPEN',
  window_start TEXT NOT NULL,
  window_end TEXT,
  message_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  closed_at TEXT
);
CREATE INDEX idx_episodes_chat_status ON message_episodes(chat_id, status);

CREATE TABLE episode_messages (
  episode_id INTEGER NOT NULL REFERENCES message_episodes(id),
  raw_message_id INTEGER NOT NULL REFERENCES raw_messages(id),
  seq INTEGER NOT NULL,
  PRIMARY KEY (episode_id, raw_message_id)
);

CREATE TABLE intelligence_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  episode_id INTEGER NOT NULL REFERENCES message_episodes(id),
  status TEXT NOT NULL DEFAULT 'PENDING',
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  next_attempt_at TEXT,
  input_hash TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  processed_at TEXT
);
CREATE UNIQUE INDEX idx_ij_episode ON intelligence_jobs(episode_id);
CREATE INDEX idx_ij_status ON intelligence_jobs(status, next_attempt_at);

CREATE TABLE intelligence_analyses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL REFERENCES intelligence_jobs(id),
  episode_id INTEGER NOT NULL REFERENCES message_episodes(id),
  source_type TEXT NOT NULL DEFAULT 'wechat',
  status TEXT NOT NULL DEFAULT 'COMPLETED',
  schema_version TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  provider TEXT,
  model TEXT,
  input_hash TEXT,
  output_json TEXT,
  confidence REAL,
  latency_ms INTEGER,
  token_usage_json TEXT,
  estimated_cost REAL,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  completed_at TEXT
);
CREATE INDEX idx_ia_episode ON intelligence_analyses(episode_id, id);
CREATE TRIGGER trg_ia_no_update BEFORE UPDATE ON intelligence_analyses
BEGIN SELECT RAISE(ABORT, 'intelligence_analyses is append-only'); END;
CREATE TRIGGER trg_ia_no_delete BEFORE DELETE ON intelligence_analyses
BEGIN SELECT RAISE(ABORT, 'intelligence_analyses is append-only'); END;

CREATE TABLE analysis_feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  analysis_id INTEGER NOT NULL REFERENCES intelligence_analyses(id),
  verdict TEXT NOT NULL,
  corrected_importance TEXT,
  corrected_urgency TEXT,
  corrected_project_id INTEGER,
  task_suggestion TEXT,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_af_analysis ON analysis_feedback(analysis_id);
