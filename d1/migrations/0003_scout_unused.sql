-- スカウト未利用の理由・補足（登録ページ）。正は D1、BigQuery dwh.cms_scout_unused_app に MERGE で写す
CREATE TABLE IF NOT EXISTS scout_unused_entries (
  company_id INTEGER NOT NULL,
  target_month TEXT NOT NULL CHECK (target_month GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
  reason TEXT,
  remarks TEXT CHECK (remarks IS NULL OR length(remarks) <= 500),
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  bq_synced_at TEXT,
  bq_error TEXT,
  PRIMARY KEY (company_id, target_month)
);
CREATE INDEX IF NOT EXISTS idx_scout_unused_month ON scout_unused_entries (target_month);

-- audit_log の entity に scout_unused_entries を追加（SQLite は CHECK を変更できないので作り直す）
CREATE TABLE audit_log_v3 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  actor_email TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('create', 'update', 'delete')),
  entity TEXT NOT NULL CHECK (entity IN ('company_targets', 'company_settings', 'plan_target_defaults', 'app_meta', 'scout_unused_entries')),
  entity_id TEXT NOT NULL,
  company_id INTEGER,
  before_json TEXT,
  after_json TEXT,
  request_id TEXT
);
INSERT INTO audit_log_v3 (id, at, actor_email, action, entity, entity_id, company_id, before_json, after_json, request_id)
  SELECT id, at, actor_email, action, entity, entity_id, company_id, before_json, after_json, request_id FROM audit_log;
DROP TABLE audit_log;
ALTER TABLE audit_log_v3 RENAME TO audit_log;
CREATE INDEX IF NOT EXISTS idx_audit_company ON audit_log (company_id, at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_log (actor_email, at DESC);
