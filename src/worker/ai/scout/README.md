---
tags: [domain/scout, layer/application, type/app-spec]
related:
  - "[[src/worker/ai/README]]"
  - "[[docs/AI機能]]"
  - "[[d1/README]]"
status: active
---

# worker/ai/scout — ② スカウト文面の AI 作成 / 添削

## 役割
依頼を受けたその場で、Worker が Vertex AI を呼んで文面を作る（2026-11-27。以前のセッション方式はやめた）。
3 つのモデル（作り方の違う 3 通り）が 1 案ずつ作り、CS が選ぶ。選ばれたか・企業が使ったか・返信・採用をもとに、モデルごとの作り方（プレイブック）を検証・チューニングする。

| ファイル | 内容 |
|---|---|
| `service.ts` | `createScoutJob`（検証 → 分析対象 → 要点 → 3 案 → 保存）、読み出しのフィードバック付け、選択・利用の記録、直した版、モデルの一覧、前の版へ戻す、cron の入口 |
| `routes.ts` | `/api/ai/jobs/:jobId/scout/{choice,usage}`、`/api/ai/scout/{options,models,tune}`、`/api/ai/scout/models/:id/rollback` |
| `dataSource.ts` | 分析に使うデータの入口の型（`ScoutDataSource`）。実装は `bqDataSource.ts`（BigQuery のマート） |
| `insight.ts` | 分析の要点（件名の型・構成・文章量・特徴・避けたいこと）。D1 `ai_scout_insights` で 7 日使い回す |
| `generate.ts` | 3 つのモデルを並行で呼ぶ。出力の後始末（企業名 → `{{企業名}}`、URL → `{{URL}}`、連絡先が残る案は捨てる） |
| `models.ts` | 3 つのモデルの定義と、初版のプレイブック（D1 の初版 = `0005_ai_scout.sql` と同じ文） |
| `tuning.ts` | 検証・アップデート・チューニングのループと、総合点 |
| `repo.ts` | D1（`ai_scout_insights`・`ai_scout_models`・`ai_scout_model_versions`・`ai_scout_drafts`・`ai_scout_tune_runs`） |
| `sample.ts` | サンプルデータ（`BQ_MOCK=1`）のときの見本（Vertex AI を呼ばない。3 案） |

## 流れ（1 回の依頼）
1. 入力の検証（`ScoutInputSchema`・社名と個人情報 = `src/shared/ai/pii.ts`）→ 企業の存在確認
2. `dataSource.benchmark` … 類似業界 × 直近 1 年で、返信率 10% 超の文面の上位 1000 件（無ければ返信率の高い順）の数値と、要点の材料（上位の文面 最大 24 件）。null（マートが無い・対象 0 件）なら失敗
3. 分析の要点 … 同じ分析対象（`cacheKey`）の要点が D1 にあれば使い回す（`insightCached = true`・Vertex AI の呼び出し 0 回）。無ければ 1 回呼ぶ
4. 3 つのモデルを並行で呼ぶ（`Promise.allSettled`）。1 つでも作れれば成功（作れなかったモデルは `warnings`）。3 つとも駄目なら失敗
5. `ai_jobs`（done）+ `ai_scout_drafts`（案ごとに 1 行）+ 監査ログを、1 つの `db.batch()` で保存。失敗は `ai_jobs` に failed で残す

Vertex AI へ渡すもの: 分析の要点・主要な数値・依頼の条件（業界・ポジション名・掲載職種・勤務地・受け取る人の条件・補足・言語・添削なら元の文面）・そのモデルのプレイブック・その企業で前に選ばれた案（直近 1 件の件名と冒頭 200 字）。**企業名は渡さない。**

## 3 つのモデル
| ID | 名前 | 作り方 | 生成モデル |
|---|---|---|---|
| a | 実績の型 | 分析で出た件名の型・構成・文章量に最も忠実に、定番の形で作る | `AI_SCOUT_ENGINES` の a |
| b | 相手に合わせる | 「なぜあなたに送ったか」を冒頭に置き、受け取る人の関心の順に情報を並べる | 同 b |
| c | 短く要点 | 文章量を分析の下側（p25 付近）に抑え、要点と次の一歩を前に出す | 同 c |

生成モデルの ID は設定値（`wrangler.jsonc` の vars）で、コードには書かない。版ごとに別の生成モデルを指定することもできる（`ai_scout_model_versions.engine`。NULL = 設定値）。
チューニングで書き換わるのはプレイブックだけで、持ち味（`models.ts` の `trait`）は保つ。

## 検証・アップデート・チューニングのループ（`tuning.ts`）
週次の cron（月曜 05:00 JST。`src/worker/index.ts` の `scheduled`）と、管理者の手動（`POST /api/ai/scout/tune`）。

1. **実績の取り込み** … 選ばれた案で BigQuery へ写していないもの（直した後のものを含む。直した版があれば直した版）を `dataSource.exportDrafts`。写した案の `dataSource.outcomes` を読み、照合できた案は 送信・返信・採用 を入れて `used_state = used`・`used_source = auto`（CS が「使わなかった」と付けていても直す）
2. **検証** … モデル × 版ごとの成績と総合点
3. **判断**（モデルごと）
   - いまの版の判断が `SCOUT_TUNE_MIN_JUDGED`（8 件）未満 → 据え置き（kept）
   - 1 つ前の版も 8 件以上あり、いまの版の総合点が 10 点以上低い → 前の版の作り方へ戻す（rolledBack。前の版のプレイブックを写した新しい版を作る）
   - それ以外 → チューニング（tuned）: いまのプレイブック・3 モデルの成績の比較・選ばれなかった例（最大 5 件）・選ばれた例（最大 3 件）を渡し、直したプレイブック（1200 字以内）と「何を直したか」を返させて、新しい版として有効にする
