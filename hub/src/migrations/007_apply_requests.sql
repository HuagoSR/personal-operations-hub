-- 007: apply requests for Hub self-development (deployment lifecycle, out-of-band apply)

CREATE TABLE apply_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  result_id INTEGER NOT NULL REFERENCES results(id),
  task_id INTEGER NOT NULL REFERENCES tasks(id),
  source_commit TEXT,
  base_commit TEXT,
  commit_subject TEXT,
  diff_stat_json TEXT,
  changed_files_json TEXT,
  requires_restart INTEGER NOT NULL DEFAULT 1,
  state TEXT NOT NULL DEFAULT 'PREPARED',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  applied_at TEXT,
  note TEXT
);
CREATE INDEX idx_apply_requests_state ON apply_requests(state);
