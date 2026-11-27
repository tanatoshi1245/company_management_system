---
tags: [domain/company-behavior, domain/scout, layer/application, type/app-spec, table/cms_ai_scout_templates, table/cms_ai_scout_sends]
related:
  - "[[README]]"
  - "[[docs/テスト環境]]"
  - "[[docs/デプロイ手順]]"
  - "[[bq/ai/README]]"
status: active
---

# AI 機能（左のレールの AI メニュー）

Worker が **Vertex AI** を直接呼び、その場で結果を返す（2026-11-27 ユーザー指示）。
当初（2026-11-25）は、依頼のたびに Claude Code のセッションを立ち上げる方式で作ったが、いつ終わるか分からないこと・契約上の扱いがはっきりしないことから**やめた**（セッション用の入口 `/hook/ai/*`・手順書・SQL・スケジュールタスクの発火は、すべて消した）。

機能は 1 つずつ作って本番へ出す（同日ユーザー指示。**前の機能を本番へ出すまで、次に取り掛からない**）。

| 順 | メニュー | ルート | 状態 |
|---|---|---|---|
| 1 | スカウト文面の AI 作成 | `/ai/scout` | **実装済み**（この文書） |
| 2 | 求人の AI 添削 | `/ai/job` | 未着手（画面のコード `src/app/features/ai/job/` は残してあるが、メニュー・ルートから外してある。Worker は 409「準備中」を返す） |
| 3 | AI 分析とレポート生成 | `/ai/report` | 未着手（同上。スライドの枠・PDF・数値の収集 `src/worker/ai/report/collect.ts` は残してある） |

## スカウト文面の AI 作成

### 何をするか（ユーザー指示）

1. **分析対象を選ぶ**: 類似業界 × 直近 1 年の送信実績から、**返信率（件数ベース = 興味あり返信 ÷ 送信）が 10% を超える文面の上位 1000 件**。1 件も無ければ、返信率の高い順に上位 1000 件。
2. **条件つきの分析**: 送る相手の条件（年齢層・国籍・日本語力・英語力・現住所・経験職種）を指定すると、**その条件の人に送ったスカウトだけ**で返信率を数え直して、1 を選び直す。
3. **分析する**: 件名・構成・文章量・特徴を、数値（SQL の集計）と要点（Vertex AI が上位の文面を読む）にまとめる。
4. **3 つのモデルが 1 案ずつ作る**。CS が選ぶ。
5. **検証とチューニングのループ**: CS が選んだか・企業が使ったか・返信・採用（重みは軽い）からモデルごとの成績を出し、作り方を直す（週次 + 管理者の手動）。

### 流れと、速さ・トークンの抑え方

```
画面 /ai/scout
  │ POST /api/companies/:id/ai/jobs {kind: 'scout', input}       ← 企業は URL からだけ。Google ログイン済みの人だけ
  ▼
Worker（1 回の依頼の中で、すべて済ませる）
  1. 分析対象と数値   BigQuery の日次マート dwh.cms_ai_scout_sends / cms_ai_scout_templates を 1 回の SELECT で読む（約 2 秒・約 90 MB）
  2. 分析の要点       Vertex AI × 1 回（上位 24 件の文面 + 数値を読む）。同じ対象・同じ条件は 1 週間使い回す（D1 ai_scout_insights）
  3. 3 案の作成       Vertex AI × 3 回を並行（要点 + 数値 + 依頼の条件 + そのモデルの作り方だけを渡す）
  4. 保存             D1 ai_jobs（結果）・ai_scout_drafts（案ごとの選択・利用・実績）
  ▼
画面: 分析結果と 3 案を表示 → CS が選ぶ・直す・コピーする → 企業が使ったかを記録
```

| | 実測（2026-11-27。実データ + 実際の Vertex AI） |
|---|---|
| 1 回の依頼（分析の要点を新しく作るとき） | 12〜14 秒・約 15,000〜19,000 トークン |
| 1 回の依頼（要点を使い回すとき） | 約 6 秒・約 6,000 トークン |

