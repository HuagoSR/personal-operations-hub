CREATE TABLE projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  workspace_path TEXT,
  state TEXT NOT NULL DEFAULT 'ACTIVE',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE raw_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  idempotency_key TEXT NOT NULL UNIQUE,
  source TEXT NOT NULL,
  gateway_id TEXT,
  source_message_id TEXT,
  sequence INTEGER,
  chat_id TEXT,
  chat_type TEXT,
  chat_name TEXT,
  sender_id TEXT,
  sender_name TEXT,
  message_type TEXT,
  text TEXT,
  is_mentioned INTEGER NOT NULL DEFAULT 0,
  reply_json TEXT,
  wechat_timestamp TEXT,
  collected_at TEXT,
  raw_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_raw_messages_source_seq ON raw_messages(source, sequence);

CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  priority_hint TEXT NOT NULL DEFAULT 'normal',
  source TEXT NOT NULL,
  project_id INTEGER REFERENCES projects(id),
  actor_type TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  metadata_json TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE event_raw_messages (
  event_id INTEGER NOT NULL REFERENCES events(id),
  raw_message_id INTEGER NOT NULL REFERENCES raw_messages(id),
  PRIMARY KEY (event_id, raw_message_id)
);

CREATE TABLE inbox_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL UNIQUE REFERENCES events(id),
  state TEXT NOT NULL DEFAULT 'NEW',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT,
  state_changed_at TEXT
);
CREATE INDEX idx_inbox_items_state ON inbox_items(state);

CREATE TABLE conversations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER REFERENCES projects(id),
  title TEXT,
  kind TEXT NOT NULL DEFAULT 'PROJECT',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE conversation_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER NOT NULL REFERENCES conversations(id),
  role TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'TEXT',
  content TEXT NOT NULL,
  ref_type TEXT,
  ref_id INTEGER,
  actor_type TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_conversation_messages ON conversation_messages(conversation_id, id);

CREATE TABLE task_candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  origin_type TEXT NOT NULL,
  origin_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  project_id INTEGER REFERENCES projects(id),
  source_event_id INTEGER REFERENCES events(id),
  reason TEXT,
  state TEXT NOT NULL DEFAULT 'OPEN',
  version INTEGER NOT NULL DEFAULT 1,
  actor_type TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT,
  decided_at TEXT,
  UNIQUE(origin_type, origin_id)
);
CREATE INDEX idx_task_candidates_state ON task_candidates(state);

CREATE TABLE user_commands (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id INTEGER REFERENCES conversations(id),
  text TEXT NOT NULL,
  project_id INTEGER REFERENCES projects(id),
  state TEXT NOT NULL DEFAULT 'NEW',
  candidate_id INTEGER REFERENCES task_candidates(id),
  actor_type TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE approvals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  approval_type TEXT NOT NULL,
  candidate_id INTEGER REFERENCES task_candidates(id),
  state TEXT NOT NULL DEFAULT 'PENDING',
  decision TEXT,
  reason TEXT,
  expires_at TEXT,
  decided_at TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  actor_type TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT
);
CREATE INDEX idx_approvals_state ON approvals(state);

CREATE TABLE tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  candidate_id INTEGER REFERENCES task_candidates(id),
  title TEXT NOT NULL,
  description TEXT,
  project_id INTEGER REFERENCES projects(id),
  state TEXT NOT NULL DEFAULT 'OPEN',
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT
);
CREATE INDEX idx_tasks_state ON tasks(state);

CREATE TABLE execution_grants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES tasks(id),
  execution_id INTEGER,
  task_version INTEGER NOT NULL,
  worker TEXT NOT NULL,
  workspace TEXT,
  capabilities_json TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'ACTIVE',
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT,
  issued_by_type TEXT NOT NULL,
  issued_by_id TEXT NOT NULL,
  issued_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  revoked_at TEXT,
  revoked_by_type TEXT,
  revoked_by_id TEXT,
  revoke_reason TEXT
);
CREATE INDEX idx_execution_grants_task ON execution_grants(task_id);

CREATE TABLE executions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL REFERENCES tasks(id),
  grant_id INTEGER REFERENCES execution_grants(id),
  worker TEXT NOT NULL,
  scenario TEXT NOT NULL,
  execution_dispatch_id TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL DEFAULT 'QUEUED',
  attempt INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT,
  timeout_ms INTEGER,
  deadline_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  started_at TEXT,
  finished_at TEXT,
  error TEXT
);
CREATE INDEX idx_executions_state ON executions(state);

CREATE TABLE execution_questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  execution_id INTEGER NOT NULL REFERENCES executions(id),
  question TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'OPEN',
  answer TEXT,
  asked_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  answered_at TEXT
);
CREATE INDEX idx_execution_questions_state ON execution_questions(state);

CREATE TABLE permission_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  execution_id INTEGER NOT NULL REFERENCES executions(id),
  capability TEXT NOT NULL,
  grant_value TEXT,
  high_risk INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL DEFAULT 'OPEN',
  decision TEXT,
  decided_by_type TEXT,
  decided_by_id TEXT,
  asked_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  decided_at TEXT
);
CREATE INDEX idx_permission_requests_state ON permission_requests(state);

CREATE TABLE results (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  execution_id INTEGER NOT NULL UNIQUE REFERENCES executions(id),
  task_id INTEGER NOT NULL REFERENCES tasks(id),
  worker TEXT NOT NULL,
  summary TEXT NOT NULL,
  diff_json TEXT,
  tests_json TEXT,
  artifacts_json TEXT,
  evidence_json TEXT,
  actor_type TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE transition_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  from_state TEXT,
  to_state TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  reason TEXT,
  metadata_json TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_transition_log_entity ON transition_log(entity_type, entity_id);

CREATE TABLE domain_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  entity_type TEXT,
  entity_id INTEGER,
  actor_type TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  payload_json TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_domain_events_type ON domain_events(event_type);

CREATE TABLE outbox_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  entity_type TEXT,
  entity_id INTEGER,
  payload_json TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'PENDING',
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  next_attempt_at TEXT,
  last_error TEXT,
  dispatch_id TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  processed_at TEXT
);
CREATE INDEX idx_outbox_pending ON outbox_events(state, next_attempt_at);

CREATE TABLE ingest_state (
  gateway_id TEXT PRIMARY KEY,
  last_sequence INTEGER NOT NULL DEFAULT 0,
  last_file TEXT,
  updated_at TEXT NOT NULL
);

CREATE TRIGGER trg_results_no_update BEFORE UPDATE ON results
BEGIN SELECT RAISE(ABORT, 'results are immutable'); END;
CREATE TRIGGER trg_results_no_delete BEFORE DELETE ON results
BEGIN SELECT RAISE(ABORT, 'results are immutable'); END;
CREATE TRIGGER trg_transition_log_no_update BEFORE UPDATE ON transition_log
BEGIN SELECT RAISE(ABORT, 'transition_log is append-only'); END;
CREATE TRIGGER trg_transition_log_no_delete BEFORE DELETE ON transition_log
BEGIN SELECT RAISE(ABORT, 'transition_log is append-only'); END;
CREATE TRIGGER trg_domain_events_no_update BEFORE UPDATE ON domain_events
BEGIN SELECT RAISE(ABORT, 'domain_events is append-only'); END;
CREATE TRIGGER trg_domain_events_no_delete BEFORE DELETE ON domain_events
BEGIN SELECT RAISE(ABORT, 'domain_events is append-only'); END;
