---
tags: [domain/company-behavior, domain/scout, domain/application, domain/sales, layer/application, type/app-spec, table/cms_company_master, table/cms_company_monthly]
related:
  - "[[docs/指標定義]]"
  - "[[docs/デプロイ手順]]"
  - "[[docs/セキュリティチェックリスト]]"
status: draft
---

# company_management_system — 契約企業マネジメントシステム

CS（カスタマーサクセス）向けの社内 Web アプリ。契約中企業ごとの **契約・担当・利用状況（求人枠 / スカウト枠の消化率と営業日ペース）・最終ログイン・スカウト対象の会員属性・コホート別の選考状況** を、一覧ボード（ヒートマップ）と企業詳細で可視化し、**業界ベンチマーク** または **契約時に登録した目標** との比較で良し悪しを示す。

- Cloudflare Workers（Hono）+ React 19 / Vite / TypeScript、BigQuery REST（日次マート `bq-hgt.dwh.cms_*` だけを読む）、Cloudflare D1（目標・企業設定・監査ログ）
- Worker 内蔵の Google ログインによるドメイン認証（`@daijob.com`）。未設定なら fail-closed（503）
- BQ 接続・テーブル定義・ビジネス定義・セキュリティ要件は分析リポジトリ [`tanatoshi1245/claude_analysis`](https://github.com/tanatoshi1245/claude_analysis) の `CLAUDE.md` / `04_アプリケーション/セキュリティ要件.md` を正とする

> 実装中（M0: 足場・認証・モック）。画面・マート・目標登録は M1〜M3 で追加し、README は M4 で完成させる。

## ディレクトリ

```
docs/                 指標定義 / 画面設計 / データ紐付け / デプロイ手順 / ドメイン認証 / セキュリティチェックリスト
bq/marts/             日次マート cms_* の SQL（init.sql / scheduled_query.sql / steps）と各マートの README
d1/migrations/        D1 スキーマ（company_targets / company_settings / audit_log / app_meta / plan_target_defaults）
src/shared/           Worker とブラウザで共用: calendar（営業日）, schema（zod）, metrics（M1）, caveats
src/worker/           Hono: index.ts（ヘッダ → 認証 → CSRF → ログ → ルート）, auth/, bq/, sql/, d1/, services/, routes/, lib/
src/app/              React: router.tsx, App.tsx, features/{home,company,targets,settings}/, components/{ui,charts}/, lib/, styles/
tests/                vitest（worker / shared / app / repo）。helpers/fakeD1.ts は node:sqlite
```

各 feature / routes / sql / marts / d1 ディレクトリの README に「依存するデータ（画面要素 → API → マート列 → BQ 元テーブル）」を書く（`tests/repo/readme-frontmatter.test.ts` が検証）。

## セットアップ・ローカル起動

```bash
npm install
cp .dev.vars.example .dev.vars        # 既定は BQ_MOCK=1（サンプルデータ・読み取り専用）
npm run d1:migrate:local               # ローカル D1（目標の保存を試すとき）
npm run dev                            # http://127.0.0.1:5173
```

## 検証

```bash
npm run typecheck && npm test
npm run build
npx wrangler deploy --dry-run --outdir /tmp/wr
```
