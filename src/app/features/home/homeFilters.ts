import { z } from 'zod';
import { DEFAULT_FILTERS, type BoardFilters, type EndingDays } from '../../../shared/metrics/board';
import type { BenchMode } from '../../../shared/metrics/score';
import type { HealthLevel } from '../../../shared/metrics/health';

/** URL のクエリ（文字列）。既定値と同じ項目は URL から消える */
export const HomeUrlSchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).or(z.literal('')).default(''),
  mine: z.enum(['0', '1']).default('0'),
  industry: z.string().default(''),
  type: z.string().default(''),
  ending: z.enum(['', '30', '60', '90']).default(''),
  status: z.enum(['', 'alert', 'watch', 'good']).default(''),
  state: z.enum(['current', 'all']).default('current'),
  bench: z.enum(['industry', 'target']).default('industry'),
  sort: z.string().regex(/^-?[a-z_A-Z]+$/).default('health'),
  q: z.string().max(100).default(''),
});
export type HomeUrl = z.infer<typeof HomeUrlSchema>;
export const HOME_URL_DEFAULTS: HomeUrl = { month: '', mine: '0', industry: '', type: '', ending: '', status: '', state: 'current', bench: 'industry', sort: 'health', q: '' };

const split = (s: string) => (s ? s.split(',').filter(Boolean) : []);

export function toFilters(u: HomeUrl): BoardFilters {
  return {
    ...DEFAULT_FILTERS,
    mine: u.mine === '1',
    industry: split(u.industry),
    type: split(u.type),
    ending: u.ending ? (Number(u.ending) as EndingDays) : null,
    status: (u.status || null) as HealthLevel | null,
    state: u.state,
    q: u.q,
  };
}

export function modeOf(u: HomeUrl): BenchMode {
  return u.bench;
}

/** フィルタ → URL の差分 */
export function fromFilters(f: Partial<BoardFilters>): Partial<HomeUrl> {
  const out: Partial<HomeUrl> = {};
  if (f.mine !== undefined) out.mine = f.mine ? '1' : '0';
  if (f.industry !== undefined) out.industry = f.industry.join(',');
  if (f.type !== undefined) out.type = f.type.join(',');
  if (f.ending !== undefined) out.ending = (f.ending === null ? '' : String(f.ending)) as HomeUrl['ending'];
  if (f.status !== undefined) out.status = (f.status ?? '') as HomeUrl['status'];
  if (f.state !== undefined) out.state = f.state;
  if (f.q !== undefined) out.q = f.q;
  return out;
}

export function activeFilterCount(f: BoardFilters): number {
  return (f.mine ? 1 : 0) + (f.industry.length ? 1 : 0) + (f.type.length ? 1 : 0) + (f.ending !== null ? 1 : 0) + (f.status ? 1 : 0) + (f.state !== 'current' ? 1 : 0) + (f.q ? 1 : 0);
}
