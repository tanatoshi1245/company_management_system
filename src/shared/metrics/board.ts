import type { BoardMeta } from '../schema/board';
import { HEAT_COLUMNS_INDUSTRY, HEAT_COLUMNS_TARGET } from './definitions';
import type { HealthLevel } from './health';
import { cellScore, type BenchMode, type ScoredCompany } from './score';

export const ENDING_OPTIONS = [30, 60, 90] as const;
export type EndingDays = (typeof ENDING_OPTIONS)[number];

export interface BoardFilters {
  mine: boolean;
  industry: string[];
  type: string[];
  ending: EndingDays | null;
  status: HealthLevel | null;
  /** current = 契約中・終了間近・開始前・直近終了（既定）、all = 終了済みも */
  state: 'current' | 'all';
  q: string;
}

export const DEFAULT_FILTERS: BoardFilters = { mine: false, industry: [], type: [], ending: null, state: 'current', status: null, q: '' };

export const CURRENT_STATES = new Set(['active', 'ending_30d', 'upcoming', 'ended_recent']);

export function normalizeQuery(s: string): string {
  return s.normalize('NFKC').toLowerCase().replace(/\s+/g, '');
}

export function filterCompanies(rows: ScoredCompany[], f: BoardFilters, mode: BenchMode): ScoredCompany[] {
  const q = normalizeQuery(f.q);
  return rows.filter((r) => {
    const c = r.c;
    if (f.state === 'current' && !CURRENT_STATES.has(c.state) && !c.m.contracted) return false;
    if (f.mine && !c.isMine) return false;
    if (f.industry.length && !f.industry.includes(c.ind)) return false;
    if (f.type.length && !f.type.includes(c.type)) return false;
    if (f.ending !== null && (c.contract.daysToEnd === null || c.contract.daysToEnd < 0 || c.contract.daysToEnd > f.ending)) return false;
    if (f.status && r.health[mode].level !== f.status) return false;
    if (q && !normalizeQuery(c.name).includes(q) && !String(c.id).includes(q)) return false;
    return true;
  });
}

export const SORT_KEYS = ['health', 'name', 'contractEnd', 'pace', ...HEAT_COLUMNS_INDUSTRY] as const;

/** sort: 'health' | 'name' | 'contractEnd' | 'pace' | 指標キー。先頭の '-' で降順 */
export function sortCompanies(rows: ScoredCompany[], sort: string, mode: BenchMode): ScoredCompany[] {
  const desc = sort.startsWith('-');
  const key = desc ? sort.slice(1) : sort;
  const dir = desc ? -1 : 1;
  const num = (v: number | null | undefined) => (v === null || v === undefined || Number.isNaN(v) ? (desc ? -Infinity : Infinity) : v);
  const cmp = (a: ScoredCompany, b: ScoredCompany): number => {
    switch (key) {
      case 'name':
        return a.c.name.localeCompare(b.c.name, 'ja') * dir;
      case 'contractEnd':
        return (num(a.c.contract.daysToEnd) - num(b.c.contract.daysToEnd)) * dir;
      case 'pace':
        return (num(a.pace.ratio) - num(b.pace.ratio)) * dir;
      case 'health': {
        const ha = a.health[mode];
        const hb = b.health[mode];
        const d = num(ha.score) - num(hb.score);
        return (d !== 0 ? d : num(ha.worstScore) - num(hb.worstScore)) * dir;
      }
      default: {
        const d = num(a.values[key]) - num(b.values[key]);
        return d * dir;
      }
    }
  };
  return [...rows].sort((a, b) => cmp(a, b) || a.c.name.localeCompare(b.c.name, 'ja'));
}

