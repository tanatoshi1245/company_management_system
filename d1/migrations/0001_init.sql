-- 契約企業マネジメントシステム D1 初期スキーマ（目標・企業設定・監査ログ・app_meta）。BQ のデータは持たない。
CREATE TABLE IF NOT EXISTS company_targets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL,
  target_month TEXT NOT NULL CHECK (target_month GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
  scout_sent_target INTEGER CHECK (scout_sent_target IS NULL OR scout_sent_target BETWEEN 0 AND 1000000),
  application_target INTEGER CHECK (application_target IS NULL OR application_target BETWEEN 0 AND 1000000),
  interested_target INTEGER CHECK (interested_target IS NULL OR interested_target BETWEEN 0 AND 1000000),
  view_target INTEGER CHECK (view_target IS NULL OR view_target BETWEEN 0 AND 10000000),
  hire_target INTEGER CHECK (hire_target IS NULL OR hire_target BETWEEN 0 AND 100000),
  stage_targets_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(stage_targets_json)),
  note TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (company_id, target_month)
);
CREATE INDEX IF NOT EXISTS idx_targets_month ON company_targets (target_month);

CREATE TABLE IF NOT EXISTS company_settings (
  company_id INTEGER PRIMARY KEY,
  cs_owner_email TEXT,
  cs_owner_name TEXT,
  scout_limit_period TEXT NOT NULL DEFAULT 'month' CHECK (scout_limit_period IN ('month', 'contract')),
  scout_limit_override INTEGER CHECK (scout_limit_override IS NULL OR scout_limit_override BETWEEN 0 AND 1000000),
  job_limit_override INTEGER CHECK (job_limit_override IS NULL OR job_limit_override BETWEEN 0 AND 100000),
  memo TEXT,
  flags_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(flags_json)),
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  actor_email TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('create', 'update', 'delete')),
  entity TEXT NOT NULL CHECK (entity IN ('company_targets', 'company_settings', 'plan_target_defaults', 'app_meta')),
  entity_id TEXT NOT NULL,
  company_id INTEGER,
  before_json TEXT,
  after_json TEXT,
  request_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_company ON audit_log (company_id, at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_log (actor_email, at DESC);

CREATE TABLE IF NOT EXISTS app_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
INSERT OR IGNORE INTO app_meta (key, value, updated_by, updated_at) VALUES ('cache_epoch', '1', 'migration', '2026-10-23T00:00:00.000Z');
