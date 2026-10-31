import { useEffect, useMemo, useState } from 'react';
import { z } from 'zod';
import type { PageProps } from '../../router';
import { Link } from '../../router';
import { useSession } from '../../lib/session';
import { invalidate, useResource } from '../../lib/useResource';
import { useUrlState } from '../../lib/urlState';
import { apiSend } from '../../lib/api';
import { PageHeader } from '../../components/ui/PageHeader';
import { Skeleton } from '../../components/ui/Skeleton';
import { Notice } from '../../components/ui/Notice';
import { Chip } from '../../components/ui/Chip';
import { Button } from '../../components/ui/Button';
import { Icon } from '../../components/ui/Icon';
import { Badge } from '../../components/ui/Badge';
import { Help } from '../../components/ui/Help';
import { BoardResponseSchema, type BoardCompany } from '../../../shared/schema/board';
import { ScoutUnusedMonthResponseSchema, ScoutUnusedSaveResponseSchema, ScoutUnusedSyncResponseSchema, type ScoutUnusedEntry, type ScoutUnusedSheetRow } from '../../../shared/schema/scoutUnused';
import { COMPANY_TYPES, COMPANY_TYPE_SHORT, CONTRACT_KIND_LABEL, SCOUT_UNUSED_REASONS, surname } from '../../../shared/labels';
import { addMonths, fmtMonthJa, isoToJstDisplay } from '../../../shared/calendar/periods';
import { boardAccountTypes, normalizeQuery, ownerKey } from '../../../shared/metrics/board';
import { MultiPick } from '../home/components/BoardFilterBar';
import { fmtInt } from '../../lib/format';

const UrlSchema = z.object({
  mine: z.enum(['0', '1']).default('0'),
  /** CS 担当（ownerKey をカンマ区切り） */
  owner: z.string().max(2000).default(''),
  /** 登録状況: none = 未登録 / done = 登録済み（アプリ or シート）/ unsynced = BQ 未反映 */
  status: z.enum(['', 'none', 'done', 'unsynced']).default(''),
  /** 企業種別（カンマ区切り。空 = すべて） */
  type: z.string().max(200).default(''),
  /** 契約種別（ad / success / unknown のカンマ区切り。空 = すべて） */
  kind: z.string().max(100).default(''),
  q: z.string().max(100).default(''),
});

export type RegStatus = 'none' | 'done' | 'unsynced';
export const REG_STATUS_LABEL: Record<RegStatus, string> = { none: '未登録', done: '登録済み', unsynced: 'BQ 未反映' };
type FilterKey = 'mine' | 'owner' | 'status' | 'type' | 'kind' | 'q';

/** 登録の対象外の企業種別（DA・RPO は Daijob 側でスカウトを運用、NW はスカウト枠の無い Network 契約） */
export const SCOUT_UNUSED_EXCLUDED_TYPES: ReadonlySet<string> = new Set(['DA', 'RPO', 'NW']);

/**
 * スカウト未使用の企業 = 前月に 1 日でも求人を掲載し（jobsInMonth > 0）、前月の送信が 0 件で、今日時点で契約中（active / ending_30d）の企業。DA / RPO / NW 以外（2026-10-31〜）。
 * 枠数では絞らない（契約が終わると枠が 0 に戻るため）。`/api/board?month=<前月>` の m は前月の値、state は今日時点の契約状態
 */
export function isScoutUnused(c: BoardCompany): boolean {
  return (c.state === 'active' || c.state === 'ending_30d') && c.m.sent === 0 && c.m.jobsInMonth > 0 && !SCOUT_UNUSED_EXCLUDED_TYPES.has(c.type);
}

type Draft = { reason: string; remarks: string };
/** 入力欄の初期値: アプリの登録（D1）があればそれ、無ければ BQ に既にある記録（シート取込）。どちらも無ければ空 */
const draftOf = (e: ScoutUnusedEntry | null, sh: ScoutUnusedSheetRow | null = null): Draft => ({ reason: e?.reason ?? sh?.reason ?? '', remarks: e?.remarks ?? sh?.remarks ?? '' });
const same = (a: Draft, b: Draft) => a.reason === b.reason && a.remarks.trim() === b.remarks.trim();

