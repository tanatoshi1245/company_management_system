# CLAUDE.md — company_management_system

契約企業マネジメントシステム（CS 向け。Cloudflare Workers + React + BigQuery マート + D1）。編集前に次を読む。

1. [`README.md`](./README.md)（全体像・API・セキュリティの前提）
2. 触る画面の `src/app/features/<feature>/README.md`、触るマートの `bq/marts/<table>/README.md`
3. 数字の式を変えるなら [`docs/指標定義.md`](./docs/指標定義.md) と `src/shared/metrics/definitions.ts`（同じ内容を両方に書く）。マートのロジック（結合・絞り込み・重複排除・期間）や元の列を変えたら [`docs/数値の出所.md`](./docs/数値の出所.md) も直す
4. BQ 接続・テーブル定義・ビジネス定義（RA/RDS 除外、興味あり判定、スナップショット重複排除）は `tanatoshi1245/claude_analysis` の `CLAUDE.md` を正とする

## 守ること

- **SQL は `@param` だけ**（`src/worker/sql/*`）。文字列連結でクエリを組み立てない。テーブル名は `bq-hgt.dwh.cms_*` 固定。生テーブルを Worker から読まない（マートに列を足す）
- **D1 は `prepare().bind()`**。更新と監査ログ（`AuditRepo.insertStmt`）を同じ `db.batch()` に入れる。`company_id` は URL パスからだけ受け取る
- **書き込みルートは `requireVerified`** を付ける（`sameOriginGuard` は `/api/*` に掛かっている）。入力は `src/shared/schema/*` の zod（`.strict()`）で検証する
- **認証情報をコード・フロント・リポジトリに置かない**（Workers Secret のみ）。`git ls-files` で確認する。`/api/health` に値を出さない
- **応答の形・指標の式・ヒートマップの閾値を変えたら `DATA_VERSION`（`src/shared/schema/common.ts`）を +1** し、`docs/指標定義.md` と README を直す
- **チャート / ヒートセルを書く前に `dataviz` スキルをロード**し、パレットを変えたら `validate_palette.js` の結果を `src/app/components/charts/README.md` に記録する
- **新しいディレクトリには README**（YAML フロントマター `tags`（claude_analysis の `00_セマンティックレイヤー/タグ体系.md`）、役割、依存するデータ、編集の入口、テスト）。`tests/repo/readme-frontmatter.test.ts` が検証する
- 変更後は `npm run typecheck && npm test && npm run build && npx wrangler deploy --dry-run --outdir /tmp/wr` を通してからコミットする
- マートの SQL を変えたら dry run でスキャン量を確認し、`bq/README.md` に記録する。登録済みスケジュールドクエリ（設定 ID は `bq/README.md`）にも貼り替える
- コミットメッセージ・コード・ドキュメントにモデル名を書かない

## よく触る場所

| やりたいこと | 場所 |
|---|---|
| ボードの列・指標を足す | `src/shared/metrics/definitions.ts` → `bq/marts/scheduled_query.sql`（列）→ `src/worker/sql/companyMonthly.ts` → `src/shared/schema/board.ts` → `features/home/components/CompanyBoard.tsx` |
| 判定の閾値 | `src/shared/metrics/{pace,heatmap,health}.ts` |
| 画面の文言・ラベル | `src/shared/labels.ts`、注記は `src/shared/caveats.ts` |
| 目標の項目を増やす | `d1/migrations/`（新規ファイル）→ `src/shared/schema/targets.ts` → `src/worker/d1/targetsRepo.ts` → `features/targets/targetsModel.ts` |
| 祝日 | `npm run holidays:update <CSV>` |
