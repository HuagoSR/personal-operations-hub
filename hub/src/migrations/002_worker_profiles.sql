CREATE TABLE worker_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  execution_id INTEGER NOT NULL UNIQUE REFERENCES executions(id),
  worker TEXT NOT NULL,
  profile_dir TEXT NOT NULL,
  home_dir TEXT NOT NULL,
  session_id TEXT,
  worker_port INTEGER,
  worker_pid INTEGER,
  task_prompt TEXT,
  network_mode TEXT NOT NULL DEFAULT 'command-deny',
  status TEXT NOT NULL DEFAULT 'PREPARED',
  last_activity_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_worker_profiles_status ON worker_profiles(status);
