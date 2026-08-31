ALTER TABLE permission_requests ADD COLUMN external_id TEXT;
CREATE UNIQUE INDEX idx_permission_requests_external ON permission_requests(external_id) WHERE external_id IS NOT NULL;
