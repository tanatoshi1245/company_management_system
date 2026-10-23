import { useMemo, useState } from 'react';
import { z } from 'zod';
import type { PageProps } from '../../router';
import { Link } from '../../router';
import { useSession } from '../../lib/session';
import { useResource } from '../../lib/useResource';
import { useUrlState } from '../../lib/urlState';
import { PageHeader } from '../../components/ui/PageHeader';
import { Skeleton } from '../../components/ui/Skeleton';
import { Notice } from '../../components/ui/Notice';
import { Chip } from '../../components/ui/Chip';
import { Button } from '../../components/ui/Button';
import { Icon } from '../../components/ui/Icon';
import { BoardResponseSchema } from '../../../shared/schema/board';
import { hasAnyTarget, PlanDefaultsResponseSchema, TARGET_METRIC_LABEL, TARGET_METRICS, TargetsByMonthResponseSchema } from '../../../shared/schema/targets';
import { fmtMonthJa, isoToJstDisplay } from '../../../shared/calendar/periods';
import { isContracted } from '../../../shared/metrics/board';
import { TargetProgressBar } from './components/TargetProgressBar';
import { BulkDefaultsDialog } from './components/BulkDefaultsDialog';
import { fmtInt } from '../../lib/format';

const UrlSchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).or(z.literal('')).default(''),
  mine: z.enum(['0', '1']).default('0'),
  missing: z.enum(['0', '1']).default('0'),
  q: z.string().max(100).default(''),
  sort: z.enum(['name', 'updated', 'progress']).default('name'),
});

