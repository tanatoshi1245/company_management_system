import { useCallback, useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import type { PageProps } from '../../router';
import { Link } from '../../router';
import { useSession } from '../../lib/session';
import { invalidate, useResource } from '../../lib/useResource';
import { useUrlState } from '../../lib/urlState';
import { apiSend, ApiError } from '../../lib/api';
import { PageHeader } from '../../components/ui/PageHeader';
import { Skeleton } from '../../components/ui/Skeleton';
import { Notice } from '../../components/ui/Notice';
import { EmptyState } from '../../components/ui/EmptyState';
import { Button } from '../../components/ui/Button';
import { Help } from '../../components/ui/Help';
import { Badge } from '../../components/ui/Badge';
import { CompanyDetailResponseSchema } from '../../../shared/schema/company';
import { AuditListResponseSchema, CompanyTargetsResponseSchema, PlanDefaultsResponseSchema } from '../../../shared/schema/targets';
import { addMonths, fmtMonthJa, fmtMonthShort } from '../../../shared/calendar/periods';
import { COMPANY_TYPE_SHORT, OWNER_SOURCE_LABEL } from '../../../shared/labels';
import { applyPlanDefaults, copyFromPrevious, diffGrid, dirtyMonths, fromRecords, gridMonths, type GridState } from './targetsModel';
import { MonthGridForm } from './components/MonthGridForm';
import { ChangeHistory } from './components/ChangeHistory';
import { CompanySettingsForm } from './components/CompanySettingsForm';
import { fmtInt } from '../../lib/format';

const UrlSchema = z.object({ from: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).or(z.literal('')).default('') });

