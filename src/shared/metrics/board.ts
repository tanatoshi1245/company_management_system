import type { BoardCompany, BoardMeta } from '../schema/board';
import type { ScoredCompany } from './score';

/** 契約終了の絞り込み: 30 日以内 / 60 日以内 / 90 日以上先（無期限を含む） */
export const ENDING_OPTIONS = ['30', '60', 'over90'] as const;
export type EndingFilter = (typeof ENDING_OPTIONS)[number];
export const ENDING_LABEL: Record<EndingFilter, string> = { '30': '30 日以内', '60': '60 日以内', over90: '90 日以上先' };
export function matchesEnding(daysToEnd: number | null, f: EndingFilter): boolean {
  if (f === 'over90') return daysToEnd === null || daysToEnd > 90;
  return daysToEnd !== null && daysToEnd >= 0 && daysToEnd <= Number(f);
}

export interface BoardFilters {
  mine: boolean;
  /** CS 担当（ownerKey の配列。空 = すべて） */
  owner: string[];
  type: string[];
  ending: EndingFilter | null;
  q: string;
}

export const DEFAULT_FILTERS: BoardFilters = { mine: false, owner: [], type: [], ending: null, q: '' };

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

export function filterCompanies(rows: ScoredCompany[], f: BoardFilters, meta: Pick<BoardMeta, 'isCurrentMonth'>): ScoredCompany[] {
  const q = normalizeQuery(f.q);
  return rows.filter((r) => {
    const c = r.c;
    if (!isContracted(c, meta)) return false;
    if (f.mine && !c.isMine) return false;
    if (f.owner.length && !f.owner.includes(ownerKey(c))) return false;
    if (f.type.length && !f.type.includes(c.type)) return false;
    if (f.ending !== null && !matchesEnding(c.contract.daysToEnd, f.ending)) return false;
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
  { key: 'jobs', label: '掲載 / 枠', group: '求人', metric: 'job_utilization' },
  { key: 'views', label: '閲覧', group: '反応', metric: 'views_per_active_job' },
  { key: 'apps', label: '応募', group: '反応', metric: 'apps_per_active_job' },
  { key: 'sent', label: '送信 / 枠', group: 'スカウト', metric: 'scout_utilization' },
  { key: 'intReply', label: '返信（当月）', group: 'スカウト' },
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
  sub: string;
  /** 13 か月 + 当月のスパークライン（古い順） */
  spark: number[];
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

export function kpiStrip(rows: ScoredCompany[], meta: BoardMeta): KpiTile[] {
  const contracted = rows.filter((r) => isContracted(r.c, meta));
  const behind = rows.filter((r) => r.pace.status === 'behind');
  const noLogin = rows.filter((r) => isNoLogin(r.c));
  // スカウト消化率 = 月間送信実績の合計 ÷ 月間送信枠の合計（枠のある契約企業）
  const withLimit = contracted.filter((r) => r.c.limits.period === 'month' && r.c.limits.scout !== null && r.c.limits.scout > 0);
  const sentSum = withLimit.reduce((a, r) => a + r.c.m.sent, 0);
  const limitSum = withLimit.reduce((a, r) => a + (r.c.limits.scout ?? 0), 0);
  const util = limitSum > 0 ? sentSum / limitSum : null;
  const utilRatio = util !== null && meta.bizDays.rate > 0 ? util / meta.bizDays.rate : null;
  // スカウト利用率 = 1 件以上送信している企業数 ÷ 契約中の企業数
  const using = contracted.filter((r) => r.c.m.sent > 0).length;
  const usage = contracted.length ? using / contracted.length : null;
  return [
    { key: 'contracted', label: '契約企業', value: contracted.length, unit: 'count', sub: `${meta.month.replace('-', '年')}月に契約中`, spark: portfolioTrend(rows, 'sent'), filter: null, tone: 'neutral' },
    { key: 'scoutUtil', label: 'スカウト消化率', value: util, unit: 'rate', sub: `送信 ${sentSum.toLocaleString('ja-JP')} / 枠 ${limitSum.toLocaleString('ja-JP')}（枠あり ${withLimit.length} 社）${meta.isCurrentMonth ? `・営業日 ${Math.round(meta.bizDays.rate * 100)}% 経過` : ''}`, spark: portfolioTrend(rows, 'sent'), filter: null, tone: utilRatio === null || !meta.isCurrentMonth ? 'neutral' : utilRatio < 0.8 ? 'bad' : utilRatio < 1 ? 'warn' : 'good' },
    { key: 'scoutUsage', label: 'スカウト利用率', value: usage, unit: 'rate', sub: `${using} / ${contracted.length} 社が 1 件以上送信`, spark: [], filter: null, tone: usage === null ? 'neutral' : usage < 0.5 ? 'bad' : usage < 0.7 ? 'warn' : 'good' },
    { key: 'behind', label: 'スカウトの消化率_進捗遅れ', value: behind.length, unit: 'count', sub: `${rows.filter((r) => r.pace.status !== 'na').length} 社中（期待の 80% 未満）`, spark: [], filter: null, tone: behind.length ? 'bad' : 'good' },
    { key: 'noLogin', label: `${NO_LOGIN_DAYS} 日以上ログインなし`, value: noLogin.length, unit: 'count', sub: 'CT 画面への最終ログイン（記録なしを含む）', spark: [], filter: null, tone: noLogin.length ? 'bad' : 'good' },
  ];
}
