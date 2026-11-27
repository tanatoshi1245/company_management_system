---
tags: [domain/scout, domain/company-behavior, layer/engineering, type/data-mart-spec, source/bq-internal, table/messages, table/scouts, table/scout_histories, table/cms_company_master]
related:
  - "[[bq/README]]"
  - "[[docs/AI機能]]"
  - "[[src/worker/ai/scout/README]]"
status: active
---

# bq/ai — AI 機能の日次マート cms_ai_*（BigQuery `bq-hgt.dwh`）

## 役割
② スカウト文面の AI 作成（[docs/AI機能.md](../../docs/AI機能.md)）が使う日次マート。**Worker は Vertex AI を直接呼び、分析の材料はここの表だけを読む**（`messages` などの生テーブルは読まない）。1 本のスクリプト [`scout_marts.sql`](./scout_marts.sql) が毎朝、スカウトの最初の 1 通を文面にまとめ、社名などを記号に置き換え、特徴のフラグと返信の実績を付ける。

- Worker の読み書き: [`src/worker/sql/aiScout.ts`](../../src/worker/sql/aiScout.ts)（`@param` だけ）→ [`src/worker/ai/scout/bqDataSource.ts`](../../src/worker/ai/scout/bqDataSource.ts)
- 分析の決まり（返信率 10% 超の上位 1000 件・直近 12 か月・最小 5 通・最小 20 件）は [`src/shared/ai/scout.ts`](../../src/shared/ai/scout.ts) の定数。マートは 13 か月 + 当月を持ち、絞るのは Worker の SQL

## 依存するデータ（元テーブル）
`cms_company_master`（企業・業界・プロファイル・社名。**07:45 JST の cms_marts 日次更新の後に走らせる**）/ `scouts` / `scout_histories` / `messages`（subject・body。スカウトの最初の 1 通 = `scout_id IS NOT NULL AND is_from_company = 1` を scout_id ごとに `created_at` の最も早いもの）/ `member_profile_latest`（年齢層・国籍の区分・語学・最終経験職種の大分類）/ `member_details`（現住所。最新のスナップショット）。ビジネス定義（RA 4928 / 14508・RDS 7080 の除外、興味あり返信 = `質問する / 開封のみ → 興味あり`、スナップショットの重複排除）は claude_analysis の `CLAUDE.md`。

| 表 | 粒度 | 更新 | Worker |
|---|---|---|---|
| `cms_ai_dim_industry_group` | 業界（48） | 全件差し替え | 読まない（同じ対応を `src/shared/ai/industryGroups.ts` に持つ） |
| `cms_ai_scout_templates` | 文面（企業 × 本文） | 全件差し替え | 読む |
| `cms_ai_scout_sends` | スカウト 1 通 | 全件差し替え（送信月でパーティション） | 読む |
| `cms_ai_scout_drafts` | CS が選んだ案 | **アプリが MERGE で書く**（スクリプトは枠を作るだけ） | 書く |
| `cms_ai_scout_draft_outcomes` | 案 | 全件差し替え | 読む |
| `cms_ai_refresh_log` | 実行記録 | 追記（`step = 'scout_marts'`） | 読む（更新日 = 最新の `ok` の `run_date`） |

## 更新スケジュール（登録済み）

| 項目 | 値 |
|---|---|
| スケジュールドクエリ名 | `cms_ai スカウト文面マート 日次更新（契約企業マネジメントシステム AI / 毎日JST08:10）` |
| 設定 ID | `6b16fcc5-0000-23e6-bf43-b8db38fbb212`（BigQuery Studio → スケジュールドクエリ） |
| スケジュール | 毎日 23:10 UTC（= JST 08:10。cms_marts 日次更新 07:45 JST の後） |
| SQL | `scout_marts.sql`（スクリプト。宛先テーブルなし） |
| 実行者 | `id-69-213@bq-hgt.iam.gserviceaccount.com`（cms_marts と同じ） |
| 登録日 | 2026-11-27（Data Transfer API で登録。登録直後の実行 ok） |