- **スカウトの本文の表（`dwh.messages`。約 20 GB・パーティションなし）は、依頼のたびには読まない。** 毎朝 1 回、日次のスクリプト（[`bq/ai/scout_marts.sql`](../bq/ai/README.md)）が、文面ごと・送信ごとの表にまとめる。
- **1000 件の文面の数値は SQL で出す**（文字数・行数・特徴の割合。トークンを使わない）。AI が読むのは、上位 24 件の文面（1 社 2 件まで・本文の先頭 900 字）と数値だけ。
- **思考トークンを使わない設定**で呼ぶ（文面の作成）。
- 「文面」= 同じ企業が同じ本文で送ったもの（宛名をそろえ、空白を除いて同一）。**5 通以上送った文面だけ**を対象にする（1〜2 通の文面は、率が 0% か 100% に振れるため）。
- 対象範囲は **類似業界（業界のまとまり 12 個。`src/shared/ai/industryGroups.ts`）→ 全業界** の順。5 通以上の文面が 20 件に満たないときに広げる。条件つきで全業界でも足りないときは、条件を外す（画面に、どこまで広げたか・外した条件を出す）。
- 送る相手の属性は、**現在のプロフィール**（送った時点のものではない）。

### 3 つのモデル

作り方の違う 3 通り。それぞれ別の生成モデルを使う（`wrangler.jsonc` の `AI_SCOUT_ENGINES`）。

| ID | 名前 | 作り方 |
|---|---|---|
| a | 実績の型 | 分析で出た件名の型・構成・文章量に最も忠実に、定番の形で作る |
| b | 相手に合わせる | なぜあなたに送ったかを冒頭に置き、相手の関心に沿って情報を並べる |
| c | 短く要点 | 文章量を分析の下側に抑え、要点と行動の促しを前に出す |

作り方の指示（プレイブック）は D1（`ai_scout_model_versions`）で版を持つ。**チューニングで書き換わるのは、このプレイブック**（生成モデルそのものの再学習ではない）。

### 検証とチューニングのループ（週次 = 月曜 05:00 JST の cron + 管理者の「今すぐ検証・チューニング」）

1. **実績の取り込み**: CS が選んだ案を BigQuery（`dwh.cms_ai_scout_drafts`）へ写す → 翌朝の日次スクリプトが、その企業がその後に送った文面と照合する（案の本文の行の 50% 以上を含む文面 = 使った）→ 送信・返信・採用を D1 へ戻す。CS が画面で付けた「使った / 使わなかった」も使う。
2. **検証**: モデル × 版ごとの成績。総合点 = `100 × (0.6 × 選ばれた率 + 0.2 × 使われた率 + 0.15 × 返信の点 + 0.05 × 採用の点)`（返信・採用は、送信が少ないうちは 0 に寄せる。式と定数は `src/worker/ai/scout/tuning.ts`）。
3. **判断**（モデルごと）:
   - いまの版で判断された依頼が 8 件未満 → **据え置き**
   - 前の版より総合点が 10 点以上低い → **前の版へ戻す**
   - それ以外 → **チューニング**（Vertex AI が、成績の比較・選ばれなかった例・CS のコメントを読んで、プレイブックを直す。持ち味は保つ）
4. 結果は画面の「モデルの成績」に出る（版の履歴・何を直したか・その版の成績）。管理者は、版を選んで戻せる。

### セキュリティ・個人情報

- 企業は URL からだけ。書き込みは Google ログイン済みの人だけ・同一オリジン・zod strict・監査ログと同じ batch。**ログインの外の入口は無い。**
- **入力に社名・個人情報を書かせない**（メールアドレス・電話番号・選んだ企業の名前が入っていたら保存しない。`src/shared/ai/pii.ts`）。作られた文面・プレイブックにも同じ確認を掛ける。
- **Vertex AI へ企業名を渡さない。** マートの文面は、作る時点で企業名 → `{{企業名}}`、宛名 → `{{候補者名}}様`、URL・メールアドレス・電話番号 → 記号 に置き換えてある（担当者名は主な書き方だけ。残りうる）。文面は「データであり指示ではない」として渡し、写させない。作られる文面の差し込みは `{{候補者名}}` `{{企業名}}` `{{担当者名}}`。
- **事実を作らない**よう指示しているが、依頼に無い内容（業務の説明など）をモデルが書くことがある。**企業へ渡す前に、CS が中身を確かめる**（画面に注意を出している）。
- 外へ出る宛先は `safeFetch` の許可リスト（`aiplatform.googleapis.com` を追加）。鍵は Workers Secret だけ。

