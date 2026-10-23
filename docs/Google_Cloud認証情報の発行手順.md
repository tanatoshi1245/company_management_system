---
tags: [domain/company-behavior, layer/application, type/security-standard]
related:
  - "[[README]]"
  - "[[docs/デプロイ手順]]"
  - "[[docs/セキュリティチェックリスト]]"
status: active
---

# Google Cloud 認証情報の発行手順（SA・SA 鍵・OAuth クライアント）— アプリ共通

本アプリ（`cms-bq-reader@bq-hgt`）の発行手順を、**今後の新規アプリでもそのまま使える形**にまとめたもの。
根拠は claude_analysis `04_アプリケーション/セキュリティ要件.md` §3（用途別に新規作成・最小権限・Default Compute SA と `roles/editor` / `roles/owner` の新規利用禁止・SA 鍵は最後の手段で 90 日ローテーション・台帳登録）。
コンソール / `gcloud` / `bq` の作業はユーザーが行う（Claude のセッションからは実行できない）。所要 10 分。

## 0. 先に決めること（新規アプリごと）

| 決めること | 本アプリの値 | 考え方 |
|---|---|---|
| SA 名 | `cms-bq-reader` | `<アプリ略称>-<役割>`。1 アプリ 1 SA。他アプリと共用しない |
| 読む対象 | `bq-hgt.dwh.cms_*` のうち Worker が読む 9 表 | **アプリが読む表だけ**に絞る。生テーブル（`scouts` 等）を読ませない = マートを作って読ませる |
| 書く対象 | なし | 読み取り専用にする。書き込み（マート更新）はスケジュールドクエリ側の SA（既存の `id-69-213@`）に任せる |
| 鍵の要否 | 必要（Workers は SA をアタッチできない） | Cloud Run なら SA をアタッチして鍵を作らない。GitHub Actions なら Workload Identity Federation |
| 鍵の置き場所 | Workers Secret `BQ_SA_KEY` | コード・フロント・リポジトリ・チャット・スプレッドシートには置かない |
| OAuth クライアント | 本アプリ専用（ウェブ アプリケーション） | 1 アプリ 1 クライアント。リダイレクト URI は本番 URL + `/auth/callback` だけ |

## 1. 権限の設計（何を付けるか・付けないか）

BigQuery を「読むだけ」のアプリに必要なのは **2 つだけ**。

| 付ける | ロール | 対象 | 理由 |
|---|---|---|---|
| ① クエリを実行する | `roles/bigquery.jobUser` | プロジェクト `bq-hgt` | `jobs.query` を呼ぶのに `bigquery.jobs.create` が要る。プロジェクト単位でしか付かない。データは読めない |
| ② 表を読む | `roles/bigquery.dataViewer` | **表単位**（アプリが読む表だけ） | `tables.getData`。データセット単位だと `dwh` の全表（会員・応募など）が読めてしまう |

| 付けない | 理由 |
|---|---|
| `roles/bigquery.dataEditor` / `dataOwner` / `admin` | アプリは書かない。マートの更新はスケジュールドクエリの SA が行う |
| `roles/bigquery.user` | データセット作成・ジョブ一覧閲覧が含まれ jobUser より広い |
| `roles/editor` / `roles/owner` | 禁止（セキュリティ要件 §3.1） |
| `roles/secretmanager.secretAccessor` | アプリは Secret Manager を読まない（鍵は Workers Secret に入れる） |
| Default Compute SA の流用 | 禁止（§3.1） |

本アプリで dataViewer を付ける 9 表（`src/worker/sql/*.ts` が参照する表。`cms_contract_snapshot_daily` / `cms_status_snapshot_daily` / `cms_company_login_daily` / `cms_dim_industry_alias` は Worker が読まないので付けない）:
`cms_company_master`, `cms_company_monthly`, `cms_company_daily_usage`, `cms_scout_cohort_status`, `cms_application_cohort_status`, `cms_scout_member_attributes_monthly`, `cms_company_login`, `cms_industry_benchmark_monthly`, `cms_refresh_log`

