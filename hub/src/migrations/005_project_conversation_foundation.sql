-- 005: Phase 6A product/data model foundation

ALTER TABLE projects ADD COLUMN project_type TEXT NOT NULL DEFAULT 'USER';
ALTER TABLE projects ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 100;

ALTER TABLE conversations ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0;

-- Merge duplicate GLOBAL_HUB conversations (keep the lowest id)
UPDATE conversation_messages SET conversation_id = (
  SELECT MIN(id) FROM conversations WHERE kind = 'GLOBAL_HUB'
) WHERE conversation_id IN (
  SELECT id FROM conversations WHERE kind = 'GLOBAL_HUB'
  AND id != (SELECT MIN(id) FROM conversations WHERE kind = 'GLOBAL_HUB')
);
UPDATE user_commands SET conversation_id = (
  SELECT MIN(id) FROM conversations WHERE kind = 'GLOBAL_HUB'
) WHERE conversation_id IN (
  SELECT id FROM conversations WHERE kind = 'GLOBAL_HUB'
  AND id != (SELECT MIN(id) FROM conversations WHERE kind = 'GLOBAL_HUB')
);
DELETE FROM conversations WHERE kind = 'GLOBAL_HUB'
  AND id != (SELECT MIN(id) FROM conversations WHERE kind = 'GLOBAL_HUB');

CREATE UNIQUE INDEX idx_conversations_one_global ON conversations(kind) WHERE kind = 'GLOBAL_HUB';

ALTER TABLE tasks ADD COLUMN conversation_id INTEGER REFERENCES conversations(id);
ALTER TABLE executions ADD COLUMN conversation_id INTEGER REFERENCES conversations(id);
ALTER TABLE results ADD COLUMN facts_json TEXT;

-- Backfill: tasks from user commands keep their conversation; executions inherit from tasks
UPDATE tasks SET conversation_id = (
  SELECT uc.conversation_id FROM user_commands uc WHERE uc.candidate_id = tasks.candidate_id
) WHERE conversation_id IS NULL AND candidate_id IS NOT NULL;

UPDATE executions SET conversation_id = (
  SELECT t.conversation_id FROM tasks t WHERE t.id = executions.task_id
) WHERE conversation_id IS NULL;

CREATE INDEX idx_tasks_conversation ON tasks(conversation_id);
CREATE INDEX idx_executions_conversation ON executions(conversation_id);
