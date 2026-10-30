import type { BoardCompany, BoardMeta } from '../schema/board';
import type { ScoredCompany } from './score';
import { COMPANY_TYPES } from '../labels';

/** プロファイルの種別（アカウント種別として使う値）。DA / RPO / NW / 不明 は企業単位の判定で、アカウント種別では絞らない */
export const PROFILE_ACCOUNT_TYPES: readonly string[] = ['直接', '紹介', '派遣'];
/** 企業種別フィルタの既定: DA と RPO 以外（2026-10-30〜） */
export const DEFAULT_TYPE_FILTER: readonly string[] = COMPANY_TYPES.filter((t) => t !== 'DA' && t !== 'RPO');
export function isDefaultTypeFilter(types: readonly string[]): boolean {
  return types.length === DEFAULT_TYPE_FILTER.length && DEFAULT_TYPE_FILTER.every((t) => types.includes(t));
}

/**
 * 種別フィルタ・種別の件数・ボードの +種別 に使うアカウント種別。
 * 企業種別が 直接 / 紹介 / 派遣 のときだけ副アカウントの種別（直接 + 紹介 など）も含める。DA / RPO / NW / 不明 は企業種別だけ
 * （DA / RPO のプロファイルも company_type は 直接 / 紹介 なので、そのまま使うと「直接」で絞ったときに DA / RPO が混ざる）
 */
export function boardAccountTypes(c: Pick<BoardCompany, 'type' | 'accountTypes'>): string[] {
  if (!PROFILE_ACCOUNT_TYPES.includes(c.type)) return [c.type];
  return Array.from(new Set([c.type, ...c.accountTypes.filter((t) => PROFILE_ACCOUNT_TYPES.includes(t))]));
}

/** 契約終了の絞り込み: 30 日以内 / 60 日以内 / 90 日以上先（無期限を含む） */
export const ENDING_OPTIONS = ['30', '60', 'over90'] as const;
export type EndingFilter = (typeof ENDING_OPTIONS)[number];
export const ENDING_LABEL: Record<EndingFilter, string> = { '30': '30 日以内', '60': '60 日以内', over90: '90 日以上先' };
export function matchesEnding(daysToEnd: number | null, f: EndingFilter): boolean {
  if (f === 'over90') return daysToEnd === null || daysToEnd > 90;
  return daysToEnd !== null && daysToEnd >= 0 && daysToEnd <= Number(f);
}

/** 有無の絞り込み（求人掲載・スカウト送信）: あり（> 0）/ なし（= 0） */
export type YesNo = 'yes' | 'no';
export const YES_NO_LABEL: Record<YesNo, string> = { yes: 'あり', no: 'なし' };

export interface BoardFilters {
  mine: boolean;
  /** CS 担当（ownerKey の配列。空 = すべて） */
  owner: string[];
  type: string[];
  ending: EndingFilter | null;
  /** 求人掲載の有無（当月の掲載求人数 > 0 / = 0） */
  jobs: YesNo | null;
  /** スカウト送信の有無（当月の送信数 > 0 / = 0） */
  sent: YesNo | null;
  q: string;
}

export const DEFAULT_FILTERS: BoardFilters = { mine: false, owner: [], type: [...DEFAULT_TYPE_FILTER], ending: null, jobs: null, sent: null, q: '' };

export const NO_OWNER_KEY = '(未設定)';
/** 担当の絞り込みキー（メール優先。無ければ名前、どちらも無ければ (未設定)） */
export function ownerKey(c: { owner: { email: string | null; name: string | null } }): string {
  return c.owner.email?.toLowerCase() || c.owner.name || NO_OWNER_KEY;
}

/** Worker が /api/board の応答に含める契約状態（画面は isContracted でさらに契約中に絞る） */
export const CURRENT_STATES = new Set(['active', 'ending_30d', 'upcoming', 'ended_recent']);

/**
 * 契約中の企業だけを表示・カウントする。
 * 当月: 今日時点で契約中（state = active / ending_30d）。過去月: その月に契約期間が重なっていた企業（is_contracted_in_month）
 */
export function isContracted(c: Pick<BoardCompany, 'state' | 'm'>, meta: Pick<BoardMeta, 'isCurrentMonth'>): boolean {
  return meta.isCurrentMonth ? c.state === 'active' || c.state === 'ending_30d' : c.m.contracted;
}

export function normalizeQuery(s: string): string {
  return s.normalize('NFKC').toLowerCase().replace(/\s+/g, '');
}

/** 各フィルタの「絞らない」値（フィルタ同士の連動で、その項目だけ外すときに使う） */
const NEUTRAL_FILTER: BoardFilters = { mine: false, owner: [], type: [], ending: null, jobs: null, sent: null, q: '' };

/**
 * フィルタ同士の連動: except の項目だけ外して絞り込む。
 * 選択肢（CS 担当・企業種別・担当 = 自分 の件数）は「その項目以外のフィルタを通った契約中の企業」から作る
 * （例: 企業種別で 直接 だけを選んでいると、CS 担当の選択肢は 直接 の企業の担当だけになる）
 */
