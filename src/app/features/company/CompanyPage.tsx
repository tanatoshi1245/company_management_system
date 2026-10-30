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
import { AttributesResponseSchema, CompanyDetailResponseSchema } from '../../../shared/schema/company';
import { ApiError } from '../../lib/api';
import { fmtMonthShort } from '../../../shared/calendar/periods';
import { buildBreakdown, resolvePeriod, useCompanyModel } from './companyModel';
import { CompanyHeader } from './components/CompanyHeader';
import { SummaryPanel } from './components/SummaryPanel';
import { ViewsAppsPanel } from './components/ViewsAppsPanel';
import { ScoutTrendPanel } from './components/ScoutTrendPanel';
import { AttributePiePanel } from './components/AttributePiePanel';
import { ScoutUnusedPanel } from './components/ScoutUnusedPanel';
import { fmtInt } from '../../lib/format';

const Ym = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).or(z.literal('')).default('');
const UrlSchema = z.object({ from: Ym, to: Ym, account: z.string().default(''), attr: z.string().default('') });
const URL_DEFAULTS = { from: '', to: '', account: '', attr: '' };

/**
 * 企業詳細: ヘッダ（期間 from〜to とアカウント種別の切替、契約期間・契約残・最終ログインのカード）
 * → 実績（左: 求人 / 右: スカウト。選択期間・選択アカウントの累積）→ 推移（左: 閲覧・応募 / 右: 送信・興味あり返信）
 * → 属性の円グラフ（左: 誰が求人を見ているか（閲覧 / 応募）/ 右: 誰にスカウトを送っているか（送信 / 興味あり））→ スカウト未利用状況。
 * 詳細本体は period の終了月（to）で取得し、期間・アカウントの切替は再取得せずにブラウザで計算する（属性の内訳だけ別 API）。
 * 契約時の目標との比較（TargetVsActualPanel）は 2026-10-27 から非表示（ファイルは残す）
 */
export default function CompanyPage({ params }: PageProps) {
  const { meta } = useSession();
  const [url, setUrl] = useUrlState(UrlSchema, URL_DEFAULTS);
  const id = params.id ?? '';
  const to = url.to || meta?.month || null;
  const res = useResource(to && /^\d{1,12}$/.test(id) ? `/api/companies/${id}?month=${to}` : null, CompanyDetailResponseSchema, { ttlMs: 5 * 60_000 });
  const sel = useMemo(() => (res.data ? resolvePeriod(res.data, url) : null), [res.data, url]);
  const model = useCompanyModel(res.data, sel);
  const attrUrl = sel ? `/api/companies/${id}/attributes?from=${sel.from}&to=${sel.to}${sel.account ? `&account=${encodeURIComponent(sel.account)}` : ''}` : null;
  const attrs = useResource(attrUrl, AttributesResponseSchema, { ttlMs: 5 * 60_000 });
  const breakdown = useMemo(() => buildBreakdown(attrs.data), [attrs.data]);
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
  if (!res.data || !model || !sel) {
    return (
      <>
        <Skeleton variant="tile" />
        <Skeleton variant="row" rows={6} />
      </>
    );
  }
  const d = res.data;
  const t = model.totals;
  const accountNote = sel.account ? `（${sel.account}）` : '';
  const range = `${fmtMonthShort(sel.from)}〜${fmtMonthShort(sel.to)}`;
  const lead = t.months.length ? `${range}${accountNote} の累積${t.truncated ? '（契約開始は窓より前。直近 13 か月 + 当月のみ）' : ''}` : `${range}${accountNote} に契約期間のデータがありません`;
  const attrHelp = (what: string) => `選択期間（${range}）に${what}会員の属性${sel.account ? `（${sel.account} アカウント分）` : ''}。属性は現在のプロフィール。円は同じ大きさで、8% 以上のスライスに構成比を表示。上位 7 件以外は「その他」`;
  const attrState = attrs.error ? 'error' : !attrs.data || attrs.refreshing ? 'loading' : 'ready';
  return (
    <div className={res.refreshing ? 'visually-dim' : ''}>
      <CompanyHeader d={d} sel={sel} onPeriod={(from, to2) => setUrl({ from: from === resolvePeriod(d, { from: '', to: to2, account: '' }).from ? '' : from, to: to2 === (meta?.month ?? '') ? '' : to2 })} onAccount={(a) => setUrl({ account: a })} />
      <div className="grid-2 co-lower">
        <div className="stack">
          <SummaryPanel
            title="求人の実績"
            help="掲載求人数 = 選択期間に掲載期間が重なった求人の数（日英の重複は set_id で排除）。閲覧 = 求人の閲覧数、応募 = 応募数、採用 = 応募経由の採用。すべて選択期間のうち契約期間中の月の合計。アカウント種別を選ぶとその種別のプロファイル分だけ"
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
          <AttributePiePanel title="誰が求人を見ているか" help={attrHelp('求人を閲覧 / 応募した')} breakdown={breakdown} range={range} modes={['viewed', 'applied']} state={attrState} testId="pie-views" />
        </div>
        <div className="stack">
          <SummaryPanel
            title="スカウトの実績"
            help={`送信 = スカウト送信数、興味あり返信 = その月に「興味あり」返信があったスカウト数（返信月基準。質問・開封のみは含まない）、選考中 = 期間の終了月に応募 / 返信した人のうち現在の選考ステータスが選考中の人数、採用 = スカウト経由の採用。月間のスカウト枠は ${d.company.limits.scout === null ? '未設定' : `${fmtInt(d.company.limits.scout)} 件`}`}
            lead={lead}
            testId="summary-scout"
            stats={[
              { key: 'sent', label: 'スカウト送信件数', value: t.sent, unit: '件', zero: t.sent === 0 },
              { key: 'intReply', label: '興味あり返信', value: t.intReply, unit: '件' },
              { key: 'inSel', label: '選考中（現在）', value: t.inSel, unit: '人' },
              { key: 'hiresScout', label: '採用（スカウト経由）', value: t.hiresScout, unit: '人' },
            ]}
          />
          <ScoutTrendPanel m={model} />
          <AttributePiePanel title="誰にスカウトを送っているか" help={attrHelp('スカウトを送った')} breakdown={breakdown} range={range} modes={['sent', 'replied']} state={attrState} initial={url.attr} onChange={(a) => setUrl({ attr: a === 'japanese_level' ? '' : a })} testId="pie-scout" />
        </div>
      </div>
      <ScoutUnusedPanel rows={d.scoutUnused} month={d.meta.month} />
    </div>
  );
}
