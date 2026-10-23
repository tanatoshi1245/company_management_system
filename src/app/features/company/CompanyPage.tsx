import { useEffect, useMemo } from 'react';
import { z } from 'zod';
import type { PageProps } from '../../router';
import { useSession } from '../../lib/session';
import { useResource } from '../../lib/useResource';
import { useUrlState } from '../../lib/urlState';
import { navigate } from '../../router';
import { Skeleton } from '../../components/ui/Skeleton';
import { Notice } from '../../components/ui/Notice';
import { EmptyState } from '../../components/ui/EmptyState';
import { CompanyDetailResponseSchema } from '../../../shared/schema/company';
import { ApiError } from '../../lib/api';
import { useCompanyModel } from './companyModel';
import { CompanyHeader } from './components/CompanyHeader';
import { CurrentMonthPanel } from './components/CurrentMonthPanel';
import { ViewsAppsPanel } from './components/ViewsAppsPanel';
import { ScoutTrendPanel } from './components/ScoutTrendPanel';
import { ScoutTargetPanel } from './components/ScoutTargetPanel';
import { ScoutUnusedPanel } from './components/ScoutUnusedPanel';
import { TargetVsActualPanel } from './components/TargetVsActualPanel';
import { CaveatFootnotes } from './components/CaveatFootnotes';

const UrlSchema = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).or(z.literal('')).default(''), attr: z.string().default('') });
const URL_DEFAULTS = { month: '', attr: '' };

/** 企業詳細: ヘッダ → 当月の実績 → 左: 閲覧・応募の推移 / 右: 送信・返信の推移 + スカウト対象 → スカウト未利用状況 → 目標比較 → 注意点 */
export default function CompanyPage({ params }: PageProps) {
  const { meta } = useSession();
  const [url, setUrl] = useUrlState(UrlSchema, URL_DEFAULTS);
  const id = params.id ?? '';
  const month = url.month || meta?.month || null;
  const res = useResource(month && /^\d{1,12}$/.test(id) ? `/api/companies/${id}?month=${month}` : null, CompanyDetailResponseSchema, { ttlMs: 5 * 60_000 });
  const model = useCompanyModel(res.data);
  useEffect(() => {
    if (res.data) document.title = `${res.data.company.name} | 契約企業マネジメント`;
    return () => {
      document.title = '契約企業マネジメント | Daijob';
    };
  }, [res.data]);
  const notFound = useMemo(() => res.error instanceof ApiError && res.error.status === 404, [res.error]);
  if (!/^\d{1,12}$/.test(id) || notFound) {
    return <EmptyState title="企業が見つかりません" body="契約企業のマスタに無い ID です" action={<button type="button" className="btn" onClick={() => navigate('/')}>ボードへ戻る</button>} />;
  }
  if (res.error) return <Notice tone="error">{res.error.message}</Notice>;
  if (!res.data || !model) {
    return (
      <>
        <Skeleton variant="tile" />
        <Skeleton variant="row" rows={6} />
      </>
    );
  }
  const d = res.data;
  return (
    <div className={res.refreshing ? 'visually-dim' : ''}>
      <CompanyHeader d={d} onMonth={(m) => setUrl({ month: m === (meta?.month ?? '') ? '' : m })} onEditOwner={() => navigate(`/targets/${d.company.id}?from=${d.meta.month}#settings`)} />
      <CurrentMonthPanel d={d} m={model} />
      <div className="grid-2 co-lower">
        <div className="stack">
          <ViewsAppsPanel m={model} />
        </div>
        <div className="stack">
          <ScoutTrendPanel m={model} />
          <ScoutTargetPanel m={model} initial={url.attr} onChange={(t) => setUrl({ attr: t === 'japanese_level' ? '' : t })} />
        </div>
      </div>
      <ScoutUnusedPanel rows={d.scoutUnused} month={d.meta.month} />
      <TargetVsActualPanel d={d} m={model} />
      <CaveatFootnotes ids={model.caveatIds} />
    </div>
  );
}