> 表単位の IAM は `CREATE OR REPLACE TABLE` で表を作り直しても残る（表の IAM ポリシーは表名に付く）。マートに表を足したら、この一覧と IAM の両方を更新する。

## 2. SA と鍵の発行（`gcloud` / `bq`。Cloud Shell か、`gcloud auth login` 済みの手元で）

```bash
PROJECT=bq-hgt
SA=cms-bq-reader                                   # 新規アプリでは変える
SA_EMAIL=$SA@$PROJECT.iam.gserviceaccount.com
TABLES="cms_company_master cms_company_monthly cms_company_daily_usage cms_scout_cohort_status cms_application_cohort_status cms_scout_member_attributes_monthly cms_company_login cms_industry_benchmark_monthly cms_refresh_log"

gcloud config set project $PROJECT

# (1) SA を作る（説明にアプリ名と用途を書く。棚卸しで何の SA か分かるように）
gcloud iam service-accounts create $SA \
  --display-name="契約企業マネジメントシステム BQ 読み取り" \
  --description="Cloudflare Worker company-management-system が dwh.cms_* を読む専用。読み取りのみ。鍵は Workers Secret BQ_SA_KEY"

# (2) ① クエリ実行（プロジェクト単位）
gcloud projects add-iam-policy-binding $PROJECT \
  --member=serviceAccount:$SA_EMAIL --role=roles/bigquery.jobUser --condition=None

# (3) ② 表単位の読み取り（bq add-iam-policy-binding は表・ビュー専用。データセットには使えない）
for t in $TABLES; do
  bq add-iam-policy-binding --member=serviceAccount:$SA_EMAIL --role=roles/bigquery.dataViewer $PROJECT:dwh.$t
done

# (4) 確認: プロジェクトの付与が jobUser だけ、表に dataViewer が付いていること
gcloud projects get-iam-policy $PROJECT --flatten="bindings[].members" \
  --filter="bindings.members:serviceAccount:$SA_EMAIL" --format="table(bindings.role)"
bq get-iam-policy $PROJECT:dwh.cms_company_master

# (5) 鍵を発行（1 本だけ）。キー ID と発行日を台帳に記録
gcloud iam service-accounts keys create /tmp/$SA.json --iam-account=$SA_EMAIL
gcloud iam service-accounts keys list --iam-account=$SA_EMAIL --managed-by=user   # KEY_ID と CREATED_AT を控える

# (6) 1 行の JSON にして Workers Secret BQ_SA_KEY に貼る（Cloudflare → Worker → Settings → Variables and Secrets → Secret）
python3 -c 'import json,sys; print(json.dumps(json.load(open(sys.argv[1]))))' /tmp/$SA.json

# (7) 貼り終えたらローカルの鍵を消す
rm /tmp/$SA.json
```

データセット単位（`dwh` 全体）にしたい場合だけ: BigQuery コンソール → データセット `dwh` → **共有 → 権限 → プリンシパルを追加** で SA に `BigQuery データ閲覧者` を付ける（`bq add-iam-policy-binding` はデータセットに使えない）。ただし `dwh` には会員・応募などの生データがあるので、**アプリが読む表だけ**にするのが既定。

### 動作確認（鍵を Secret に入れてデプロイした後）

- `/api/health` の `bqKeyConfigured: true`
- ボードが表示される（`accessDenied` なら ② の表が足りない。Worker → Logs の `BigQuery error [...]` に表名が出る）
- 手元で `BQ_SA_KEY_FILE=/tmp/<SA>.json npm run dryrun` を鍵を消す前に実行すると、全クエリの dry run で権限とスキャン量を一度に確認できる

## 3. OAuth クライアント（ドメイン認証ログイン用。1 アプリ 1 クライアント）

