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
import { fmtMonthShort } from '../../../shared/calendar/periods';
import { useCompanyModel } from './companyModel';
import { CompanyHeader } from './components/CompanyHeader';
import { SummaryPanel } from './components/SummaryPanel';
import { ViewsAppsPanel } from './components/ViewsAppsPanel';
import { ScoutTrendPanel } from './components/ScoutTrendPanel';
import { AttributePiePanel } from './components/AttributePiePanel';
import { ScoutUnusedPanel } from './components/ScoutUnusedPanel';
import { fmtInt } from '../../lib/format';

const UrlSchema = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).or(z.literal('')).default(''), attr: z.string().default('') });
const URL_DEFAULTS = { month: '', attr: '' };

/**
 * 企業詳細: ヘッダ（契約期間・契約残・最終ログインのカード）→ 実績（左: 求人 / 右: スカウト。直近 13 か月の累積）
 * → 推移（左: 閲覧・応募 / 右: 送信・返信）→ 属性の円グラフ（左: 誰が求人を見ているか / 右: 誰にスカウトを送っているか）→ スカウト未利用状況。
 * 契約時の目標との比較（TargetVsActualPanel）は 2026-10-27 から非表示（ファイルは残す）
 */
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
  const t = model.totals;
  const lead = t.months.length ? `${fmtMonthShort(t.fromMonth)}〜${fmtMonthShort(t.months[t.months.length - 1])} の累積${t.truncated ? '（直近 13 か月 + 当月のみ）' : ''}` : '契約期間のデータがありません';
  const attrHelp = (what: string) => `選択月を含む直近 3 か月に${what}会員の属性。属性は現在のプロフィール。円は同じ大きさで、8% 以上のスライスに構成比を表示。上位 7 件以外は「その他」`;
  return (
    <div className={res.refreshing ? 'visually-dim' : ''}>
      <CompanyHeader d={d} onMonth={(m) => setUrl({ month: m === (meta?.month ?? '') ? '' : m })} />
      <div className="grid-2 co-lower">
        <div className="stack">
          <SummaryPanel
            title="求人の実績（直近 13 か月）"
            help="掲載求人数 = 期間中に掲載期間が重なった求人の数（日英の重複は set_id で排除）。閲覧 = 求人を閲覧した会員数、応募 = 応募数、採用 = 応募経由の採用。すべて契約期間中の月の合計"
            lead={lead}
            testId="summary-jobs"
            stats={[
              { key: 'jobs', label: '掲載求人数（重複排除）', value: t.jobsDistinct, unit: '件', zero: t.jobsDistinct === 0 },
              { key: 'views', label: '閲覧人数', value: t.views, unit: '人', zero: t.views === 0 },
              { key: 'apps', label: '応募人数', value: t.apps, unit: '人', zero: t.apps === 0 },
              { key: 'hiresApp', label: '採用（応募経由）', value: t.hiresApp, unit: '人' },
            ]}
          />
          <ViewsAppsPanel m={model} />
          <AttributePiePanel title="誰が求人を見ているか" help={attrHelp('求人を閲覧した')} breakdown={model.attributes} months={model.attrMonths} modes={['viewed']} testId="pie-views" />
        </div>
        <div className="stack">
          <SummaryPanel
            title="スカウトの実績（直近 13 か月）"
            help={`送信 = スカウト送信数、返信 = その月に「興味あり」返信があったスカウト数（返信月基準）、選考中 = 現在の選考ステータスが選考中の人数、採用 = スカウト経由の採用。月間のスカウト枠は ${d.company.limits.scout === null ? '未設定' : `${fmtInt(d.company.limits.scout)} 件`}`}
            lead={lead}
            testId="summary-scout"
            stats={[
              { key: 'sent', label: 'スカウト送信件数', value: t.sent, unit: '件', zero: t.sent === 0 },
              { key: 'intReply', label: '返信件数', value: t.intReply, unit: '件' },
              { key: 'inSel', label: '選考中（現在）', value: t.inSel, unit: '人' },
              { key: 'hiresScout', label: '採用（スカウト経由）', value: t.hiresScout, unit: '人' },
            ]}
          />
          <ScoutTrendPanel m={model} />
          <AttributePiePanel title="誰にスカウトを送っているか" help={attrHelp('スカウトを送った')} breakdown={model.attributes} months={model.attrMonths} modes={['sent', 'replied']} initial={url.attr} onChange={(a) => setUrl({ attr: a === 'japanese_level' ? '' : a })} testId="pie-scout" />
        </div>
      </div>
      <ScoutUnusedPanel rows={d.scoutUnused} month={d.meta.month} />
    </div>
  );
}