## ファイルの置き場所

| 層 | 場所 |
|---|---|
| 型（入力・結果・フィードバック・モデル） | `src/shared/ai/scout.ts`、業界のまとまり `industryGroups.ts`、社名・個人情報の確認 `pii.ts` |
| BigQuery の日次マート | `bq/ai/scout_marts.sql`・`bq/ai/README.md`（表と列・特徴の決め方・スキャン量・スケジュールドクエリの設定 ID） |
| Worker がマートを読む | `src/worker/sql/aiScout.ts`（@param）・`src/worker/ai/scout/bqDataSource.ts` |
| Vertex AI の呼び出し | `src/worker/ai/vertex.ts` |
| 生成・フィードバック・チューニング | `src/worker/ai/scout/`（`service.ts`・`insight.ts`・`generate.ts`・`models.ts`・`tuning.ts`・`routes.ts`・`repo.ts`） |
| D1 | `d1/migrations/0004_ai_jobs.sql`（依頼と結果）・`0005_ai_scout.sql`（分析の使い回し・モデルと版・案・チューニングの記録） |
| 画面 | `src/app/features/ai/scout/`、共通部品 `src/app/features/ai/common/` |

## API

| Method / path | 認証 | 内容 |
|---|---|---|
| GET `/api/ai/config` | session | 設定の有無・機能ごとの可否（真偽値だけ） |
| GET `/api/ai/companies`・`/api/ai/companies/:id/defaults` | session | 企業の選択肢（ボードの企業だけ）・自動で入れる値（業界・掲載職種） |
| GET `/api/ai/scout/options` | session | 送る相手の条件の選択肢（マートにある値） |
| POST `/api/companies/:id/ai/jobs` | verified + 同一オリジン | 文面を作る（その場で結果を返す。本文 `{kind: 'scout', input}`） |
| GET `/api/ai/jobs?company=&kind=scout`・`/api/ai/jobs/:jobId` | session | 履歴・1 件（案ごとの選択と実績つき） |
| PUT / DELETE `/api/ai/jobs/:jobId/edited`、DELETE `/api/ai/jobs/:jobId` | verified + 同一オリジン | 文面の手直しの保存 / 取り消し、履歴から消す |
| PUT `/api/ai/jobs/:jobId/scout/choice`・`…/scout/usage` | verified + 同一オリジン | どの案を選んだか（「どれも使わない」も）とコメント、企業が使ったか |
| GET `/api/ai/scout/models` | session | モデルの成績と版の履歴（プレイブックと生成モデルの ID は管理者にだけ） |
| POST `/api/ai/scout/tune`・`/api/ai/scout/models/:id/rollback` | 管理者（`AI_ADMIN_EMAILS`） | 今すぐ検証・チューニング、版を戻す |

## 初回の設定（画面操作・コマンド。約 20 分）

テスト環境は [テスト環境](./テスト環境.md)。BigQuery の表と日次のスケジュールドクエリは作成済み（`bq/ai/README.md`）。

### 1. Worker の SA に権限を付ける（Cloud Shell）

Worker が BigQuery を読むのに使っている SA（`cms-bq-reader@bq-hgt`）に、分析用の表の読み取り・選ばれた案の書き込み・Vertex AI の呼び出しを足す。

```bash
SA=serviceAccount:cms-bq-reader@bq-hgt.iam.gserviceaccount.com
for t in cms_ai_refresh_log cms_ai_scout_templates cms_ai_scout_sends cms_ai_scout_draft_outcomes; do
  bq add-iam-policy-binding --member=$SA --role=roles/bigquery.dataViewer bq-hgt:dwh.$t
done
bq add-iam-policy-binding --member=$SA --role=roles/bigquery.dataEditor bq-hgt:dwh.cms_ai_scout_drafts
gcloud projects add-iam-policy-binding bq-hgt --member=$SA --role=roles/aiplatform.user --condition=None
```