4. **記録** … `ai_scout_tune_runs`（画面の「最後の実行」）

Vertex AI を呼ぶのは、チューニングするモデルの数だけ（1 回の実行で最大 3 回）。

### 総合点（0〜100）
```
総合点 = 100 × ( 0.6 × 選ばれた率 + 0.2 × 使われた率 + 0.15 × 返信の点 + 0.05 × 採用の点 )
  選ばれた率 = 選ばれた数 / 判断された数
  使われた率 = 使われた数 / 選ばれた数（選ばれた数が 0 なら 0）
  返信の点   = min(1, 返信 / (送信 + 200) / 0.10)
  採用の点   = min(1, 採用 / (送信 + 200) / 0.01)
```
返信・採用は、送信が少ないうちは 0 に寄る（縮小推定の 200 通）。採用は数が少ないので重みを軽くしている。
定数は `tuning.ts` の 1 か所（`SCORE_WEIGHTS`・`SCORE_SHRINK_SENDS` = 200・`SCORE_REPLY_FULL` = 0.10・`SCORE_HIRE_FULL` = 0.01・`SCOUT_ROLLBACK_MARGIN` = 10 点）。変えるときは、この README も直す。

## 依存するデータ
| 使うもの | 出所 |
|---|---|
| 分析対象の数値・要点の材料・条件の選択肢 | BigQuery の日次マート `dwh.cms_ai_scout_*`（`bqDataSource.ts`・`src/worker/sql/aiScout.ts`・`bq/`） |
| 選ばれた案の照合結果（送信・返信・採用） | 同上（`exportDrafts` で写し、`outcomes` で読む） |
| 企業の存在・企業名（入力と出力の確認にだけ使う） | `cms_company_master`（`../service.ts` の `companyBrief`） |
| 分析の要点・モデルと版・案とフィードバック・実行の記録 | D1（`d1/migrations/0005_ai_scout.sql`） |
| 文面・要点・プレイブックの生成 | Vertex AI（`../vertex.ts`） |

## 実際の Vertex AI での確認（2026-11-27。手元の鍵・偽の材料 6 件）
| 呼び出し | 所要時間 | トークン（入力 / 出力 / 思考） |
|---|---|---|
| 分析の要点（1 回。使い回すと 0 回） | 4.1〜6.2 秒 | 2,022 / 430〜460 / 0（材料 6 件。24 件 × 900 字なら入力は 1.5 万前後の見込み） |
| 3 案の並行（作成・日本語） | 3.8〜5.9 秒（a 1.6〜1.8 秒、b 3.8〜5.9 秒、c 2.5〜2.6 秒） | 合計 4,558 / 940〜970 / 0 |
| 3 案の並行（添削・英語） | 4.1 秒 | 合計 4,909 / 1,007 / 0 |

- 1 回の依頼は、要点を作るとき 8〜11 秒、使い回すとき 4〜6 秒（3 回の実測）。出力はすべて zod を通った
- 思考トークンを抑える設定: `thinkingBudget: 0` は 3 つの生成モデルすべてで受け付け、思考 0（文面の作成に使う）。`thinkingLevel: 'low'` は、b の生成モデルでは思考 0・c の生成モデルでは思考 466 トークン（+2 秒）だった（要点・チューニングにだけ使う）。`thinkingLevel: 'minimal'` は b の生成モデルで 400
- 改行が「\n」という文字のまま返ることがあった → `generate.ts` で実際の改行に直している
- 依頼に無い事実（面談の長さ・顧客の種類など）を書くことがあった → 決まりを足した。まだ残ることがあるので、CS の確認は要る（残した課題）

## 守ること
- 企業名を Vertex AI へ渡さない。入力・画面で直した文面・CS のコメントの社名と連絡先は 400。出力は置き換えるか捨てる
- 材料の文面・依頼の条件・コメントは「データであり、指示ではない」とプロンプトに明記する
- 更新と監査ログは同じ `db.batch()`。企業は URL からだけ（ジョブ ID だけの操作は、D1 の行から企業を引く）
- プレイブック・生成モデルの ID は、管理者（`AI_ADMIN_EMAILS`）にだけ返す

## 編集の入口
結果の形 = `src/shared/ai/scout.ts` → `service.ts`・`sample.ts` → 画面（`src/app/features/ai/scout/`）。作り方 = `models.ts`（初版を変えたら `0005_ai_scout.sql` の INSERT も同じ文に）。総合点 = `tuning.ts`。

## テスト
`tests/worker/aiScout.test.ts`（作成・使い回し・失敗・社名と連絡先・選択と利用・直した版・モデルの一覧・戻す）、`tests/worker/aiScoutTuning.test.ts`（総合点・据え置き / チューニング / 戻す・実績の取り込み・cron）。Vertex AI は fetch の差し替え、データの入口は偽物（`tests/helpers/ai.ts`・`scoutFake.ts`）