export function filterCompaniesExcept(rows: ScoredCompany[], f: BoardFilters, meta: Pick<BoardMeta, 'isCurrentMonth'>, except: keyof BoardFilters): ScoredCompany[] {
  return filterCompanies(rows, { ...f, [except]: NEUTRAL_FILTER[except] }, meta);
}

export function filterCompanies(rows: ScoredCompany[], f: BoardFilters, meta: Pick<BoardMeta, 'isCurrentMonth'>): ScoredCompany[] {
  const q = normalizeQuery(f.q);
  return rows.filter((r) => {
    const c = r.c;
    if (!isContracted(c, meta)) return false;
    if (f.mine && !c.isMine) return false;
    if (f.owner.length && !f.owner.includes(ownerKey(c))) return false;
    // 種別はいずれかのアカウント種別（直接 + 紹介 など）が一致すれば通す。DA / RPO / NW / 不明 は企業種別だけで判定（boardAccountTypes）。空 = すべて
    if (f.type.length && !boardAccountTypes(c).some((t) => f.type.includes(t))) return false;
    if (f.ending !== null && !matchesEnding(c.contract.daysToEnd, f.ending)) return false;
    if (f.jobs !== null && (c.m.jobs > 0) !== (f.jobs === 'yes')) return false;
    if (f.sent !== null && (c.m.sent > 0) !== (f.sent === 'yes')) return false;
    if (q && !normalizeQuery(c.name).includes(q) && !String(c.id).includes(q)) return false;
    return true;
  });
}

/** ボードの列（実数表示）。metric はツールチップに式を出すための参照（色付けには使わない） */
export interface BoardColumn {
  key: string;
  label: string;
  group: string;
  /** 色付けに使う指標（src/shared/metrics/definitions.ts） */
  metric?: string;
}
export const BOARD_COLUMNS: BoardColumn[] = [
  { key: 'jobs', label: '掲載 / 枠', group: '応募', metric: 'job_utilization' },
  { key: 'views', label: '閲覧', group: '応募', metric: 'views_per_active_job' },
  { key: 'apps', label: '応募', group: '応募', metric: 'apps_per_active_job' },
  { key: 'sent', label: '送信 / 枠', group: 'スカウト', metric: 'scout_utilization' },
  { key: 'intReply', label: '興味あり返信', group: 'スカウト' },
  { key: 'inSel', label: '選考中', group: '選考' },
  { key: 'hires', label: '採用', group: '選考', metric: 'hires' },
  { key: 'login', label: '最終ログイン', group: '接点', metric: 'login_days' },
  { key: 'daysToEnd', label: '契約残', group: '契約' },
];

/** 列キー → 並べ替えに使う生の値 */
export const RAW_SORT: Record<string, (s: ScoredCompany) => number | null> = {
  jobs: (s) => s.c.m.jobs,
  views: (s) => s.c.m.views,
  apps: (s) => s.c.m.apps,
  sent: (s) => s.c.m.sent,
  intReply: (s) => s.c.m.intReply,
  inSel: (s) => s.c.m.inSel,
  hires: (s) => s.c.m.hires,
  login: (s) => (s.c.login.daysSince === null ? null : -s.c.login.daysSince),
  daysToEnd: (s) => s.c.contract.daysToEnd,
};

export const SORT_KEYS = ['name', 'type', 'owner', 'contractEnd', 'pace', ...Object.keys(RAW_SORT)] as const;

/** sort: 'name' | 'type' | 'owner' | 'contractEnd' | 'pace' | 列キー（RAW_SORT）。先頭の '-' で降順 */
export function sortCompanies(rows: ScoredCompany[], sort: string): ScoredCompany[] {
  const desc = sort.startsWith('-');
  const key = desc ? sort.slice(1) : sort;
  const dir = desc ? -1 : 1;
  const num = (v: number | null | undefined) => (v === null || v === undefined || Number.isNaN(v) ? (desc ? -Infinity : Infinity) : v);
  const cmp = (a: ScoredCompany, b: ScoredCompany): number => {
    switch (key) {
      case 'name':
        return a.c.name.localeCompare(b.c.name, 'ja') * dir;
      case 'type':
        return a.c.type.localeCompare(b.c.type, 'ja') * dir;
      case 'owner':
        return (a.c.owner.name ?? '').localeCompare(b.c.owner.name ?? '', 'ja') * dir;
      case 'contractEnd':
        return (num(a.c.contract.daysToEnd) - num(b.c.contract.daysToEnd)) * dir;
      case 'pace':
        return (num(a.pace.ratio) - num(b.pace.ratio)) * dir;
      default: {
        const raw = RAW_SORT[key];
        return raw ? (num(raw(a)) - num(raw(b))) * dir : 0;
      }
    }
  };
  return [...rows].sort((a, b) => cmp(a, b) || a.c.name.localeCompare(b.c.name, 'ja'));
}