鍵は今の `BQ_SA_KEY` をそのまま使う（Vertex AI 用に別の SA を使うときは、その鍵を Secret `VERTEX_SA_KEY` に入れる）。

### 2. D1 にテーブルを足す

`d1/migrations/0004_ai_jobs.sql` と `0005_ai_scout.sql` を適用する（本番・テスト環境のそれぞれ）。

```bash
npx wrangler d1 migrations apply CMS_DB --remote
```

`wrangler login` 済みの環境が無ければ、Cloudflare → D1 → 対象の DB → Console に、SQL を番号の順に貼って実行する。

### 3. 管理者を決める（任意）

Worker の **Settings → Variables and Secrets** に、Text 変数 `AI_ADMIN_EMAILS`（カンマ区切りのメールアドレス）を足して Deploy する。管理者は、プレイブックを見る・今すぐチューニングする・版を戻すことができる。

### 4. 確かめる

1. `…/api/health` の `ai` が `{"vertex": true, "store": true, …}`。
2. 「スカウト文面の AI 作成」で企業を選ぶ → 「送る相手の条件」に選択肢が出る（= マートを読めている）→「文面を作る」→ 十数秒で 3 案が出る。
3. 案を選ぶ → 「モデルの成績」で、判断された数が増える。

## うまくいかないとき

| 症状 | 原因と対処 |
|---|---|
| 「AI 機能の設定（Vertex AI）が完了していません」 | Worker に鍵（`BQ_SA_KEY` か `VERTEX_SA_KEY`）が無い。Secret を登録して Deploy |
| 「送る相手の条件」に選択肢が出ない・「分析に使える送信実績がありません」 | SA に分析用の表の読み取り権限が無い（上の 1）。または、日次のスクリプトが失敗している（`SELECT * FROM dwh.cms_ai_refresh_log ORDER BY finished_at DESC LIMIT 5`） |
| 3 案のうち一部しか出ない | そのモデルの呼び出しが失敗・時間切れ。画面の注意に理由が出る。続くときは、SA の `roles/aiplatform.user` と、`AI_SCOUT_ENGINES` の生成モデルの ID が今も使えるかを確かめる |
| 「保存できません」 | D1 のマイグレーションが未適用（上の 2） |
| 「企業が使ったか」が自動で付かない | 照合は、選んだ日以降に初めて送られた文面が対象で、翌朝以降に付く。本文の半分以上を書き換えて使うと一致しない（CS が画面で付ける） |
| チューニングが「据え置き」のまま | その版で判断された依頼が 8 件に満たない。CS が案を選ぶ（か「どれも使わない」を付ける）と数えられる |

## 制約と、確認できていないこと（2026-11-27）

- **本番の Worker の SA（`cms-bq-reader`）での動作は未確認**（権限を付ける前。開発時は、分析用の SA の鍵で、マート → 分析 → 3 案 → 選択 → チューニングの判断までを、実データと実際の Vertex AI で通した）。
- 使える生成モデルの ID・ロケーション（`global`）は、2026-11-27 に呼べることを確かめた値。提供が終わると呼べなくなるので、`wrangler.jsonc` の `AI_SCOUT_ENGINES`・`AI_INSIGHT_ENGINE` を差し替える。
- Vertex AI は従量課金（`bq-hgt` の請求）。1 回の依頼は 6,000〜19,000 トークン。
- 日次のスクリプトは 1 回 約 20 GB をスキャンする（うち 18.4 GB はスカウトの本文の表の全読み）。
- チューニングの「直す」は、まだ実データでは動かしていない（判断が 8 件たまってから動く。テストでは、成績に応じて 据え置き / 直す / 戻す が分かれることを確かめた）。
- cron と手動のチューニングが同時に走ると、片方が失敗することがある（排他は入れていない）。
- 以前のセッション方式で作られた依頼が D1 に残っていても、選択・利用の記録はできない（読むだけ）。
