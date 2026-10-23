-- ローカル D1 の試験用データ（npm run seed:local）。モック（BQ_MOCK=1）のサンプル企業のプラン名に合わせる
INSERT OR REPLACE INTO plan_target_defaults (plan, metric, value, updated_by, updated_at) VALUES
  ('DJ', 'scout_sent', 100, 'seed', '2026-10-23T00:00:00.000Z'),
  ('DJ', 'applications', 10, 'seed', '2026-10-23T00:00:00.000Z'),
  ('DJ', 'interested', 15, 'seed', '2026-10-23T00:00:00.000Z'),
  ('DJ', 'hires', 1, 'seed', '2026-10-23T00:00:00.000Z'),
  ('RPO', 'scout_sent', 300, 'seed', '2026-10-23T00:00:00.000Z'),
  ('RPO', 'applications', 20, 'seed', '2026-10-23T00:00:00.000Z');
