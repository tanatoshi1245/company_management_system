/**
 * 指標レジストリ。画面のラベル・式・元の列・注記の唯一の定義場所（docs/指標定義.md とヘルプ画面はここから）。
 * polarity: higher = 高いほど良い / lower = 低いほど良い
 */
export type MetricGroup = 'usage' | 'response' | 'selection' | 'touch';
export type MetricUnit = 'count' | 'rate' | 'ratio' | 'days';

export interface MetricDef {
  key: string;
  label: string;
  short: string;
  group: MetricGroup;
  unit: MetricUnit;
  polarity: 'higher' | 'lower';
  formula: string;
  source: string;
  caveats: string[];
  /** 業界ベンチマーク表（cms_industry_benchmark_monthly.metric）の名前。無ければ業界比の対象外 */
  benchMetric?: string;
  /** 目標の項目名（company_targets）。無ければ目標比の対象外 */
  targetKey?: 'scout_sent' | 'interested' | 'applications' | 'views' | 'hires';
  decimals: number;
}

export const METRICS: readonly MetricDef[] = [
  { key: 'job_utilization', label: '求人枠消化率', short: '求人枠', group: 'usage', unit: 'rate', polarity: 'higher', formula: '掲載中の求人数（set_id で日英重複排除）÷ 求人枠数', source: 'cms_company_monthly.active_jobs_eom / cms_company_master.job_posting_limit', caveats: ['set_id_dedup'], benchMetric: 'job_utilization', decimals: 0 },
  { key: 'scout_utilization', label: 'スカウト枠消化率', short: 'スカウト', group: 'usage', unit: 'rate', polarity: 'higher', formula: '当月のスカウト送信数 ÷ スカウト枠数（月間枠）。ペース = 消化率 ÷ 営業日消化率', source: 'cms_company_monthly.scout_sent / cms_company_master.scout_limit', caveats: ['scout_quota_period', 'scout_lag'], benchMetric: 'scout_utilization', targetKey: 'scout_sent', decimals: 0 },
  { key: 'reply_rate', label: '興味あり返信率', short: '返信率', group: 'response', unit: 'rate', polarity: 'higher', formula: '当月に送ったスカウトのうち興味あり返信があった数 ÷ 送信数（返信日は問わない）', source: 'cms_company_monthly.interested_by_send_month / scout_sent', caveats: [], benchMetric: 'reply_rate', targetKey: 'interested', decimals: 1 },
  { key: 'apps_per_active_job', label: '応募 / 求人', short: '応募/求人', group: 'response', unit: 'ratio', polarity: 'higher', formula: '当月の応募数 ÷ 掲載中の求人数', source: 'cms_company_monthly.applications / active_jobs_eom', caveats: [], benchMetric: 'apps_per_active_job', targetKey: 'applications', decimals: 1 },
  { key: 'views_per_active_job', label: '閲覧 / 求人', short: '閲覧/求人', group: 'response', unit: 'ratio', polarity: 'higher', formula: '当月の求人閲覧数 ÷ 掲載中の求人数', source: 'cms_company_monthly.job_views / active_jobs_eom', caveats: [], benchMetric: 'views_per_active_job', targetKey: 'views', decimals: 0 },
  { key: 'in_selection', label: '選考中', short: '選考中', group: 'selection', unit: 'count', polarity: 'higher', formula: '当月の応募 + 当月に興味あり返信があったスカウトのうち、現在 面接調整中〜最終面接 の件数', source: 'cms_company_monthly.in_selection', caveats: ['status_current_only'], decimals: 0 },
  { key: 'hires', label: '採用', short: '採用', group: 'selection', unit: 'count', polarity: 'higher', formula: '11.採用 を会員 × 企業で重複排除し、応募月 / 興味あり返信月に帰属', source: 'cms_company_monthly.hires', caveats: ['hire_month', 'status_current_only'], benchMetric: 'hires', targetKey: 'hires', decimals: 0 },
  { key: 'login_days', label: 'ログイン日数（30 日）', short: 'ログイン', group: 'touch', unit: 'days', polarity: 'higher', formula: '直近 30 日に企業管理ツール（CT）にログインした日数（GA4 get_ID。直接・紹介・派遣の企業は社内メンバー @daijob.com のログインを除く）', source: 'cms_company_login.login_days_30d', caveats: ['login_from'], benchMetric: 'login_days', decimals: 0 },
];

export const METRIC_BY_KEY: Record<string, MetricDef> = Object.fromEntries(METRICS.map((m) => [m.key, m]));

/** ヒートマップの列（業界比） */
export const HEAT_COLUMNS_INDUSTRY: string[] = ['job_utilization', 'scout_utilization', 'reply_rate', 'apps_per_active_job', 'views_per_active_job', 'in_selection', 'hires', 'login_days'];
/** ヒートマップの列（目標比）。目標が登録できる指標だけ */
export const HEAT_COLUMNS_TARGET: string[] = ['scout_utilization', 'reply_rate', 'apps_per_active_job', 'views_per_active_job', 'hires'];

export const GROUP_LABEL: Record<MetricGroup, string> = { usage: '利用状況', response: '反応', selection: '選考', touch: '接点' };

/** 派生の定義（指標ではないが画面で使う式） */
export const DERIVED_DEFINITIONS: { key: string; label: string; formula: string }[] = [
  { key: 'biz_rate', label: '営業日消化率', formula: '当月の経過営業日（データ最終日まで。土日・祝日・年末年始 12/29〜1/3 を除く）÷ 当月の営業日数' },
  { key: 'pace', label: 'ペース', formula: 'スカウト枠消化率 ÷ 営業日消化率。0.8 未満 = 遅れ、0.8〜1.0 = 注意、1.0〜1.2 = 順調、1.2 超 = 前倒し。経過営業日が 3 日未満は判定しない' },
  { key: 'expected', label: '期待値（目標比）', formula: '月の目標 × 営業日消化率。達成率 = 実績 ÷ 期待値' },
  { key: 'bench_ratio', label: '業界比', formula: '実績 ÷ 同業種・同種別（契約中企業）の当月中央値。5 社未満なら業種全体 → 種別全体 → 全体の順で代替' },
  { key: 'heat_scale', label: 'ヒートマップの 5 段階', formula: '比率 < 0.5 = −2、0.5〜0.8 = −1、0.8〜1.2 = 0、1.2〜1.5 = +1、≥ 1.5 = +2。「低いほど良い」指標は符号を反転' },
  { key: 'health', label: '企業ヘルス', formula: '各指標のスコアの重み付き平均（スカウト 2、返信・応募・採用 1、閲覧 0.5）を四捨五入。要注意 = −2〜−1、注意 = 0 で最低スコアが −1 以下、順調 = それ以外' },
];
