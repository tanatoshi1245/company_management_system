---
tags: [domain/company-behavior, domain/scout, domain/application, domain/sales, layer/application, type/app-spec, table/cms_company_master, table/cms_company_monthly]
related:
  - "[[docs/指標定義]]"
  - "[[docs/データ紐付け]]"
  - "[[docs/画面設計]]"
  - "[[docs/デプロイ手順]]"
  - "[[docs/ドメイン認証]]"
  - "[[docs/セキュリティチェックリスト]]"
status: active
---

# company_management_system — 契約企業マネジメントシステム

CS（カスタマーサクセス）向けの社内 Web アプリ。契約中企業ごとの **契約・担当・利用状況（求人枠 / スカウト枠の消化率と営業日ペース）・最終ログイン・スカウト対象の会員属性・コホート別の選考状況** を、ボード（ヒートマップ）と企業詳細で可視化し、**業界ベンチマーク** または **契約時に登録した目標** との比較で良し悪しを示す。

- Cloudflare Workers（Hono）+ React 19 / Vite 7 / TypeScript、BigQuery REST（日次マート `bq-hgt.dwh.cms_*` だけを読む）、Cloudflare D1（目標・企業設定・監査ログ）
- Worker 内蔵の Google ログインによるドメイン認証（`@daijob.com`）。未設定なら fail-closed（503）
- BQ 接続・テーブル定義・ビジネス定義・セキュリティ要件は分析リポジトリ [`tanatoshi1245/claude_analysis`](https://github.com/tanatoshi1245/claude_analysis) の `CLAUDE.md` / `04_アプリケーション/セキュリティ要件.md` を正とする。マートの登録記録は `02_データエンジニアリング/cms_marts/README.md`

| 状態（2026-10-23） | 内容 |
|---|---|
| M0〜M4 実装完了 | 足場・認証、マート 13 表（登録済み・毎日 07:45 JST）、ホームボード、企業詳細、目標・設定、ドキュメント |
| 未実施 | 本番デプロイ（ユーザーのコンソール作業: [デプロイ手順](./docs/デプロイ手順.md)）、リリース後の curl 試験とログ確認（[セキュリティチェックリスト](./docs/セキュリティチェックリスト.md) §2.3） |

## 画面

| ルート | 画面 | 主な内容 |
|---|---|---|
| `/` | 契約企業ボード | KPI タイル（契約企業数・求人枠消化率・ペース遅れ・ログインなし・契約終了間近）→ 注目レーン → `担当=自分` などの絞り込み → **マトリクス・ヒートマップ**（利用状況 / 反応 / 選考 / 接点 × 企業）。右上で **業界比 | 目標比** を切替（再取得なし） |
| `/companies/:id` | 企業詳細 | 契約タイムライン・担当・最終ログイン、求人枠 / スカウト枠の **ゲージ**（営業日ペースの期待値と業界中央値の印）、13 か月の推移（目標の破線・業界 p25〜p75 の帯）、誰にスカウトを送っているか（11 属性）、選考コホート（興味あり返信月 / 応募月 × 現ステータス）、目標との比較、注意点 |
| `/targets`, `/targets/:id` | 契約時の目標 | 一覧（達成率バー・未設定のみ・プラン既定値で一括登録）、企業別 12 か月グリッド（前月からコピー・既定値の適用・差分だけ保存・変更履歴）、企業の設定（担当上書き・枠の期間 / 上書き・メモ） |
| `/settings`, `/help` | 設定・ヘルプ | データの鮮度、Worker 設定の有無、プラン別の既定目標、担当上書き一覧、キャッシュ破棄、指標の定義一覧 |

画面の詳細は [画面設計](./docs/画面設計.md)、数字の式は [指標定義](./docs/指標定義.md)、数字の出所は [データ紐付け](./docs/データ紐付け.md)。

## アーキテクチャ

```
[ブラウザ] React（絞り込み・並べ替え・ベンチマーク切替はクライアント側で再計算。状態は URL）
    │ fetch /api/*（同一オリジンのみ）
[Cloudflare Worker] Hono
    ├─ securityHeaders → authenticate（Google ログイン・@daijob.com・fail-closed）→ sameOriginGuard → requestLog → /auth/* → /api/* → SPA assets
    ├─ BigQuery REST（@param のみ、maximumBytesBilled 200 MB、宛先はホスト許可リスト）→ 日次マート cms_* だけ
    ├─ Cache API（キー = マートの版 + cache_epoch + DATA_VERSION。TTL = 次回 08:30 JST まで）
    └─ D1 CMS_DB（company_targets / company_settings / audit_log / app_meta / plan_target_defaults。キャッシュしない）
[BigQuery bq-hgt.dwh] cms_* 13 表 ← スケジュールドスクリプト bq/marts/scheduled_query.sql（毎日 22:45 UTC = 07:45 JST、約 1 GB/日）
                       ← companies / company_profiles / active_companies / scouts / scout_histories / member_applications / member_details /
                          member_profile_latest / member_job_detail_views / job_publish_history / jobs_all / sf_* / GA4（企業ログイン）
```

- **マート**: `bq/README.md`（一覧・スケジュール・初回構築と突合の記録）と `bq/marts/<table>/README.md`（列定義・元テーブル）。Worker はリクエスト時に生テーブルを読まない（各クエリ < 10 MB、`npm run dryrun` で確認）
- **計算**: `src/shared/metrics/`（営業日消化率・ペース・5 段階ヒート・業界比フォールバック・ヘルス）は Worker とブラウザで共用。閾値は `definitions.ts` / `health.ts` の定数 1 か所
- **営業日**: `src/shared/calendar/jp-holidays.json`（2024〜2027 + 年末年始 12/29〜1/3）。年 1 回 `npm run holidays:update`
- **データの鮮度**: `/api/meta` が `cms_refresh_log` の最新 ok 行を版にする。更新失敗時は前日のマートで配信し続け、画面に警告

## ディレクトリ

```
docs/                 指標定義 / データ紐付け / 画面設計 / デプロイ手順 / ドメイン認証 / セキュリティチェックリスト
bq/marts/             日次マート cms_* の SQL（init.sql / scheduled_query.sql / steps）と各マートの README
d1/migrations/        D1 スキーマ（0001_init / 0002_plan_defaults）、seed.local.sql
scripts/              bq-dryrun.ts（各クエリのスキャン量）/ bq-smoke.ts（疎通）/ update-holidays.ts / put-secret.sh
src/shared/           Worker とブラウザで共用: calendar（営業日）, schema（zod）, metrics（式）, labels, caveats
src/worker/           Hono: index.ts, auth/, bq/（REST・モック・fixtures）, sql/（@param のみ）, d1/（Repo）, services/, routes/, lib/
src/app/              React: router.tsx, App.tsx, features/{home,company,targets,settings}/, components/{ui,charts}/, lib/, styles/
tests/                vitest（worker / shared / app / repo）。helpers/fakeD1.ts は node:sqlite、fakeCache.ts は Cache API の代替
.github/workflows/    deploy.yml（手動実行のみ。本番は Cloudflare の Git 連携）
```

各 feature / routes / sql / marts / d1 / charts ディレクトリの README に「役割 / 依存するデータ（画面要素 → API → マート列 → BQ 元テーブル）/ 編集するときの入口 / テスト」を書く（`tests/repo/readme-frontmatter.test.ts` が YAML フロントマターと `layer/`・`type/` タグを検証）。

## API

| Method / path | 認証 | 返すもの |
|---|---|---|
| GET /api/health | session | 設定の有無（真偽値のみ） |
| GET /api/me | session | ログイン者・編集可否・担当上書きで自分が担当の企業 ID |
| GET /api/meta | session | マートの版・データ最終日・営業日・注記 |
| GET /api/board?month= | session | 企業 × 当月の実績・契約・担当・ベンチマーク（マート部分はキャッシュ、D1 はリクエストごと） |
| GET /api/companies/:id?month= | session | 1 社の詳細（14 か月・日次累積・コホート・属性・ベンチマーク系列・設定・目標） |
| GET /api/targets?month=、GET /api/companies/:id/targets、GET …/targets/history | session | 目標（D1）、監査ログ |
| PUT / DELETE /api/companies/:id/targets/:month、POST …/targets/copy、POST /api/targets/bulk-defaults | verified + 同一オリジン | 目標の登録・削除・コピー・一括既定値（更新 + 監査ログを 1 batch） |
| GET / PUT /api/companies/:id/settings、GET /api/settings/overrides | session / verified | 企業設定（担当上書き・枠） |
| GET / PUT /api/settings/plan-defaults | session / verified | プラン別の既定目標 |
| POST /api/admin/cache/bump | verified | Worker キャッシュの破棄（cache_epoch +1） |

エラーは `{error, code, details?}`（code: noSession / notAllowed / authConfig / readOnly / csrf / badRequest / notFound / bq / noCredentials / storage / internal）。詳細は `src/worker/routes/README.md`。

## セキュリティ（要約。チェックリストは [docs/セキュリティチェックリスト.md](./docs/セキュリティチェックリスト.md)）

- **認証**: 全パスの先頭で Google ログインのセッション Cookie（`cms_session`、HttpOnly / Secure / SameSite=Lax、7 日）を検証。許可ドメイン `daijob.com`。未設定は 503（「URL を知っていれば誰でも」は無い）。[ドメイン認証](./docs/ドメイン認証.md)
- **認可の前提（v1）**: ログインした社内の人は全企業を閲覧でき、どの企業の目標・設定も編集できる（CS は互いに代理）。企業 ID は形式検証 + マスタ存在確認、`company_id` は URL からだけ、書き込みは Google で確かめた人だけ、すべて監査ログに残る。担当だけに編集を限るのは将来の変更点
- **入力**: zod の strict スキーマ（未知キー拒否・上限）、BigQuery は `@param`、D1 は `prepare().bind()`、`sort` 等は許可リスト、書き込みは同一オリジンのみ
- **外部通信**: `safeFetch` のホスト許可リスト。ユーザー入力の URL を fetch しない。`eval` 不使用
- **認証情報**: Workers Secret のみ（`BQ_SA_KEY` / `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `SESSION_SECRET`）。専用 SA `cms-bq-reader@bq-hgt`（読み取り専用）と専用 OAuth クライアント。**SA 鍵 JSON を Secret に置くのはセキュリティ要件 §3.1 の例外**（Workers は SA をアタッチできない。90 日ローテーション）
- **応答**: CSP / nosniff / X-Frame-Options DENY / Referrer-Policy。エラーにスタック・SQL・ホスト名を含めない。`/api/health` は真偽値だけ
- **ログ**: Workers Logs に 1 リクエスト 1 行（誰が・いつ・何を・結果・所要時間 `server-timing`）、D1 `audit_log` に書き込みの前後の値
- **確認済み（2026-10-23）**: `git ls-files` に鍵なし、全履歴 grep に鍵の値なし、`npm audit --audit-level=high` 0 件、フロントのバンドルに `private_key` / `client_secret` なし（CI でも検査）

## セットアップ・ローカル起動

```bash
npm install
cp .dev.vars.example .dev.vars        # 既定は BQ_MOCK=1（サンプルデータ・読み取り専用。担当=自分 は preview@daijob.com）
npm run dev                            # http://127.0.0.1:5173
# 目標の保存まで試す（ローカル D1。書き込みは Google ログインが必要なので、.dev.vars に開発用 OAuth クライアントを入れる）
npm run d1:migrate:local && npm run seed:local
```

## 検証

```bash
npm run typecheck && npm test          # 99 テスト（worker / shared / app / repo）
npm run build                          # dist/client（初期 JS 84 KB gz + ルート別 4〜9 KB gz）
npx wrangler deploy --dry-run --outdir /tmp/wr
BQ_SA_KEY_FILE=/tmp/bq-key.json npm run dryrun   # 各クエリのスキャン量（< 10 MB）
```

## 性能予算（計測はデプロイ後に `server-timing` ヘッダと DevTools で）

| 項目 | 予算 |
|---|---|
| `/api/board`（約 390 社） | gzip ≤ 100 KB。キャッシュ HIT ≤ 60 ms、MISS ≤ 3 s（4 クエリ並列） |
| `/api/companies/:id` | gzip ≤ 35 KB。HIT ≤ 60 ms、MISS ≤ 2.5 s（8 クエリ並列） |
| JS | 初期 84 KB gz（React 含む）、ルート別チャンク ≤ 10 KB gz（実測 2026-10-23） |
| クライアント再計算 | 600 行の絞り込み・並べ替え・モード切替 ≤ 50 ms（`useMemo` を scored / filtered / sorted の 3 段に分割） |
| BigQuery | リクエスト時は各 < 10 MB（上限 200 MB）、日次バッチ ≈ 1 GB |

## 運用

| いつ | 何を |
|---|---|
| 毎朝 07:45 JST | マートが更新される（失敗すると画面に警告。`bq-hgt.dwh.cms_refresh_log` と BigQuery Studio の実行履歴を見る） |
| マートの SQL を変えたとき | `bq/marts/scheduled_query.sql` を直し、BigQuery Studio のスケジュールドクエリ（設定 ID は `bq/README.md`）に貼り替え。Worker 側の `src/worker/sql/*` と `DATA_VERSION` を合わせる |
| マートを手動で再実行したとき | 設定 → 「Worker のキャッシュを捨てる」 |
| 年 1 回（11 月頃） | `npm run holidays:update <内閣府 CSV>` で翌年の祝日を入れる（`tests/shared/businessDays.test.ts` が当年 + 翌年の存在を確認） |
| 90 日ごと | SA `cms-bq-reader@` の鍵をローテーション（[デプロイ手順](./docs/デプロイ手順.md) 1）。台帳 §5.2 を更新 |
| 四半期 | 台帳（`claude_analysis/04_アプリケーション/セキュリティ要件.md` §5）と実環境の突合 |