export function heatColumns(mode: BenchMode): string[] {
  return mode === 'industry' ? HEAT_COLUMNS_INDUSTRY : HEAT_COLUMNS_TARGET;
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

export const NO_LOGIN_DAYS = 14;
export const ENDING_SOON_DAYS = 60;

export function kpiStrip(rows: ScoredCompany[], mode: BenchMode, meta: BoardMeta): KpiTile[] {
  const contracted = rows.filter((r) => r.c.m.contracted || CURRENT_STATES.has(r.c.state));
  const behind = rows.filter((r) => r.pace.status === 'behind');
  const noLogin = rows.filter((r) => r.c.login.daysSince === null || r.c.login.daysSince >= NO_LOGIN_DAYS);
  const ending = rows.filter((r) => r.c.contract.daysToEnd !== null && r.c.contract.daysToEnd >= 0 && r.c.contract.daysToEnd <= ENDING_SOON_DAYS);
  const jobUtil = median(rows.map((r) => r.values.job_utilization).filter((v): v is number => v !== null));
  const second: KpiTile =
    mode === 'industry'
      ? { key: 'jobUtil', label: '求人枠消化率（中央値）', value: jobUtil, unit: 'rate', sub: `枠のある ${rows.filter((r) => r.values.job_utilization !== null).length} 社`, spark: portfolioTrend(rows, 'jobs'), filter: { ending: null }, tone: 'neutral' }
      : {
          key: 'targetProgress',
          label: '目標達成率（中央値）',
          value: median(rows.flatMap((r) => (r.target.scout_utilization?.progress !== null && r.target.scout_utilization?.progress !== undefined ? [r.target.scout_utilization.progress] : []))),
          unit: 'rate',
          sub: `目標設定済み ${rows.filter((r) => r.hasTargets).length} 社`,
          spark: portfolioTrend(rows, 'sent'),
          filter: null,
          tone: 'neutral',
        };
  return [
    { key: 'contracted', label: '契約企業', value: contracted.length, unit: 'count', sub: `${meta.month.replace('-', '年')}月に契約中`, spark: portfolioTrend(rows, 'sent'), filter: { status: null, ending: null }, tone: 'neutral' },
    second,
    { key: 'behind', label: 'スカウトのペース遅れ', value: behind.length, unit: 'count', sub: `${rows.filter((r) => r.pace.status !== 'na').length} 社中（期待の 80% 未満）`, spark: portfolioTrend(rows, 'sent'), filter: { status: 'alert' }, tone: behind.length ? 'bad' : 'good' },
    { key: 'noLogin', label: `${NO_LOGIN_DAYS} 日以上ログインなし`, value: noLogin.length, unit: 'count', sub: 'CT 画面への最終ログイン', spark: [], filter: null, tone: noLogin.length ? 'warn' : 'good' },
    { key: 'ending', label: `契約終了まで ${ENDING_SOON_DAYS} 日以内`, value: ending.length, unit: 'count', sub: '更新の提案時期', spark: [], filter: { ending: 60 }, tone: ending.length ? 'warn' : 'neutral' },
  ];
}

export interface Lanes {
  behind: ScoredCompany[];
  noLogin: ScoredCompany[];
  ending: ScoredCompany[];
}

export function attentionLanes(rows: ScoredCompany[], max = 6): Lanes {
  const behind = rows.filter((r) => r.pace.status === 'behind').sort((a, b) => (a.pace.ratio ?? 0) - (b.pace.ratio ?? 0));
  const noLogin = rows.filter((r) => r.c.login.daysSince === null || r.c.login.daysSince >= NO_LOGIN_DAYS).sort((a, b) => (b.c.login.daysSince ?? 9999) - (a.c.login.daysSince ?? 9999));
  const ending = rows.filter((r) => r.c.contract.daysToEnd !== null && r.c.contract.daysToEnd >= 0 && r.c.contract.daysToEnd <= ENDING_SOON_DAYS).sort((a, b) => (a.c.contract.daysToEnd ?? 0) - (b.c.contract.daysToEnd ?? 0));
  return { behind: behind.slice(0, max), noLogin: noLogin.slice(0, max), ending: ending.slice(0, max) };
}

/** 注目の理由（1 行）。ボードの右端 */
export function attentionReason(r: ScoredCompany, mode: BenchMode): string | null {
  const h = r.health[mode];
  if (r.pace.status === 'behind' && r.pace.expected !== null) return `スカウト ${r.c.m.sent}/${r.c.limits.scout ?? '–'}・期待 ${Math.round(r.pace.expected)}`;
  if (r.c.login.daysSince === null) return 'ログイン記録なし';
  if (r.c.login.daysSince >= NO_LOGIN_DAYS) return `${r.c.login.daysSince} 日ログインなし`;
  if (r.c.contract.daysToEnd !== null && r.c.contract.daysToEnd >= 0 && r.c.contract.daysToEnd <= ENDING_SOON_DAYS) return `契約終了まで ${r.c.contract.daysToEnd} 日`;
  if (h.worst && h.worstScore !== null && h.worstScore <= -1) return `${h.worst} が基準を下回る`;
  return null;
}

/** 行の全セルの中で最低のスコア（並べ替え・バッジ用） */
export function worstCell(s: ScoredCompany, mode: BenchMode): number | null {
  let w: number | null = null;
  for (const k of heatColumns(mode)) {
    const v = cellScore(s, k, mode);
    if (v !== null && (w === null || v < w)) w = v;
  }
  return w;
}