**SQL を変えたとき**: BigQuery Studio → スケジュールドクエリ → 上の設定 ID を開き、`scout_marts.sql` の全文に差し替えて保存する（または Data Transfer API の `PATCH transferConfigs/<設定 ID>?updateMask=params`）。列を変えたら `src/worker/sql/aiScout.ts`・`src/shared/ai/scout.ts`・フィクスチャ（`src/worker/bq/fixtures/aiScout.ts`）を合わせる。

## スキャン量と所要時間（2026-11-27 実測）

| 何 | スキャン | 時間 |
|---|---|---|
| `scout_marts.sql`（日次。`messages` の subject・body を **1 回の実行で 1 回**だけ読む = 約 18.4 GB。`messages` はパーティションもクラスタリングも無いので、期間で絞っても量は変わらない） | 20.1 GB | 34〜40 秒 |
| Worker: `ai_scout_benchmark`（分析対象の数値 + 要点の材料。1 回の SELECT） | dry run 93 MB・実行 69〜85 MB（条件が多いほど列が増える） | 1.4〜2.0 秒（同じ日の同じ条件は BigQuery のキャッシュで 0.6 秒・0 MB） |
| Worker: `ai_scout_options`（条件の選択肢） | 26 MB | 0.5〜0.6 秒 |
| Worker: `ai_scout_outcomes`（照合結果） | 0 MB（表が小さい） | 0.4 秒 |
| Worker: `ai_scout_drafts_merge`（選ばれた案の書き込み。1 回 50 行まで） | 0 MB | 1.7 秒 |

初回の中身: 文面 23,400（送信 5 通以上 4,296）・送信 269,616 通（興味あり返信 21,052・採用 87・自動 47,803）・本文のメッセージが無いスカウト 9,095 通（表に入らない）・`cms_ai_scout_templates` 49.8 MB・`cms_ai_scout_sends` 48.0 MB。直近 12 か月で、送信 5 通以上の文面 3,670 のうち返信率 10% 超は 1,216。

## 表の定義

### cms_ai_dim_industry_group（類似業界のまとまり）
| 列 | 型 | 説明 |
|---|---|---|
| industry | STRING | 業界（`cms_company_master.industry` の値。48 種） |
| industry_group | STRING | まとまりの ID（12 種: it / hr / maker / consulting / finance / consumer / trading / public / media / realestate / medical / other） |
| group_label | STRING | まとまりの名前（IT・通信 / 人材 / メーカー / コンサルティング / 金融 / サービス・消費 / 商社・物流 / 教育・公共 / メディア / 不動産・建設・エネルギー / 医療・ヘルスケア / その他） |

対応はスクリプトの中に固定（`-- industry_groups:begin` 〜 `end`）。**同じ対応を `src/shared/ai/industryGroups.ts` に持ち、`tests/worker/aiScoutData.test.ts` が突き合わせる**。業界の値が増えたら両方に足す（足すまでは、その業界の企業は `other` に入る。確認: `SELECT industry FROM cms_company_master EXCEPT DISTINCT SELECT industry FROM cms_ai_dim_industry_group`）。

### cms_ai_scout_templates（文面）
文面 = **企業 × 空白を除いた本文が同じもの**（直近 13 か月 + 当月に送った最初の 1 通。手動・自動の両方）。本文をまとめる前に、冒頭の宛名（「〇〇様」「123456様」「Dear 〇〇,」）だけを `{{候補者名}}様` にそろえる（宛名に会員 ID を入れた文面が、1 通ずつ別の文面にならないように）。RA / RDS を除き、`cms_company_master` に居る企業だけ。