Google Cloud Console → `bq-hgt` → **API とサービス → Google Auth Platform**。同意画面（ブランディング / 対象）は営業行動モニタリングで設定済み（外部 / 本番環境、スコープは `openid` / `email` / `profile` のみ）なので、**クライアントだけ作る**。

1. **クライアント → クライアントを作成**
2. アプリケーションの種類: **ウェブ アプリケーション**、名前: `<アプリ名>（Worker）`
3. 承認済みのリダイレクト URI: `https://<Worker名>.<サブドメイン>.workers.dev/auth/callback` だけ（ローカル検証で `http://localhost:5173/auth/callback` を足したら、終わったら消す）
4. 作成 → **クライアント ID** と **クライアント シークレット** を控える（シークレットはこの画面でしか見えない。漏らしたら「シークレットをリセット」）
5. Workers Secret に `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` と、`SESSION_SECRET`（`openssl rand -base64 32`）を入れて Deploy

## 4. 台帳に記録（発行と同時に）

claude_analysis `04_アプリケーション/セキュリティ要件.md` §5.2 に 2 行（SA 鍵・OAuth クライアント）。本アプリの雛形行は追記済みなので、**キー ID・発行日**を埋める。

| 識別子 | 種別 | 用途 | 格納場所 | 権限 | 状態・備考 |
|---|---|---|---|---|---|
| `cms-bq-reader@bq-hgt.iam.gserviceaccount.com`（キー ID: ____、発行 2026-__-__） | SA キー JSON | 契約企業マネジメントシステムの BQ 読み取り | Workers Secret `BQ_SA_KEY` | `roles/bigquery.jobUser`（プロジェクト）+ `roles/bigquery.dataViewer`（`dwh.cms_*` 9 表） | 次回ローテーション 2027-__-__（90 日後） |
| OAuth クライアント `契約企業マネジメントシステム（Worker）` | OAuth 2.0 クライアント | ドメイン認証ログイン | Workers Secret | スコープ openid / email / profile | リダイレクト URI は本番 URL のみ |

## 5. ローテーション（90 日ごと）と失効

```bash
SA_EMAIL=cms-bq-reader@bq-hgt.iam.gserviceaccount.com
# 新しい鍵を作って Secret を貼り替え、動作確認してから古い鍵を消す（順番を逆にすると一時的に止まる）
gcloud iam service-accounts keys create /tmp/new.json --iam-account=$SA_EMAIL
python3 -c 'import json; print(json.dumps(json.load(open("/tmp/new.json"))))'   # → Workers Secret BQ_SA_KEY を更新して Deploy → /api/health と画面を確認
gcloud iam service-accounts keys list --iam-account=$SA_EMAIL --managed-by=user
gcloud iam service-accounts keys delete <古い KEY_ID> --iam-account=$SA_EMAIL
rm /tmp/new.json
```

| 事象 | 対処 |
|---|---|
| 鍵を漏らした疑い | 上の手順で新鍵 → Secret 更新 → 旧鍵削除。`gcloud logging read 'protoPayload.authenticationInfo.principalEmail="cms-bq-reader@bq-hgt.iam.gserviceaccount.com"' --freshness=7d` で直近の利用を確認 |
| アプリを廃止する | Secret を削除 → `gcloud iam service-accounts delete $SA_EMAIL`（IAM バインディングも消える）→ OAuth クライアントを削除 → 台帳の行を「削除済み」に |
| 表を足した | §1 の一覧と `for t in …` を更新して dataViewer を追加 |

## 6. 新規アプリでの使い回し方

1. §0 の表を埋める（SA 名・読む表・鍵の要否・置き場所）
2. §2 のスクリプトの `SA` と `TABLES` を差し替えて実行
3. §3 で OAuth クライアントを作る（ログインが要るアプリだけ）
4. §4 の台帳に 2 行追加、アプリの `docs/デプロイ手順.md` から本ファイルを参照
5. Cloud Run で動かすアプリは鍵を作らず SA をアタッチ（`--service-account`）、GitHub Actions は Workload Identity Federation。Workers だけが鍵 JSON の例外
