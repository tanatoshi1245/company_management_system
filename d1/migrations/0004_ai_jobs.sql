-- AI 機能（docs/AI機能.md）の依頼と結果。企業単位で残し、2 回目以降の依頼では過去の結果をセッションへ渡す。
-- 合言葉（セッションが結果を返すときに使う）は平文を持たない: token_hash = SHA-256 の hex、token_expires_at = 期限
CREATE TABLE IF NOT EXISTS ai_jobs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('report', 'scout', 'job')),
  company_id INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'done', 'failed')),
  title TEXT NOT NULL,
  input_json TEXT NOT NULL,
  result_json TEXT,
  edited_json TEXT,
  summary TEXT,
  error TEXT,
  sample INTEGER NOT NULL DEFAULT 0 CHECK (sample IN (0, 1)),
  session_url TEXT,
  token_hash TEXT,
  token_expires_at TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  fired_at TEXT,
  completed_at TEXT,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_ai_jobs_company ON ai_jobs (company_id, kind, created_at DESC);

-- audit_log の entity に ai_jobs を追加（SQLite は CHECK を変更できないので作り直す。0003 と同じ書き方）
CREATE TABLE audit_log_v4 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  actor_email TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('create', 'update', 'delete')),
  entity TEXT NOT NULL CHECK (entity IN ('company_targets', 'company_settings', 'plan_target_defaults', 'app_meta', 'scout_unused_entries', 'ai_jobs')),
  entity_id TEXT NOT NULL,
  company_id INTEGER,
  before_json TEXT,
  after_json TEXT,
  request_id TEXT
);
INSERT INTO audit_log_v4 (id, at, actor_email, action, entity, entity_id, company_id, before_json, after_json, request_id)
  SELECT id, at, actor_email, action, entity, entity_id, company_id, before_json, after_json, request_id FROM audit_log;
DROP TABLE audit_log;
ALTER TABLE audit_log_v4 RENAME TO audit_log;
CREATE INDEX IF NOT EXISTS idx_audit_company ON audit_log (company_id, at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_log (actor_email, at DESC);