export interface KpiTile {
  key: string;
  label: string;
  value: number | null;
  unit: 'count' | 'rate';
  /** 件数の右に添える割合（スカウト利用社数の利用率） */
  rate?: number | null;
  /** 契約体系ごとの内訳（左 = 広告掲載、右 = 成功報酬。unknown は内訳に入れず合計にだけ含める） */
  split: { ad: number | null; success: number | null; unknown: number };
  /** クリックで適用するフィルタ */
  filter: Partial<BoardFilters> | null;
  tone: 'neutral' | 'bad' | 'warn' | 'good';
}

export function median(xs: number[]): number | null {
  const a = xs.filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
  if (!a.length) return null;
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid] : (a[mid - 1] + a[mid]) / 2;
}

/** 企業の月次系列を足し合わせる（KPI タイルのスパークライン） */
export type TrendKey = 'sent' | 'int' | 'apps' | 'views' | 'jobs' | 'hires';

export function portfolioTrend(rows: ScoredCompany[], key: TrendKey): number[] {
  const out: number[] = [];
  for (const r of rows) {
    const t: number[] = r.c.trend[key];
    t.forEach((v, i) => (out[i] = (out[i] ?? 0) + (v ?? 0)));
  }
  return out;
}

export const NO_LOGIN_DAYS = 30;

/** 30 日以上ログインなし（記録なし = 2026-05-15 以降ログインなし も含む） */
export function isNoLogin(c: Pick<BoardCompany, 'login'>): boolean {
  return c.login.daysSince === null || c.login.daysSince >= NO_LOGIN_DAYS;
}

/** アクティブ企業 = CT 画面への最終ログインが 30 日以内（記録なしは含まない） */
export function isActiveLogin(c: Pick<BoardCompany, 'login'>): boolean {
  return c.login.daysSince !== null && c.login.daysSince < NO_LOGIN_DAYS;
}

/** KPI タイル（4 枚: 契約企業 / アクティブ企業数 / スカウト利用社数（利用率）/ スカウト消化率）。数字だけを出す */
/** スカウト消化率 = 月間送信実績の合計 ÷ 月間送信枠の合計（枠のある契約企業。枠の期間が「契約」の企業は除く） */
function scoutUtilOf(rows: ScoredCompany[]): { util: number | null; sentSum: number; limitSum: number; n: number } {
  const withLimit = rows.filter((r) => r.c.limits.period === 'month' && r.c.limits.scout !== null && r.c.limits.scout > 0);
  const sentSum = withLimit.reduce((a, r) => a + r.c.m.sent, 0);
  const limitSum = withLimit.reduce((a, r) => a + (r.c.limits.scout ?? 0), 0);
  return { util: limitSum > 0 ? sentSum / limitSum : null, sentSum, limitSum, n: withLimit.length };
}

export function kpiStrip(rows: ScoredCompany[], meta: BoardMeta): KpiTile[] {
  const contracted = rows.filter((r) => isContracted(r.c, meta));
  const ad = contracted.filter((r) => r.c.contractKind === 'ad');
  const success = contracted.filter((r) => r.c.contractKind === 'success');
  const unknown = contracted.length - ad.length - success.length;
  const active = (xs: ScoredCompany[]) => xs.filter((r) => isActiveLogin(r.c)).length;
  // スカウト利用率 = 1 件以上送信している企業数 ÷ 契約中の企業数
  const using = (xs: ScoredCompany[]) => xs.filter((r) => r.c.m.sent > 0).length;
  const usage = contracted.length ? using(contracted) / contracted.length : null;
  const u = scoutUtilOf(contracted);
  const utilRatio = u.util !== null && meta.bizDays.rate > 0 ? u.util / meta.bizDays.rate : null;
  const count = (xs: ScoredCompany[], f: (ys: ScoredCompany[]) => number) => (xs.length ? f(xs) : null);
  return [
    { key: 'contracted', label: '契約企業', value: contracted.length, unit: 'count', filter: null, tone: 'neutral', split: { ad: ad.length, success: success.length, unknown } },
    { key: 'active', label: `アクティブ企業数（最終ログイン${NO_LOGIN_DAYS}日以内）`, value: active(contracted), unit: 'count', filter: null, tone: 'neutral', split: { ad: count(ad, active), success: count(success, active), unknown } },
    { key: 'scoutUsers', label: 'スカウト利用社数（利用率）', value: using(contracted), unit: 'count', rate: usage, filter: null, tone: usage === null ? 'neutral' : usage < 0.5 ? 'bad' : usage < 0.7 ? 'warn' : 'good', split: { ad: count(ad, using), success: count(success, using), unknown } },
    { key: 'scoutUtil', label: 'スカウト消化率', value: u.util, unit: 'rate', filter: null, tone: utilRatio === null || !meta.isCurrentMonth ? 'neutral' : utilRatio < 0.8 ? 'bad' : utilRatio < 1 ? 'warn' : 'good', split: { ad: scoutUtilOf(ad).util, success: scoutUtilOf(success).util, unknown } },
  ];
}
