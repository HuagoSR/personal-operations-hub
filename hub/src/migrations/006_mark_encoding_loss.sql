-- 006: mark historical rows whose Chinese text was lost to '?' by a client-side encoding bug.
-- The loss is irreversible (per-char replacement); we prefix a visible marker and keep the rest.

UPDATE user_commands SET text = '[中文损坏] ' || text
  WHERE length(text) - length(replace(text, '?', '')) >= 8;

UPDATE task_candidates SET title = '[中文损坏] ' || title
  WHERE length(title) - length(replace(title, '?', '')) >= 8;
UPDATE task_candidates SET description = '[中文损坏] ' || description
  WHERE description IS NOT NULL AND length(description) - length(replace(description, '?', '')) >= 8;

UPDATE tasks SET title = '[中文损坏] ' || title
  WHERE length(title) - length(replace(title, '?', '')) >= 8;
UPDATE tasks SET description = '[中文损坏] ' || description
  WHERE description IS NOT NULL AND length(description) - length(replace(description, '?', '')) >= 8;

UPDATE conversation_messages SET content = '[中文损坏] ' || content
  WHERE length(content) - length(replace(content, '?', '')) >= 8;