| 列 | 型 | 説明 |
|---|---|---|
| template_id | STRING | `TO_HEX(MD5(company_id:空白を除いた本文))`（日をまたいで同じ） |
| company_id | INT64 | 企業 |
| industry / industry_group / company_type | STRING | 業界・類似業界のまとまり・企業種別（`cms_company_master`） |
| subject | STRING | その文面で最も多く使われた件名（置き換え済み） |
| body | STRING | 本文（置き換え済み。下の「置き換え」） |
| lang | STRING | `ja` / `en`（ひらがな・カタカナ・漢字が、空白を除いた本文の 20% 以上なら ja） |
| body_chars / subject_chars / line_count | INT64 | 本文・件名の文字数、空でない行の数 |
| has_* | BOOL | 特徴のフラグ（下の表。12 個） |
| first_sent_on / last_sent_on | DATE | 窓の中で最初 / 最後に送った日 |
| sends_total / replies_total / hires_total | INT64 | 送信・興味あり返信・採用（窓の全体。Worker は `cms_ai_scout_sends` から数え直す） |
| auto_share | FLOAT64 | 自動スカウトの割合 |
| refreshed_at | TIMESTAMP | 作成日時 |

**置き換え**（目安。**担当者名・求人元の社名・候補者の個人的な内容は残りうる**ので、生成の側は本文をそのまま写さない）:

| 何 | 置き換え先 | 決め方 |
|---|---|---|
| URL | `{{URL}}` | `(?i)(?:https?[:：][/∕／]{2}\|www[.․])[^\s　<>"）)」』】]+` |
| メールアドレス | `{{メールアドレス}}` | `[A-Za-z0-9._%+\-]+[ \t]?[@＠][ \t]?[A-Za-z0-9\-]+(?:\.[A-Za-z0-9\-]+)+` |
| SNS などのアカウント名 | `{{アカウント}}` | `[@＠][A-Za-z0-9_.\-]{3,}` |
| 電話番号 | `{{電話番号}}` | `+81…` / `0x-xxxx-xxxx` の形 |
| その企業の社名 | `{{企業名}}` | `cms_company_master` の `company_name`・`internal_name` と、スカウトの `profile_name`。それぞれ、かっこ書きを除いた形・法人格（株式会社 など / Co., Ltd. など）を除いた形も。2 文字（英数字だけなら 3 文字）以上、大文字小文字を区別しない、長い順。前後に付いた法人格も一緒に消す |
| ほかの社名 | `{{社名}}` | 法人格の前後の語（`株式会社〇〇` / `〇〇株式会社` / `Xxx Co., Ltd.` など）。残った法人格の語も |
| 担当者名 | `{{担当者名}}` | 「担当: 〇〇」「〇〇と申します」「My name is 〇〇」の形だけ |
| 宛名 | `{{候補者名}}様` / `Dear {{候補者名}},` | 1 行目の「〇〇様 / さま / さん」「Dear / Hi / Hello 〇〇,」、どこでも「（ID）5〜8 桁の数字 + 様」。本文の「ID: 123456」は `ID {{候補者ID}}` |

置き換えの残り（2026-11-27。23,400 文面の body）: 「株式会社」0、「http」0、「@ / ＠」256（「＠東京」のような場所の表記で、アドレスではない）。

**特徴のフラグ**（置き換え後の body に対して。`(?i)` = 大文字小文字を区別しない）:

