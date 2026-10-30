import { z } from 'zod';
import { DEFAULT_FILTERS, DEFAULT_TYPE_FILTER, isDefaultTypeFilter, type BoardFilters, type EndingFilter, type YesNo } from '../../../shared/metrics/board';

/** URL のクエリ（文字列）。既定値と同じ項目は URL から消える。type の空 = 既定（DA と RPO 以外）、すべて見るときは 7 種別を明示 */
export const HomeUrlSchema = z.object({
  mine: z.enum(['0', '1']).default('0'),
  owner: z.string().max(2000).default(''),
  type: z.string().default(''),
  ending: z.enum(['', '30', '60', 'over90']).default(''),
  jobs: z.enum(['', 'yes', 'no']).default(''),
  sent: z.enum(['', 'yes', 'no']).default(''),
  sort: z.string().regex(/^-?[a-z_A-Z]+$/).default('name'),
  q: z.string().max(100).default(''),
});
export type HomeUrl = z.infer<typeof HomeUrlSchema>;
export const HOME_URL_DEFAULTS: HomeUrl = { mine: '0', owner: '', type: '', ending: '', jobs: '', sent: '', sort: 'name', q: '' };

const split = (s: string) => (s ? s.split(',').filter(Boolean) : []);

export function toFilters(u: HomeUrl): BoardFilters {
  return {
    ...DEFAULT_FILTERS,
    mine: u.mine === '1',
    owner: split(u.owner),
    type: u.type ? split(u.type) : [...DEFAULT_TYPE_FILTER],
    ending: u.ending ? (u.ending as EndingFilter) : null,
    jobs: u.jobs ? (u.jobs as YesNo) : null,
    sent: u.sent ? (u.sent as YesNo) : null,
    q: u.q,
  };
}

/** フィルタ → URL の差分 */
export function fromFilters(f: Partial<BoardFilters>): Partial<HomeUrl> {
  const out: Partial<HomeUrl> = {};
  if (f.mine !== undefined) out.mine = f.mine ? '1' : '0';
  if (f.owner !== undefined) out.owner = f.owner.join(',');
  if (f.type !== undefined) out.type = isDefaultTypeFilter(f.type) ? '' : f.type.join(',');
  if (f.ending !== undefined) out.ending = (f.ending ?? '') as HomeUrl['ending'];
  if (f.jobs !== undefined) out.jobs = (f.jobs ?? '') as HomeUrl['jobs'];
  if (f.sent !== undefined) out.sent = (f.sent ?? '') as HomeUrl['sent'];
  if (f.q !== undefined) out.q = f.q;
  return out;
}

export function activeFilterCount(f: BoardFilters): number {
  return (f.mine ? 1 : 0) + (f.owner.length ? 1 : 0) + (isDefaultTypeFilter(f.type) ? 0 : 1) + (f.ending !== null ? 1 : 0) + (f.jobs !== null ? 1 : 0) + (f.sent !== null ? 1 : 0) + (f.q ? 1 : 0);
}
