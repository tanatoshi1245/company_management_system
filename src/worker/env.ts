/** Worker に渡る変数・Secret・バインディング（wrangler.jsonc の vars / d1_databases と Cloudflare ダッシュボードの Secrets） */
export interface Env {
  ASSETS: Fetcher;
  /** D1（目標・企業設定・監査ログ・app_meta）。未バインドなら書き込み系 API は 503 storage */
  CMS_DB?: D1Database;
  BQ_PROJECT: string;
  BQ_LOCATION: string;
  /** '1' で BigQuery を呼ばずフィクスチャ（サンプルデータ）で動く。未ログインでも閲覧できる（読み取り専用） */
  BQ_MOCK?: string;
  /** 専用 SA（cms-bq-reader@bq-hgt）の鍵 JSON（Secret） */
  BQ_SA_KEY?: string;
  /** Worker 内蔵の Google ログイン（3 つとも Secret）。GOOGLE_CLIENT_ID があればこの方式。無くて BQ_MOCK も 1 でなければ fail-closed（503） */
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  /** セッション Cookie の署名鍵（32 文字以上。`openssl rand -base64 32`） */
  SESSION_SECRET?: string;
  /** セッションの長さ（秒）。既定 604800（7 日） */
  SESSION_TTL_SEC?: string;
  /** 個別に許可するメール（カンマ区切り。`@partner.example` のようにドメインも書ける） */
  ALLOWED_EMAILS?: string;
  /** 許可するメールドメイン（wrangler.jsonc の vars で `daijob.com`） */
  ALLOWED_EMAIL_DOMAINS?: string;
  /** マート応答のキャッシュ上限（秒）。既定は次回 08:30 JST まで */
  CACHE_TTL_SEC?: string;
  /** CS 担当の既定の出所: sales_staff（既定。企業管理ツール active_companies）/ sf_account_owner / sf_contract_owner。マートの owner_source と合わせる */
  OWNER_SOURCE?: string;
  /** 業界ベンチマークを使う最小企業数（既定 5） */
  BENCH_MIN_N?: string;
  /** モック時のログイン者メール（担当=自分 の確認用） */
  DEV_USER_EMAIL?: string;
  APP_ENV?: string;
  /** AI 機能（docs/AI機能.md）: Vertex AI のプロジェクトと location（wrangler.jsonc の vars。`bq-hgt`・`global`） */
  VERTEX_PROJECT?: string;
  VERTEX_LOCATION?: string;
  /** AI 機能: Vertex AI を呼ぶ SA の鍵 JSON（Secret。無ければ BQ_SA_KEY を使う。/api/health・/api/ai/config に値を出さない） */
  VERTEX_SA_KEY?: string;
  /** AI 機能 ② スカウト: 3 つのモデルが使う生成モデルの ID（`a=…,b=…,c=…`。vars） */
  AI_SCOUT_ENGINES?: string;
  /** AI 機能: 分析の要点とチューニングに使う生成モデルの ID（vars） */
  AI_INSIGHT_ENGINE?: string;
  /** AI 機能の停止スイッチ。"1" のときだけ AI 機能が動く（既定は停止。src/worker/ai/enabled.ts） */
  AI_ENABLED?: string;
  /** AI 機能 ② スカウト: 会員 ID から作る機能。候補者の属性を AI へ渡すので、確認が済むまで閉じる。"1" のときだけ開く（既定は閉じる。src/worker/ai/enabled.ts の aiScoutMemberEnabled） */
  AI_SCOUT_MEMBER?: string;
  /** AI 機能: 管理者のメール（カンマ区切り）。モデルの作り方（プレイブック）を見て、検証・チューニングを実行できる人。未設定なら誰も管理者にならない */
  AI_ADMIN_EMAILS?: string;
}

export function isMock(env: Env): boolean {
  return env.BQ_MOCK === '1' || env.BQ_MOCK === 'true';
}

export function intVar(v: string | undefined, dflt: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : dflt;
}