/** 企業別の月別目標フォーム（12 か月のグリッド）+ 企業設定 + 変更履歴 */
export default function TargetFormPage({ params }: PageProps) {
  const { meta, me } = useSession();
  const [url, setUrl] = useUrlState(UrlSchema, { from: '' });
  const id = params.id ?? '';
  const validId = /^\d{1,12}$/.test(id);
  const from = url.from || meta?.month || '';
  const months = useMemo(() => (from ? gridMonths(from) : []), [from]);
  const canEdit = Boolean(me?.canEdit);
  const detail = useResource(validId && meta ? `/api/companies/${id}?month=${meta.month}` : null, CompanyDetailResponseSchema, { ttlMs: 5 * 60_000 });
  const targets = useResource(validId && months.length ? `/api/companies/${id}/targets?from=${months[0]}&to=${months[months.length - 1]}` : null, CompanyTargetsResponseSchema, { ttlMs: 0 });
  const history = useResource(validId ? `/api/companies/${id}/targets/history?limit=30` : null, AuditListResponseSchema, { ttlMs: 0 });
  const planDefaults = useResource('/api/settings/plan-defaults', PlanDefaultsResponseSchema, { ttlMs: 60_000 });
  const [grid, setGrid] = useState<GridState | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null);
  const loadedKey = targets.data ? `${targets.data.companyId}|${targets.data.from}|${targets.data.rows.map((r) => `${r.month}:${r.updatedAt}`).join(',')}` : '';
  useEffect(() => {
    if (targets.data) setGrid(fromRecords(months, targets.data.rows));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadedKey]);
  const dirty = grid ? dirtyMonths(grid) : [];
  useEffect(() => {
    if (!dirty.length) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [dirty.length]);
  useEffect(() => {
    if (window.location.hash === '#settings' && detail.data) document.getElementById('settings')?.scrollIntoView({ block: 'start' });
  }, [detail.data]);
  const save = useCallback(async () => {
    if (!grid) return;
    if (document.querySelector('.tgrid input[aria-invalid="true"]')) {
      setMsg({ tone: 'err', text: '赤枠のセルを直してから保存してください' });
      return;
    }
    const d = diffGrid(grid);
    setSaving(true);
    setMsg(null);
    try {
      for (const p of d.puts) await apiSend('PUT', `/api/companies/${id}/targets/${p.month}`, { ...p.values, note: p.note });
      for (const m of d.deletes) await apiSend('DELETE', `/api/companies/${id}/targets/${m}`);
      invalidate(`/api/companies/${id}`);
      invalidate('/api/board');
      invalidate('/api/targets');
      setMsg({ tone: 'ok', text: `${d.puts.length + d.deletes.length} か月分を保存しました` });
    } catch (e) {
      setMsg({ tone: 'err', text: e instanceof ApiError && e.details.length ? `${e.message}: ${e.details.map((x) => `${x.path} ${x.message}`).join('、')}` : (e as Error).message });
      invalidate(`/api/companies/${id}`);
    } finally {
      setSaving(false);
    }
  }, [grid, id]);
  const notFound = detail.error instanceof ApiError && detail.error.status === 404;
  if (!validId || notFound) return <EmptyState title="企業が見つかりません" body="契約企業のマスタに無い ID です" action={<Link to="/targets" className="btn">目標一覧へ</Link>} />;
  if (detail.error) return <Notice tone="error">{detail.error.message}</Notice>;
  if (!detail.data || !grid || !meta) {
    return (
      <>
        <PageHeader title="目標の編集" breadcrumb={[{ label: '目標', to: '/targets' }]} />
        <Skeleton variant="row" rows={8} />
      </>
    );
  }
  const c = detail.data.company;
  const planDef = c.plan ? planDefaults.data?.plans[c.plan] : undefined;
  return (
    <>
      <PageHeader
        title={
          <>
            {c.name} <span className="muted small">の目標</span>
          </>
        }
        breadcrumb={[{ label: '目標', to: `/targets?month=${meta.month}` }]}
        context={
          <>
            <Badge tone="navy">{COMPANY_TYPE_SHORT[c.type] ?? c.type}</Badge> {c.ind}
            {c.plan ? ` ・ プラン ${c.plan}` : ''} ・ 担当 {c.owner.name ?? '未設定'}
            {c.owner.src === 'override' ? '（上書き）' : c.owner.src !== 'none' ? `（${OWNER_SOURCE_LABEL[c.owner.src] ?? c.owner.src}）` : ''} ・ スカウト枠 {c.limits.scout === null ? '–' : fmtInt(c.limits.scout)} / 求人枠 {c.limits.job === null ? '–' : fmtInt(c.limits.job)}
          </>
        }
        actions={
          <Link to={`/companies/${id}?month=${meta.month}`} className="btn ghost sm">
            企業の詳細へ
          </Link>
        }
      />
      {!canEdit ? <Notice tone="warn">閲覧のみです。目標の登録・編集には Google ログインが必要です{me?.mock ? '（サンプルデータで動作中）' : ''}</Notice> : null}
      <section className="card">
        <div className="card-head">
          <h2>
            月別の目標 <Help text="契約時に合意した数字を月ごとに入れる。空欄 = 目標なし。差分のある月だけ保存される。ボードの「目標比」と企業詳細の達成率に使う" />
          </h2>
          <div className="actions">
            <label className="field">
              <span>開始月</span>
              <select className="ctl" value={from} aria-label="開始月" onChange={(e) => setUrl({ from: e.target.value === meta.month ? '' : e.target.value })}>
                {Array.from({ length: 25 }, (_, i) => addMonths(meta.month, i - 12)).map((ym) => (
                  <option key={ym} value={ym}>
                    {fmtMonthJa(ym)}〜
                  </option>
                ))}
              </select>
            </label>
            <Button size="sm" variant="ghost" disabled={!canEdit || !planDef} title={planDef ? '空のセルにプラン既定値を入れる（保存はまだ）' : 'このプランの既定値が未登録（設定 → プラン既定値）'} onClick={() => planDef && setGrid(applyPlanDefaults(grid, planDef))}>
              プラン既定値を適用
            </Button>
          </div>
        </div>
        <MonthGridForm state={grid} onChange={setGrid} onCopyPrev={(m) => setGrid(copyFromPrevious(grid, m))} disabled={!canEdit} currentMonth={meta.month} />
        <div className="save-bar">
          {dirty.length ? (
            <span className="badge warn" role="status">
              未保存の変更 {dirty.length} か月（{dirty.map(fmtMonthShort).join('、')}）
            </span>
          ) : (
            <span className="small muted">変更なし</span>
          )}
          <Button variant="primary" onClick={save} loading={saving} disabled={!canEdit || !dirty.length}>
            差分を保存
          </Button>
          <Button variant="ghost" disabled={!dirty.length || saving} onClick={() => targets.data && setGrid(fromRecords(months, targets.data.rows))}>
            元に戻す
          </Button>
          {msg ? (
            <span className={`small ${msg.tone === 'err' ? 'err' : 'muted'}`} role="status">
              {msg.text}
            </span>
          ) : null}
        </div>
      </section>
      <CompanySettingsForm companyId={id} settings={detail.data.settings} defaults={{ ownerName: c.salesStaff ?? c.sfOwnerName, ownerSrc: OWNER_SOURCE_LABEL[meta.ownerSource] ?? meta.ownerSource, scoutLimit: c.limits.scout, jobLimit: c.limits.job }} canEdit={canEdit} onSaved={() => history.refetch()} />
      <section className="card">
        <div className="card-head">
          <h2>変更履歴</h2>
          <span className="lead">直近 30 件</span>
        </div>
        <ChangeHistory rows={history.data?.rows ?? []} />
      </section>
    </>
  );
}