| 列 | 意味 | 正規表現 |
|---|---|---|
| has_salary | 年収・給与の数字 | `(?i)(?:年収\|月給\|月収\|給与\|時給\|賞与\|想定年俸\|年俸)[^\n]{0,20}[0-9０-９]\|[0-9０-９][0-9０-９,，.]*[ \t]*(?:万円\|万\|円\|M[ \t]?JPY\|million\|JPY\|yen)\|[¥￥][ \t]?[0-9０-９]\|JPY[ \t]?[0-9]\|salary[^\n]{0,30}[0-9]` |
| has_location | 勤務地 | `(?i)勤務地\|就業場所\|最寄\|[\p{Han}]駅\|東京\|大阪\|名古屋\|福岡\|横浜\|京都\|神戸\|札幌\|仙台\|[都道府県市区]内\|location\|based in\|Tokyo\|Osaka\|Yokohama\|Nagoya\|Fukuoka\|Kyoto\|Kobe\|Sapporo` |
| has_bullets | 箇条書き・記号の行が 3 行以上 | 行頭が `[・●○■□◆◇◎▼▶►✓✔※★☆*•–\-]` / `1.` `1)` / `①` / `【` の行を数える |
| has_why_you | なぜあなたかに触れている | `(?i)ご経歴\|ご経験\|レジュメ\|履歴書\|職務経歴\|プロフィール\|拝見\|your (?:profile\|experience\|background\|resume\|résumé\|cv\|skills?\|career)\|came across\|impressed` |
| has_job_url | URL がある（求人ページなど） | `\{\{URL\}\}` |
| has_company_intro | 会社の紹介 | `(?i)弊社は\|当社は\|私たちは\|私どもは\|弊社について\|会社概要\|事業内容\|設立\|創業\|従業員\|we are an?\|our company\|about us\|founded in\|established in\|headquartered` |
| has_cta | 行動の促し | `(?i)興味あり\|ご興味\|ご返信\|お返事\|お気軽に\|ご連絡(?:を)?(?:お待ち\|ください\|下さい\|いただけ)\|ご応募\|reply\|interested\|let (?:me\|us) know\|feel free\|get in touch\|look(?:ing)? forward to hearing\|apply` |
| has_remote | リモート・在宅 | `(?i)リモート\|在宅\|テレワーク\|ハイブリッド\|フルフレックス\|フレックス\|remote\|work(?:ing)? from home\|\bWFH\b\|hybrid\|flex(?:ible)? (?:time\|hours\|work)` |
| has_urgency | 急募・期限（件名 + 本文） | `(?i)急募\|至急\|早期\|期間限定\|限定\|締切\|締め切り\|先着\|urgent\|immediate(?:ly)?\|\bASAP\b\|limited\|deadline` |
| has_brackets_subject | 件名に【 】など | `【[^】]+】\|\[[^\]]+\]\|≪[^≫]+≫\|＜[^＞]+＞` |
| has_benefits | 福利厚生・休日 | `(?i)福利厚生\|休日\|休暇\|残業\|ビザ\|手当\|賞与\|ボーナス\|社会保険\|visa\|benefits?\|bonus\|allowance\|paid leave\|holidays?` |
| has_meeting_offer | 面談の提案 | `(?i)面談\|面接確約\|書類選考なし\|カジュアル\|オンラインで(?:お話\|ご説明)\|お話(?:し)?(?:できれば\|させて)\|interview\|casual (?:chat\|talk\|meeting)\|(?:quick\|short\|brief) (?:call\|chat)\|schedule a (?:call\|meeting)` |

フラグを足す・変えるときは、スクリプト・この表・`src/worker/sql/aiScout.ts`（`SCOUT_FEATURES` と SQL）・フィクスチャを一緒に直す。

### cms_ai_scout_sends（スカウト 1 通 = 1 行）
`PARTITION BY DATE_TRUNC(sent_date, MONTH)`、`CLUSTER BY industry_group, industry, template_id`。本文のメッセージが無いスカウトは入らない。

| 列 | 型 | 説明 |
|---|---|---|
| scout_id | INT64 | スカウト |
| template_id | STRING | 文面（`cms_ai_scout_templates`） |
| company_id | INT64 | 送った企業 |
| industry / industry_group | STRING | 送った企業の業界・まとまり |
| sent_date | DATE | 送信日（`scouts.sent_at`） |
| is_auto | BOOL | 自動スカウト |
| replied | BOOL | 興味あり返信があった（送信月基準。`from_status IN ('質問する', '開封のみ') AND to_status = '興味あり'`） |
| hired | BOOL | 採用（`scouts.application_status = '11.採用'`） |
| age_group | STRING | 受け取った人の年齢層（`member_profile_latest`。24歳以下 / 25-34歳 / 35-44歳 / 45-54歳 / 55歳以上 / (未入力)） |
| nationality_category | STRING | 日本国籍 / 日本国籍以外 / (未入力) |
| japanese_level / english_level | STRING | `1. なし` 〜 `6. ネイティヴ` / (未入力) |
| residence | STRING | 現住所: 都道府県 / 日本以外 / 日本（都道府県不明）/ (未入力)。`cms_scout_member_attributes_monthly` の `residence_prefecture` と同じ決め方（`member_details.country_of_residence`） |
| occupation_group | STRING | 最終経験職種の大分類（`member_profile_latest.last_occupation`。12 区分 + (未入力)） |