/** スカウト未利用の理由・補足の登録。対象は前月（固定）。登録は行ごと（D1 に保存 → BigQuery に反映）。フィルタ（CS 担当 / 登録状況 / 企業種別 / 契約種別）は互いに連動する */
export default function ScoutUnusedPage(_props: PageProps) {
  const { meta, me } = useSession();
  const [url, setUrl] = useUrlState(UrlSchema, { mine: '0', owner: '', status: '', type: '', kind: '', q: '' });
  const split = (v: string) => (v ? v.split(',').filter(Boolean) : []);
  const ownerFilter = useMemo(() => split(url.owner), [url.owner]);
  const typeFilter = useMemo(() => split(url.type), [url.type]);
  const kindFilter = useMemo(() => split(url.kind), [url.kind]);
  /** 対象月 = 前月（固定。登録期間が終わった月は振り返らない） */
  const month = meta ? addMonths(meta.month, -1) : null;
  const board = useResource(month ? `/api/board?month=${month}` : null, BoardResponseSchema, { ttlMs: 5 * 60_000 });
  const reg = useResource(month ? `/api/scout-unused?month=${month}` : null, ScoutUnusedMonthResponseSchema, { ttlMs: 0 });
  const canEdit = Boolean(me?.canEdit);
  const [drafts, setDrafts] = useState<Map<string, Draft>>(new Map());
  const [saving, setSaving] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Map<string, string>>(new Map());
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const entries = useMemo(() => new Map((reg.data?.entries ?? []).map((e) => [e.companyId, e])), [reg.data]);
  const sheet = useMemo(() => new Map((reg.data?.sheet ?? []).map((s) => [s.companyId, s])), [reg.data]);
  useEffect(() => {
    setDrafts(new Map());
    setErrors(new Map());
  }, [month]);
  /** その月のスカウト未使用の企業（絞り込み前） */
  const unusedAll = useMemo(() => (board.data ? board.data.companies.filter((c) => isScoutUnused(c)) : null), [board.data]);
  /** 登録状況（アプリの登録が BQ 未反映なら unsynced、アプリかシートに登録があれば done） */
  const statusOf = (id: string): RegStatus => {
    const e = entries.get(id);
    if (e) return e.bqSyncedAt === null || e.bqSyncedAt < e.updatedAt ? 'unsynced' : 'done';
    return sheet.has(id) ? 'done' : 'none';
  };
  const q = normalizeQuery(url.q);
  /** 各フィルタの判定。選択肢は「その項目以外のフィルタ」を通った企業から作る（フィルタ同士の連動） */
  const preds: Record<FilterKey, (c: BoardCompany) => boolean> = {
    mine: (c) => (url.mine === '1' ? c.isMine : true),
    owner: (c) => (ownerFilter.length ? ownerFilter.includes(ownerKey(c)) : true),
    status: (c) => (url.status === '' ? true : url.status === 'done' ? statusOf(c.id) !== 'none' : statusOf(c.id) === url.status),
    type: (c) => (typeFilter.length ? boardAccountTypes(c).some((t) => typeFilter.includes(t)) : true),
    kind: (c) => (kindFilter.length ? kindFilter.includes(c.contractKind) : true),
    q: (c) => (q ? normalizeQuery(c.name).includes(q) || (c.owner.name ? normalizeQuery(c.owner.name).includes(q) : false) : true),
  };
  const passes = (c: BoardCompany, except?: FilterKey) => (Object.keys(preds) as FilterKey[]).every((k) => k === except || preds[k](c));
  /** CS 担当の選択肢（他のフィルタを通った企業の担当と件数。選択中は 0 件でも残す。未設定は末尾） */
  const owners = useMemo(() => {
    const m = new Map<string, { key: string; label: string; title: string; count: number }>();
    const info = (c: BoardCompany) => ({ key: ownerKey(c), label: c.owner.name ? (surname(c.owner.name) ?? c.owner.name) : '未設定', title: c.owner.name ?? '担当未設定' });
    for (const c of unusedAll ?? []) {
      if (!passes(c, 'owner')) continue;
      const key = ownerKey(c);
      const cur = m.get(key);
      if (cur) cur.count += 1;
      else m.set(key, { ...info(c), count: 1 });
    }
    for (const key of ownerFilter) {
      if (m.has(key)) continue;
      const any = (unusedAll ?? []).find((c) => ownerKey(c) === key);
      m.set(key, any ? { ...info(any), count: 0 } : { key, label: key, title: key, count: 0 });
    }
    return Array.from(m.values()).sort((a, b) => (a.label === '未設定' ? 1 : b.label === '未設定' ? -1 : b.count - a.count || a.label.localeCompare(b.label, 'ja')));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unusedAll, url.mine, url.status, url.q, typeFilter, kindFilter, ownerFilter, entries, sheet]);
  /** 企業種別の選択肢（COMPANY_TYPES の順。不明は 0 件なら出さない。副アカウントの種別も数える） */
  const types = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of unusedAll ?? []) if (passes(c, 'type')) for (const t of boardAccountTypes(c)) m.set(t, (m.get(t) ?? 0) + 1);
    return COMPANY_TYPES.filter((t) => !SCOUT_UNUSED_EXCLUDED_TYPES.has(t) && (t !== '不明' || m.get(t) || typeFilter.includes(t))).map((t) => ({ key: t, label: COMPANY_TYPE_SHORT[t], count: m.get(t) ?? 0 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unusedAll, url.mine, url.status, url.q, typeFilter, kindFilter, ownerFilter, entries, sheet]);
  /** 契約種別の選択肢（広告掲載 / 成功報酬。不明は 0 件なら出さない） */
  const kinds = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of unusedAll ?? []) if (passes(c, 'kind')) m.set(c.contractKind, (m.get(c.contractKind) ?? 0) + 1);
    return (['ad', 'success', 'unknown'] as const).filter((k) => k !== 'unknown' || m.get(k) || kindFilter.includes(k)).map((k) => ({ key: k, label: CONTRACT_KIND_LABEL[k], count: m.get(k) ?? 0 }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unusedAll, url.mine, url.status, url.q, typeFilter, kindFilter, ownerFilter, entries, sheet]);
  const rows = useMemo(() => {
    if (!unusedAll) return null;
    return unusedAll.filter((c) => passes(c)).sort((a, b) => (a.owner.name ?? '～').localeCompare(b.owner.name ?? '～', 'ja') || a.name.localeCompare(b.name, 'ja'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unusedAll, url.mine, url.status, url.q, typeFilter, kindFilter, ownerFilter, entries, sheet]);
  const filtering = Boolean(ownerFilter.length || url.mine === '1' || url.status || typeFilter.length || kindFilter.length || url.q);
  const unsynced = (reg.data?.entries ?? []).filter((e) => e.bqSyncedAt === null || e.bqSyncedAt < e.updatedAt).length;
  // 登録済みの行も同じ欄で編集できる（変更すると登録ボタンが有効になり、PUT で更新する）
  const base = (id: string): Draft => draftOf(entries.get(id) ?? null, sheet.get(id) ?? null);
  const draft = (id: string): Draft => drafts.get(id) ?? base(id);
  const setDraft = (id: string, d: Draft) => setDrafts((m) => new Map(m).set(id, d));
  const save = async (id: string) => {
    if (!month) return;
    const d = draft(id);
    const current = entries.get(id) ?? null;
    // シート取込しか無い行を空にしても消せない（シートの行は触らない）ので何もしない
    if (!current && !d.reason && !d.remarks.trim()) return;
    setSaving((s) => new Set(s).add(id));
    setErrors((m) => {
      const n = new Map(m);
      n.delete(id);
      return n;
    });
    try {
      const empty = !d.reason && !d.remarks.trim();
      if (empty) {
        if (current) await apiSend('DELETE', `/api/scout-unused/${id}/${month}`, undefined, ScoutUnusedSaveResponseSchema);
      } else {
        const res = await apiSend('PUT', `/api/scout-unused/${id}/${month}`, { reason: d.reason || null, remarks: d.remarks.trim() || null }, ScoutUnusedSaveResponseSchema);
        if (!res.bq.synced) setErrors((m) => new Map(m).set(id, `登録しました（BigQuery 未反映: ${res.bq.error ?? '不明'}）。「BQ に再同期」で再試行できます`));
      }
      invalidate('/api/scout-unused');
      invalidate(`/api/companies/${id}`);
      setDrafts((m) => {
        const n = new Map(m);
        n.delete(id);
        return n;
      });
      await reg.refetch();
    } catch (e) {
      setErrors((m) => new Map(m).set(id, e instanceof Error ? e.message : String(e)));
    } finally {
      setSaving((s) => {
        const n = new Set(s);
        n.delete(id);
        return n;
      });
    }
  };
  const sync = async () => {
    setSyncMsg(null);
    try {
      const r = await apiSend('POST', '/api/scout-unused/sync', {}, ScoutUnusedSyncResponseSchema);
      setSyncMsg(`BigQuery に ${fmtInt(r.synced)} 件反映${r.failed ? `、${fmtInt(r.failed)} 件失敗（残り ${fmtInt(r.pending)} 件）` : ''}`);
      invalidate('/api/scout-unused');
      await reg.refetch();
    } catch (e) {
      setSyncMsg(e instanceof Error ? e.message : String(e));
    }
  };
  const bm = board.data?.meta;
  return (
    <>
      <PageHeader
        title="スカウト未利用の理由"
        context={month ? `${fmtMonthJa(month)} に求人を掲載しながらスカウトを 1 件も送らなかった、現在契約中の企業${rows ? ` ・ ${fmtInt(rows.length)} 社` : ''}${reg.data && rows ? ` ・ 登録済み ${fmtInt(rows.filter((c) => statusOf(c.id) !== 'none').length)} 社` : ''}` : null}
        actions={
          <>
            {unsynced > 0 ? (
              <Button size="sm" disabled={!canEdit} onClick={sync} title="D1 に保存済みで BigQuery に未反映の登録を書き直す">
                <Icon name="refresh" size={14} /> BQ に再同期（{fmtInt(unsynced)}）
              </Button>
            ) : null}
          </>
        }
      />
      {board.error ? <Notice tone="error">{board.error.message}</Notice> : null}
      {reg.error ? <Notice tone="error">{reg.error.message}</Notice> : null}
      {!canEdit ? <Notice tone="warn">閲覧のみです。登録には Google ログインが必要です</Notice> : null}
      {syncMsg ? <Notice tone="info">{syncMsg}</Notice> : null}
      <div className="sticky-bar" role="search" aria-label="絞り込み">
        <Chip label="担当 = 自分" on={url.mine === '1'} onClick={() => setUrl({ mine: url.mine === '1' ? '0' : '1' })} icon={<Icon name="filter" size={14} />} />
        <MultiPick label="CS 担当" ariaLabel="CS 担当" options={owners} value={ownerFilter} onChange={(owner) => setUrl({ owner: owner.join(',') })} />
        <div className="field">
          <label htmlFor="su-status">登録状況</label>
          <select id="su-status" className="ctl" value={url.status} onChange={(e) => setUrl({ status: e.target.value as typeof url.status })}>
            <option value="">すべて</option>
            {(Object.keys(REG_STATUS_LABEL) as RegStatus[]).map((k) => (
              <option key={k} value={k}>
                {REG_STATUS_LABEL[k]}
              </option>
            ))}
          </select>
        </div>
        <MultiPick label="企業種別" ariaLabel="企業種別" options={types} value={typeFilter} onChange={(type) => setUrl({ type: type.join(',') })} />
        <MultiPick label="契約種別" ariaLabel="契約種別" options={kinds} value={kindFilter} onChange={(kind) => setUrl({ kind: kind.join(',') })} />
        {filtering ? (
          <button type="button" className="btn ghost sm" onClick={() => setUrl({ mine: '0', owner: '', status: '', type: '', kind: '', q: '' })}>
            <Icon name="close" size={14} /> クリア
          </button>
        ) : null}
        <input type="search" className="ctl" placeholder="企業名・担当で検索" aria-label="企業名・担当で検索" value={url.q} onChange={(e) => setUrl({ q: e.target.value })} />
        <span className="spacer" />
        <span className="muted small">
          <span className="ad-mark">広告掲載</span> の企業は企業名を黄色で表示。理由はプルダウン、補足は自由記述（500 文字まで）。BQ に既にある記録（シート取込）は入力欄にそのまま出る。登録すると企業ページの「スカウト未利用状況」に即時反映、BigQuery（scout_unused_companies_monthly）にも書き込む <Help text="登録先は D1（アプリの DB）が正。BigQuery にはシート取込と同じ表に match_method = 'app' の行として書き、失敗しても登録は残り「BQ に再同期」で再試行できる。同じ企業・月にシートの記録がある場合もアプリの登録が優先され、重複して数えない。対象は前月に 1 日でも求人を掲載し、前月のスカウト送信が 0 件で、今日時点で契約中の企業（DA / RPO / NW 以外）。枠数では絞らない。前月分だけを扱う" />
        </span>
      </div>
      {!rows || !bm ? (
        <Skeleton variant="row" rows={8} />
      ) : rows.length === 0 ? (
        <div className="empty">
          <b>該当する企業がありません</b>
          {unusedAll && unusedAll.length ? '絞り込みを変えてください（担当 = 自分 / CS 担当 / 登録状況 / 企業種別 / 契約種別 / 検索）' : `${fmtMonthJa(bm.month)} に求人を掲載した現在契約中の企業は、すべて 1 件以上送信しています`}
        </div>
      ) : (
        <div className="table-wrap card">
          <table className="data unused-reg" aria-label="スカウト未使用の企業と理由の登録">
            <colgroup>
              <col className="c-type" />
              <col className="c-owner" />
              <col className="c-name" />
              <col className="c-reason" />
              <col className="c-remarks" />
              <col className="c-save" />
            </colgroup>
            <thead>
              <tr>
                <th>種別</th>
                <th>CS 担当</th>
                <th>企業名</th>
                <th>理由</th>
                <th>補足</th>
                <th>登録</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                const d = draft(c.id);
                const cur = entries.get(c.id) ?? null;
                const sh = sheet.get(c.id) ?? null;
                const dirty = !same(d, base(c.id));
                const empty = !d.reason && !d.remarks.trim();
                const busy = saving.has(c.id);
                const err = errors.get(c.id);
                return (
                  <tr key={c.id} data-company={c.id} className={dirty ? 'dirty' : ''}>
                    <td>
                      <Badge tone="navy">{COMPANY_TYPE_SHORT[c.type] ?? c.type}</Badge>
                    </td>
                    <td className="nowrap owner" title={c.owner.name ?? undefined}>
                      {c.owner.name ? surname(c.owner.name) : <span className="muted">未設定</span>}
                    </td>
                    <td className={`company${c.contractKind === 'ad' ? ' ad' : ''}`} title={`${c.name}（${CONTRACT_KIND_LABEL[c.contractKind]}）`}>
                      <Link to={`/companies/${c.id}?month=${bm.month}`} className="nm">
                        {c.name}
                      </Link>
                    </td>
                    <td>
                      <select className="ctl" aria-label={`${c.name} の理由`} value={d.reason} disabled={!canEdit || busy} onChange={(e) => setDraft(c.id, { ...d, reason: e.target.value })}>
                        <option value="">（未選択）</option>
                        {SCOUT_UNUSED_REASONS.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input type="text" className="ctl remarks" aria-label={`${c.name} の補足`} maxLength={500} value={d.remarks} disabled={!canEdit || busy} placeholder="補足（任意）" onChange={(e) => setDraft(c.id, { ...d, remarks: e.target.value })} />
                    </td>
                    <td className="nowrap">
                      <Button size="sm" variant={dirty ? 'primary' : 'default'} disabled={!canEdit || !dirty || (!cur && empty)} loading={busy} onClick={() => save(c.id)} title={!cur && empty && sh ? 'シート取込の記録は画面からは消せません' : undefined}>
                        {cur && empty ? '削除' : '登録'}
                      </Button>
                      <div className="status small">
                        {err ? (
                          <span className="warn-text">{err}</span>
                        ) : cur ? (
                          <>
                            <span className={cur.bqSyncedAt && cur.bqSyncedAt >= cur.updatedAt ? 'ok' : 'warn-text'}>{cur.bqSyncedAt && cur.bqSyncedAt >= cur.updatedAt ? 'BQ 反映済み' : 'BQ 未反映'}</span>
                            <span className="muted"> ・ {surname(cur.updatedBy.split('@')[0]) ?? cur.updatedBy} {isoToJstDisplay(cur.updatedAt) ?? ''}</span>
                          </>
                        ) : sh ? (
                          <span className="ok">登録済み</span>
                        ) : (
                          <span className="muted">未登録</span>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
