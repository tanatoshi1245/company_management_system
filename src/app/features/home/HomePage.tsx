import { useCallback, useMemo } from 'react';
import type { PageProps } from '../../router';
import { useSession } from '../../lib/session';
import { invalidate, useResource } from '../../lib/useResource';
import { useUrlState } from '../../lib/urlState';
import { PageHeader } from '../../components/ui/PageHeader';
import { Skeleton } from '../../components/ui/Skeleton';
import { Notice } from '../../components/ui/Notice';
import { Segmented } from '../../components/ui/Segmented';
import { Icon } from '../../components/ui/Icon';
import { BoardResponseSchema } from '../../../shared/schema/board';
import { fmtMonthJa, isoToJstDisplay } from '../../../shared/calendar/periods';
import { heatColumns, type BoardFilters, type KpiTile, type Lanes } from '../../../shared/metrics/board';
import type { BenchMode } from '../../../shared/metrics/score';
import { activeFilterCount, fromFilters, HOME_URL_DEFAULTS, HomeUrlSchema, modeOf, toFilters } from './homeFilters';
import { useHomeModel } from './homeModel';
import { KpiStrip } from './components/KpiStrip';
import { AttentionLanes } from './components/AttentionLanes';
import { BoardFilterBar, sortOptions } from './components/BoardFilterBar';
import { CompanyBoard } from './components/CompanyBoard';
import { BoardLegend } from './components/BoardLegend';
import { EmptyBoard } from './components/EmptyBoard';
import { fmtInt } from '../../lib/format';

/** ホーム: KPI タイル → 注目レーン → 固定フィルタ → マトリクス・ヒートマップ。状態は URL、計算はブラウザ側 */
export default function HomePage(_props: PageProps) {
  const { meta } = useSession();
  const [url, setUrl] = useUrlState(HomeUrlSchema, HOME_URL_DEFAULTS);
  const month = url.month || meta?.month || null;
  const board = useResource(month ? `/api/board?month=${month}` : null, BoardResponseSchema, { ttlMs: 5 * 60_000 });
  const filters = useMemo(() => toFilters(url), [url]);
  const mode: BenchMode = modeOf(url);
  const model = useHomeModel(board.data, filters, mode, url.sort);
  const setFilters = useCallback((patch: Partial<BoardFilters>) => setUrl(fromFilters(patch)), [setUrl]);
  const clear = useCallback(() => setUrl({ ...HOME_URL_DEFAULTS, month: url.month, bench: url.bench, sort: url.sort }), [setUrl, url.month, url.bench, url.sort]);
  const onKpi = (t: KpiTile) => {
    if (!t.filter) return;
    if (t.key === 'noLogin') return;
    setFilters(t.filter);
  };
  const onLaneMore = (lane: keyof Lanes) => {
    if (lane === 'behind') setUrl({ sort: 'pace', status: '' });
    if (lane === 'ending') setFilters({ ending: 60 });
    if (lane === 'noLogin') setUrl({ sort: 'login_days' });
    document.getElementById('board')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
    ? `${fmtMonthJa(bm.month)}${bm.isCurrentMonth ? `（営業日 ${bm.bizDays.elapsed}/${bm.bizDays.total} 経過・${Math.round(bm.bizDays.rate * 100)}%）` : '（月の全営業日）'}・データは ${bm.dataDate} まで${meta?.refreshedAt ? `・マート更新 ${isoToJstDisplay(meta.refreshedAt)}` : ''}`
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
            <Segmented<BenchMode> ariaLabel="比較の基準" options={[{ key: 'industry', label: '業界比', title: '同業種・同種別の中央値との比' }, { key: 'target', label: '目標比', title: '契約時に登録した目標との比' }]} value={mode} onChange={(b) => setUrl({ bench: b })} />
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
          <KpiStrip tiles={model.kpis} onPick={onKpi} active={filters.status === 'alert' ? 'behind' : filters.ending === 60 ? 'ending' : null} />
          <AttentionLanes
            lanes={model.lanes}
            totals={{ behind: model.filtered.filter((s) => s.pace.status === 'behind').length, noLogin: model.filtered.filter((s) => s.c.login.daysSince === null || s.c.login.daysSince >= 14).length, ending: model.filtered.filter((s) => s.c.contract.daysToEnd !== null && s.c.contract.daysToEnd >= 0 && s.c.contract.daysToEnd <= 60).length }}
            month={bm?.month ?? month ?? ''}
            onMore={onLaneMore}
          />
          <BoardFilterBar
            filters={filters}
            onChange={setFilters}
            mode={mode}
            month={bm?.month ?? month ?? ''}
            months={bm?.months ?? []}
            onMonth={(m) => setUrl({ month: m === (meta?.month ?? '') ? '' : m })}
            sort={url.sort}
            onSort={(s) => setUrl({ sort: s })}
            sorts={sortOptions(mode, heatColumns(mode))}
            industries={model.industries}
            types={model.types}
            mineCount={model.mineCount}
            activeCount={activeFilterCount(filters)}
            onClear={clear}
          />
          {model.sorted.length === 0 ? (
            <EmptyBoard onClear={clear} hasFilters={activeFilterCount(filters) > 0} />
          ) : (
            <>
              <CompanyBoard rows={model.sorted} mode={mode} meta={bm!} sort={url.sort} onSort={(s) => setUrl({ sort: s })} />
              <BoardLegend mode={mode} meta={bm!} />
            </>
          )}
          <p className="footer">
            {fmtInt(model.filtered.length)} / {fmtInt(model.scored.length)} 社を表示。行をクリックすると企業の詳細（契約・推移・スカウト対象・選考状況）へ。
          </p>
        </div>
      )}
    </>
  );
}
