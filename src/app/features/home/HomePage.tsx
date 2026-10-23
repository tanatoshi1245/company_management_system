import { useCallback, useMemo } from 'react';
import type { PageProps } from '../../router';
import { useSession } from '../../lib/session';
import { invalidate, useResource } from '../../lib/useResource';
import { useUrlState } from '../../lib/urlState';
import { PageHeader } from '../../components/ui/PageHeader';
import { Skeleton } from '../../components/ui/Skeleton';
import { Notice } from '../../components/ui/Notice';
import { Icon } from '../../components/ui/Icon';
import { BoardResponseSchema } from '../../../shared/schema/board';
import { fmtMonthJa, isoToJstDisplay } from '../../../shared/calendar/periods';
import type { BoardFilters, KpiTile } from '../../../shared/metrics/board';
import { activeFilterCount, fromFilters, HOME_URL_DEFAULTS, HomeUrlSchema, toFilters } from './homeFilters';
import { useHomeModel } from './homeModel';
import { KpiStrip } from './components/KpiStrip';
import { BoardFilterBar } from './components/BoardFilterBar';
import { CompanyBoard } from './components/CompanyBoard';
import { BoardLegend } from './components/BoardLegend';
import { EmptyBoard } from './components/EmptyBoard';
import { fmtInt } from '../../lib/format';

/** ホーム: KPI タイル → 固定フィルタ → 契約中の企業 × 実績の表（0 件と 30 日以上ログインなしだけ赤）。状態は URL、計算はブラウザ側 */
export default function HomePage(_props: PageProps) {
  const { meta } = useSession();
  const [url, setUrl] = useUrlState(HomeUrlSchema, HOME_URL_DEFAULTS);
  const month = meta?.month ?? null;
  const board = useResource(month ? `/api/board?month=${month}` : null, BoardResponseSchema, { ttlMs: 5 * 60_000 });
  const filters = useMemo(() => toFilters(url), [url]);
  const model = useHomeModel(board.data, filters, url.sort);
  const setFilters = useCallback((patch: Partial<BoardFilters>) => setUrl(fromFilters(patch)), [setUrl]);
  const clear = useCallback(() => setUrl({ ...HOME_URL_DEFAULTS, sort: url.sort }), [setUrl, url.sort]);
  const onKpi = (t: KpiTile) => {
    if (t.key === 'noLogin') {
      setUrl({ sort: 'login' });
      return;
    }
    if (t.key === 'behind') {
      setUrl({ sort: 'pace' });
      return;
    }
    if (!t.filter) return;
    setFilters(t.filter);
  };
  const refresh = async () => {
    if (!month) return;
    try {
      await fetch(`/api/board?month=${month}&refresh=1`, { headers: { accept: 'application/json' } });
    } finally {
      invalidate('/api/board');
      invalidate('/api/meta');
    }
  };
  const bm = board.data?.meta;
  const context = bm
    ? `${fmtMonthJa(bm.month)}（契約中の企業・営業日 ${bm.bizDays.elapsed}/${bm.bizDays.total} 経過・${Math.round(bm.bizDays.rate * 100)}%）・データは ${bm.dataDate} まで${meta?.refreshedAt ? `・マート更新 ${isoToJstDisplay(meta.refreshedAt)}` : ''}`
    : meta
      ? fmtMonthJa(meta.month)
      : null;

  return (
    <>
      <PageHeader
        title="契約企業ボード"
        context={context}
        actions={
          <>
            <button type="button" className="btn ghost sm" onClick={refresh} title="キャッシュを捨てて取り直す" disabled={board.refreshing}>
              <Icon name="refresh" size={14} /> 最新に更新
            </button>
          </>
        }
      />
      {board.error ? <Notice tone="error">{board.error.message}</Notice> : null}
      {meta?.refreshStatus === 'error' ? <Notice tone="warn">今朝のマート更新に失敗しています。表示は前回（{meta.dataVersion}）のデータです</Notice> : null}
      {!model ? (
        <>
          <div className="kpi-strip" aria-hidden="true">
            {Array.from({ length: 5 }, (_, i) => (
              <Skeleton key={i} variant="tile" />
            ))}
          </div>
          <div className="board-skeleton">
            <Skeleton variant="row" rows={10} />
          </div>
        </>
      ) : (
        <div className={board.refreshing ? 'visually-dim' : ''}>
          <KpiStrip tiles={model.kpis} onPick={onKpi} active={url.sort === 'login' ? 'noLogin' : url.sort === 'pace' ? 'behind' : null} />
          <BoardFilterBar
            filters={filters}
            onChange={setFilters}
            owners={model.owners}
            types={model.types}
            mineCount={model.mineCount}
            activeCount={activeFilterCount(filters)}
            onClear={clear}
          />
          {model.sorted.length === 0 ? (
            <EmptyBoard onClear={clear} hasFilters={activeFilterCount(filters) > 0} />
          ) : (
            <>
              <CompanyBoard rows={model.sorted} meta={bm!} sort={url.sort} onSort={(s) => setUrl({ sort: s })} />
              <BoardLegend meta={bm!} />
            </>
          )}
          <p className="footer">
            {fmtInt(model.filtered.length)} 社を表示（契約中の企業のみ）。行をクリックすると企業の詳細（契約・推移・スカウト対象・選考状況）へ。
          </p>
        </div>
      )}
    </>
  );
}
