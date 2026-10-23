-- プラン別の既定目標（「未設定を既定値で埋める」に使う）
CREATE TABLE IF NOT EXISTS plan_target_defaults (
  plan TEXT NOT NULL,
  metric TEXT NOT NULL CHECK (metric IN ('scout_sent', 'applications', 'interested', 'views', 'hires', 'stage_screening', 'stage_interview', 'stage_offer')),
  value INTEGER NOT NULL CHECK (value BETWEEN 0 AND 10000000),
  updated_by TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (plan, metric)
);