属性は**現在のプロフィール**（送った時点ではない）。未入力は、年齢層・国籍・語学・現住所で約 4%、職種で約 9%。Worker が出す選択肢は、直近 12 か月の送信が 50 通以上の値（未入力と「日本（都道府県不明）」を除く）: 年齢層 5・国籍 2・日本語 6・英語 6・現住所 48・職種 12。

### cms_ai_scout_drafts（CS が選んだ案。アプリが書く）
| 列 | 型 | 説明 |
|---|---|---|
| draft_id | STRING | 案の ID（D1 と同じ。1 案 = 1 行） |
| job_id | STRING | AI の依頼の ID |
| company_id | INT64 | 依頼した企業 |
| model_id / model_version | STRING / INT64 | 作ったモデルと版 |
| subject / body | STRING | CS が選んだ時点の件名・本文（差し込みは `{{…}}`。企業名は入れない） |
| chosen_at | TIMESTAMP | 選んだ日時 |
| updated_at | TIMESTAMP | 最後に書いた日時 |

### cms_ai_scout_draft_outcomes（案と送信実績の照合）
| 列 | 型 | 説明 |
|---|---|---|
| draft_id | STRING | 案（`cms_ai_scout_drafts` の全行） |
| matched | BOOL | 照合できた文面があるか（= 企業が使った） |
| matched_templates | INT64 | 照合できた文面の数 |
| sends / replies / hires | INT64 | その文面の、選んだ日以降の送信・興味あり返信・採用 |
| first_sent_on | DATE | 最初に送られた日 |
| refreshed_at | TIMESTAMP | 作成日時 |

照合: **同じ企業**が、選んだ日（JST）以降に**初めて**送った文面のうち、案の本文の「意味のある行」（空白を除いて 15 文字以上。差し込み `{{…}}` を含む行は除く）の **50% 以上**を、空白を除いた本文（置き換え前）の中にそのまま含むもの。2026-11-27 に試しの 3 行で確認（本文そのまま = 一致・送信数が文面と同じ / 行の半分超を書き換え = 不一致 / 無関係 = 不一致。試しの行は削除済み）。

## Worker の SA に付ける権限（表単位）
```bash
SA=serviceAccount:cms-bq-reader@bq-hgt.iam.gserviceaccount.com
for t in cms_ai_refresh_log cms_ai_scout_templates cms_ai_scout_sends cms_ai_scout_draft_outcomes; do
  bq add-iam-policy-binding --member=$SA --role=roles/bigquery.dataViewer bq-hgt:dwh.$t
done
bq add-iam-policy-binding --member=$SA --role=roles/bigquery.dataEditor bq-hgt:dwh.cms_ai_scout_drafts
```
付ける前は、Worker は例外にせず「データなし」で返す（選択肢は空・分析は null・書き込みは false。ログに理由）。

## 編集の入口
- 業界のまとまり → `scout_marts.sql` の対応表と `src/shared/ai/industryGroups.ts`
- 置き換え・特徴のフラグ → `scout_marts.sql` ステップ 05・07（この README の表も直す）
- 分析対象の決め方（範囲の広げ方・上位の取り方）→ `src/worker/sql/aiScout.ts` の `aiScoutBenchmarkQuery`
- 手元での実行: `bq --project_id=bq-hgt --location=asia-northeast1 query --use_legacy_sql=false --maximum_bytes_billed=30000000000 < bq/ai/scout_marts.sql`（1 回 約 20 GB）。実行記録は `SELECT * FROM dwh.cms_ai_refresh_log ORDER BY finished_at DESC LIMIT 5`

## 失敗時
`BEGIN … EXCEPTION` で `cms_ai_refresh_log` に `error` 行（`message` に理由）を残し、前日の表がそのまま残る。再実行は冪等（全件差し替え。`cms_ai_scout_drafts` は変えない）。

## テスト
`tests/worker/aiScoutData.test.ts`（SQL が `cms_ai_*` と `@param` だけ・業界の対応表が SQL と定数で一致・フィクスチャで契約の型を通る）。スキャン量は `npm run dryrun`（`scripts/bq-dryrun.ts`）。
