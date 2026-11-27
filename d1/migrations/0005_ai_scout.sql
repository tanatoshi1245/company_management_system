-- ② スカウト文面の AI 作成（docs/AI機能.md。2026-11-27）。Worker が Vertex AI を呼んで 3 つのモデルで文面を作り、
-- CS の選択・企業の利用・返信・採用をもとに、モデルごとの作り方（プレイブック）を検証・チューニングする。
-- ai_jobs（0004）はそのまま使う（session_url・token_hash・token_expires_at・fired_at は、以前のセッション方式の列で、いまは使わない）。

-- 分析の要点の使い回し（同じ分析対象 = cache_key なら、expires_at までは Vertex AI を呼ばない）
CREATE TABLE IF NOT EXISTS ai_scout_insights (
  cache_key TEXT PRIMARY KEY,
  basis_json TEXT NOT NULL,
  stats_json TEXT NOT NULL,
  insight_json TEXT NOT NULL,
  engine TEXT NOT NULL,
  tokens INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

-- 3 つのモデル（a / b / c）と、プレイブックの版。active_version = いま使う版
CREATE TABLE IF NOT EXISTS ai_scout_models (
  id TEXT PRIMARY KEY CHECK (id IN ('a', 'b', 'c')),
  label TEXT NOT NULL,
  description TEXT NOT NULL,
  active_version INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ai_scout_model_versions (
  model_id TEXT NOT NULL REFERENCES ai_scout_models (id),
  version INTEGER NOT NULL CHECK (version >= 1),
  origin TEXT NOT NULL CHECK (origin IN ('initial', 'tuned', 'rollback', 'manual')),
  note TEXT NOT NULL DEFAULT '',
  playbook TEXT NOT NULL,
  -- 使う生成モデルの ID（NULL = 設定値 AI_SCOUT_ENGINES）
  engine TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  PRIMARY KEY (model_id, version)
);

-- 文面の案（1 依頼 × モデルごとに 1 行）と、フィードバック・実績。
--   judged = その依頼で CS が判断したか（どれかを選んだ / どれも使わない）、chosen = この案が選ばれたか
--   used_state = 企業が使ったか（unknown / used / not_used）、used_source = cs（画面で）/ auto（送信実績との照合）
--   out_* = この案を使った送信の実績（BigQuery の照合結果を週次で写す）、bq_synced_at = BigQuery へ写した日時（NULL = まだ / 直した後）
CREATE TABLE IF NOT EXISTS ai_scout_drafts (
  draft_id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL,
  company_id INTEGER NOT NULL,
  model_id TEXT NOT NULL,
  model_version INTEGER NOT NULL,
  engine TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  tokens INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  judged INTEGER NOT NULL DEFAULT 0 CHECK (judged IN (0, 1)),
  chosen INTEGER NOT NULL DEFAULT 0 CHECK (chosen IN (0, 1)),
  chosen_by TEXT,
  chosen_at TEXT,
  comment TEXT NOT NULL DEFAULT '',
  used_state TEXT NOT NULL DEFAULT 'unknown' CHECK (used_state IN ('unknown', 'used', 'not_used')),
  used_source TEXT CHECK (used_source IN ('cs', 'auto')),
  used_at TEXT,
  out_sends INTEGER,
  out_replies INTEGER,
  out_hires INTEGER,
  out_first_sent_on TEXT,
  out_updated_at TEXT,
  bq_synced_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_ai_scout_drafts_job ON ai_scout_drafts (job_id);
CREATE INDEX IF NOT EXISTS idx_ai_scout_drafts_model ON ai_scout_drafts (model_id, model_version);
CREATE INDEX IF NOT EXISTS idx_ai_scout_drafts_company ON ai_scout_drafts (company_id, chosen, chosen_at DESC);

-- 検証・チューニングの実行の記録（週次の cron と、管理者の手動）
CREATE TABLE IF NOT EXISTS ai_scout_tune_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ran_at TEXT NOT NULL,
  ran_by TEXT NOT NULL,
  report_json TEXT NOT NULL
);

-- 初版（src/worker/ai/scout/models.ts と同じ文。tests/worker/aiScout.test.ts が確かめる）
INSERT OR IGNORE INTO ai_scout_models (id, label, description, active_version, updated_at) VALUES ('a', '実績の型', '返信率の高い文面に共通する件名の型・構成・文章量に、最も忠実に作ります。', 1, '2026-11-27T00:00:00.000Z');
INSERT OR IGNORE INTO ai_scout_model_versions (model_id, version, origin, note, playbook, engine, created_at, created_by) VALUES ('a', 1, 'initial', '初版', '【持ち味】分析の要点に出た「返信率の高い文面の型」に最も忠実に作る。独自の工夫より、実績のある定番の形を優先する。
【件名】分析の「件名の型」の 1 番目を使い、依頼のポジション名・勤務地・条件を当てはめる。文字数は、数値の「件名の文字数」の中央値の前後に収める。【 】などの記号は、型にあるときだけ使う。
【冒頭】{{候補者名}} への呼びかけ、{{企業名}} の {{担当者名}} としての名乗りを 1〜2 文で書く。続けて、連絡した理由を 1 文で述べる。
【構成】分析の「構成」の順番をそのまま守り、要素を足さない・入れ替えない。箇条書き・見出しなどの書き方は、数値の「特徴の割合」が半数を超えるものだけ取り入れる。
【量】本文は、数値の「本文の文字数」の中央値を目安に、p25〜p75 の範囲に収める。行数も同じ範囲にする。
【締め】分析の構成の最後の要素に合わせる。返信のしかた（ひとこと返信でよい、など）を 1 文で示す。
【してはいけないこと】分析の「避けたいこと」に当たる書き方。型に無い要素の追加（長い会社紹介、複数の求人の案内）。依頼に無い条件・数字を作ること。「必ず」「絶対」「業界トップ」のような誇張。同じ内容の繰り返し。', NULL, '2026-11-27T00:00:00.000Z', 'system');
INSERT OR IGNORE INTO ai_scout_models (id, label, description, active_version, updated_at) VALUES ('b', '相手に合わせる', '「なぜあなたに送ったか」を冒頭に置き、受け取る人の関心に沿って情報を並べます。', 1, '2026-11-27T00:00:00.000Z');
INSERT OR IGNORE INTO ai_scout_model_versions (model_id, version, origin, note, playbook, engine, created_at, created_by) VALUES ('b', 1, 'initial', '初版', '【持ち味】受け取る人を主役にする。「なぜあなたに送ったか」から書き始め、相手が知りたい順に情報を並べる。
【件名】受け取る人の条件（経験職種・語学力・現住所など）のうち、ポジションに最も関係する 1 つと、ポジション名を組み合わせる。「〜のご経験をお持ちの方へ」のように、自分のことだと分かる形にする。分析の「件名の型」は、文字数と記号の使い方だけ参考にする。
【冒頭】名乗りは 1 文にとどめ、2 文目までに、受け取る人の条件のどこを見て連絡したかを具体的に書く。条件の指定が無いときは、掲載職種・ポジション名から、活かせる経験を {{ご経験}} の差し込みで示す。
【構成】①連絡した理由（相手の経験・条件）→ ②その経験がこのポジションでどう活きるか → ③仕事内容と条件（要点を 3〜4 行。箇条書き）→ ④次の一歩。会社の紹介は ③ の中の 1〜2 文にとどめる。
【量】数値の「本文の文字数」の中央値の前後。①② に全体の 3 割以上を使う。
【締め】応募を求めず、「まずは話を聞くだけでも」のように負担の小さい一歩を 1 つだけ示す。
【してはいけないこと】会社紹介から始めること。誰にでも当てはまる褒め言葉（「素晴らしいご経歴」だけ、など）。受け取る人の条件に無い経験を決めつけること。依頼に無い条件・数字を作ること。年齢・国籍そのものを理由として書くこと。', NULL, '2026-11-27T00:00:00.000Z', 'system');
INSERT OR IGNORE INTO ai_scout_models (id, label, description, active_version, updated_at) VALUES ('c', '短く要点', '文章量を抑え、要点と「次の一歩」を前に出します。スマートフォンで読み切れる長さです。', 1, '2026-11-27T00:00:00.000Z');
INSERT OR IGNORE INTO ai_scout_model_versions (model_id, version, origin, note, playbook, engine, created_at, created_by) VALUES ('c', 1, 'initial', '初版', '【持ち味】短く、要点から。スマートフォンの 1〜2 画面で読み切れる長さにし、要点と次の一歩を前に出す。
【件名】ポジション名と、いちばんの魅力か条件を 1 つだけ。数値の「件名の文字数」の p25 付近（短め）にする。飾りの言葉・記号の重ねを省く。
【冒頭】呼びかけと名乗りを 1 文にまとめ、すぐに用件（どのポジションの案内か、なぜ連絡したか）を 1〜2 文で言い切る。
【構成】①用件 → ②要点（仕事内容・勤務地・条件を箇条書き 3 行まで。1 行 30 字以内）→ ③次の一歩。分析の「構成」のうち、返信に効く要素だけを残し、ほかは省く。
【量】本文は、数値の「本文の文字数」の p25 を上限の目安にする（p25 が 500 字を超えるときも 500 字以内）。1 文は 50 字以内。段落の間は 1 行あける。
【締め】してほしい行動を 1 つだけ、具体的に書く（例: 「ご興味があれば、ひとことご返信ください」）。詳しい内容は返信の後に伝える、と添える。
【してはいけないこと】会社の沿革・理念の説明。同じ内容の言い換え。前置きの挨拶を重ねること。箇条書きを 4 行以上にすること。短くするために、ポジション名・勤務地などの要点を落とすこと。依頼に無い条件・数字を作ること。', NULL, '2026-11-27T00:00:00.000Z', 'system');

-- audit_log の entity に ai_scout_drafts・ai_scout_models を追加（SQLite は CHECK を変更できないので作り直す。0003・0004 と同じ書き方）
CREATE TABLE audit_log_v5 (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  actor_email TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('create', 'update', 'delete')),
  entity TEXT NOT NULL CHECK (entity IN ('company_targets', 'company_settings', 'plan_target_defaults', 'app_meta', 'scout_unused_entries', 'ai_jobs', 'ai_scout_drafts', 'ai_scout_models')),
  entity_id TEXT NOT NULL,
  company_id INTEGER,
  before_json TEXT,
  after_json TEXT,
  request_id TEXT
);
INSERT INTO audit_log_v5 (id, at, actor_email, action, entity, entity_id, company_id, before_json, after_json, request_id)
  SELECT id, at, actor_email, action, entity, entity_id, company_id, before_json, after_json, request_id FROM audit_log;
DROP TABLE audit_log;
ALTER TABLE audit_log_v5 RENAME TO audit_log;
CREATE INDEX IF NOT EXISTS idx_audit_company ON audit_log (company_id, at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_log (actor_email, at DESC);