/** 目標一覧: 企業 × 当月の目標 × 達成率。企業名・実績はボード、目標の登録情報は D1 */
export default function TargetsListPage(_props: PageProps) {
  const { meta, me } = useSession();
  const [url, setUrl] = useUrlState(UrlSchema, { month: '', mine: '0', missing: '0', q: '', sort: 'name' });
  const month = url.month || meta?.month || null;
  const board = useResource(month ? `/api/board?month=${month}` : null, BoardResponseSchema, { ttlMs: 5 * 60_000 });
  const targets = useResource(month ? `/api/targets?month=${month}` : null, TargetsByMonthResponseSchema, { ttlMs: 0 });
  const planDefaults = useResource('/api/settings/plan-defaults', PlanDefaultsResponseSchema, { ttlMs: 60_000 });
  const [dialog, setDialog] = useState(false);
  const [done, setDone] = useState<number | null>(null);
  const rows = useMemo(() => {
    if (!board.data) return null;
    const rec = new Map((targets.data?.rows ?? []).map((r) => [r.companyId, r]));
    const q = url.q.trim().toLowerCase();
    const list = board.data.companies
      .filter((c) => isContracted(c, board.data!.meta))
      .filter((c) => (url.mine === '1' ? c.isMine : true))
      .filter((c) => (url.missing === '1' ? !hasAnyTarget(c.targets) : true))
      .filter((c) => (q ? c.name.toLowerCase().includes(q) || (c.plan ?? '').toLowerCase().includes(q) : true))
      .map((c) => ({ c, rec: rec.get(c.id) ?? null, progress: c.targets?.scout_sent ? c.m.sent / c.targets.scout_sent : null }));
    const cmp = {
      name: (a: (typeof list)[number], b: (typeof list)[number]) => a.c.name.localeCompare(b.c.name, 'ja'),
      updated: (a: (typeof list)[number], b: (typeof list)[number]) => (b.rec?.updatedAt ?? '').localeCompare(a.rec?.updatedAt ?? ''),
      progress: (a: (typeof list)[number], b: (typeof list)[number]) => (a.progress ?? 9) - (b.progress ?? 9),
    }[url.sort];
    return list.sort(cmp);
  }, [board.data, targets.data, url.q, url.mine, url.missing, url.sort]);
  const bm = board.data?.meta;
  const rate = bm?.bizDays.rate ?? 0;
  const mineIds = (board.data?.companies ?? []).filter((c) => c.isMine).map((c) => c.id);
  const withTarget = (board.data?.companies ?? []).filter((c) => isContracted(c, board.data!.meta) && hasAnyTarget(c.targets)).length;
  const total = (board.data?.companies ?? []).filter((c) => isContracted(c, board.data!.meta)).length;
  return (
    <>
      <PageHeader
        title="契約時の目標"
        context={bm ? `${fmtMonthJa(bm.month)} ・ 目標あり ${fmtInt(withTarget)} / ${fmtInt(total)} 社${bm.isCurrentMonth ? ` ・ 営業日消化率 ${Math.round(rate * 100)}%` : ''}` : null}
        actions={
          <>
            <label className="field">
              <span>月</span>
              <select className="ctl" value={bm?.month ?? month ?? ''} aria-label="表示する月" onChange={(e) => setUrl({ month: e.target.value === (meta?.month ?? '') ? '' : e.target.value })}>
                {[...(bm?.months ?? [])].reverse().map((m) => (
                  <option key={m} value={m}>
                    {fmtMonthJa(m)}
                  </option>
                ))}
              </select>
            </label>
            <Button size="sm" disabled={!me?.canEdit} title={me?.canEdit ? 'プラン既定値で、目標が無い月を埋める' : 'Google ログインで編集できます'} onClick={() => setDialog(true)}>
              プラン既定値で未設定を埋める
            </Button>
          </>
        }
      />
      {board.error ? <Notice tone="error">{board.error.message}</Notice> : null}
      {done !== null ? <Notice tone="info">{done} 件の目標を作成しました</Notice> : null}
      <div className="filter-bar">
        <Chip label="担当 = 自分" on={url.mine === '1'} onClick={() => setUrl({ mine: url.mine === '1' ? '0' : '1' })} count={mineIds.length} icon={<Icon name="filter" size={14} />} />
        <Chip label="未設定のみ" on={url.missing === '1'} onClick={() => setUrl({ missing: url.missing === '1' ? '0' : '1' })} count={total - withTarget} />
        <input className="ctl" type="search" placeholder="企業名・プランで検索" aria-label="企業名で検索" value={url.q} onChange={(e) => setUrl({ q: e.target.value })} />
        <label className="field">
          <span>並べ替え</span>
          <select className="ctl" aria-label="並べ替え" value={url.sort} onChange={(e) => setUrl({ sort: e.target.value as 'name' | 'updated' | 'progress' })}>
            <option value="name">企業名</option>
            <option value="updated">更新が新しい順</option>
            <option value="progress">達成率が低い順</option>
          </select>
        </label>
      </div>
      {!rows ? (
        <Skeleton variant="row" rows={10} />
      ) : rows.length === 0 ? (
        <div className="empty">
          <b>該当する企業がありません</b>
        </div>
      ) : (
        <div className="table-wrap card">
          <table className="data targets" aria-label="企業別の目標">
            <thead>
              <tr>
                <th>企業</th>
                <th>プラン</th>
                <th>担当</th>
                {TARGET_METRICS.map((k) => (
                  <th key={k} className="num">
                    {TARGET_METRIC_LABEL[k]}
                  </th>
                ))}
                <th>スカウト送信の達成率</th>
                <th>応募の達成率</th>
                <th>最終更新</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ c, rec }) => (
                <tr key={c.id}>
                  <td>
                    <Link to={`/targets/${c.id}?from=${bm?.month ?? ''}`} className="co-link">
                      {c.name}
                    </Link>
                  </td>
                  <td className="small">{c.plan ?? '–'}</td>
                  <td className="small">{c.owner.name ?? <span className="muted">未設定</span>}</td>
                  {TARGET_METRICS.map((k) => (
                    <td key={k} className="num">
                      {c.targets?.[k] === null || c.targets?.[k] === undefined ? <span className="muted">–</span> : fmtInt(c.targets[k])}
                    </td>
                  ))}
                  <td>
                    <TargetProgressBar actual={c.m.sent} target={c.targets?.scout_sent} rate={rate} label="スカウト送信" />
                  </td>
                  <td>
                    <TargetProgressBar actual={c.m.apps} target={c.targets?.applications} rate={rate} label="応募" />
                  </td>
                  <td className="small muted">{rec ? `${rec.updatedBy.split('@')[0]} ・ ${isoToJstDisplay(rec.updatedAt)}` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {dialog && bm ? (
        <BulkDefaultsDialog
          month={bm.month}
          planDefaults={planDefaults.data}
          mineIds={mineIds}
          onClose={() => setDialog(false)}
          onDone={(n) => {
            setDialog(false);
            setDone(n);
          }}
        />
      ) : null}
    </>
  );
}
