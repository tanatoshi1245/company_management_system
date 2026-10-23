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
import { COMPANY_TYPE_SHORT, SCOUT_UNUSED_REASONS, surname } from '../../../shared/labels';
import { addMonths, fmtMonthJa, isoToJstDisplay, lastNMonths } from '../../../shared/calendar/periods';
import { isContracted, normalizeQuery } from '../../../shared/metrics/board';
import { fmtInt } from '../../lib/format';

const UrlSchema = z.object({
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).or(z.literal('')).default(''),
  mine: z.enum(['0', '1']).default('0'),
  q: z.string().max(100).default(''),
});

/** スカウト未使用の企業 = その月に契約中・送信 0 件・スカウト枠あり */
export function isScoutUnused(c: BoardCompany, meta: { isCurrentMonth: boolean }): boolean {
  return isContracted(c, meta) && c.m.sent === 0 && c.limits.scout !== null && c.limits.scout > 0;
}

type Draft = { reason: string; remarks: string };
const draftOf = (e: ScoutUnusedEntry | null): Draft => ({ reason: e?.reason ?? '', remarks: e?.remarks ?? '' });
const same = (a: Draft, b: Draft) => a.reason === b.reason && a.remarks.trim() === b.remarks.trim();

/** スカウト未利用の理由・補足の登録。既定は前月。保存は行ごと（D1 に保存 → BigQuery に反映） */
export default function ScoutUnusedPage(_props: PageProps) {
  const { meta, me } = useSession();
  const [url, setUrl] = useUrlState(UrlSchema, { month: '', mine: '0', q: '' });
  const defaultMonth = meta ? addMonths(meta.month, -1) : null;
  const month = url.month || defaultMonth;
  const months = meta ? lastNMonths(meta.month, 14) : [];
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
  const rows = useMemo(() => {
    if (!board.data) return null;
    const q = normalizeQuery(url.q);
    return board.data.companies
      .filter((c) => isScoutUnused(c, board.data!.meta))
      .filter((c) => (url.mine === '1' ? c.isMine : true))
      .filter((c) => (q ? normalizeQuery(c.name).includes(q) || (c.owner.name ? normalizeQuery(c.owner.name).includes(q) : false) : true))
      .sort((a, b) => (a.owner.name ?? '～').localeCompare(b.owner.name ?? '～', 'ja') || a.name.localeCompare(b.name, 'ja'));
  }, [board.data, url.mine, url.q]);
  const unsynced = (reg.data?.entries ?? []).filter((e) => e.bqSyncedAt === null || e.bqSyncedAt < e.updatedAt).length;
  const draft = (id: string): Draft => drafts.get(id) ?? draftOf(entries.get(id) ?? null);
  const setDraft = (id: string, d: Draft) => setDrafts((m) => new Map(m).set(id, d));
  const save = async (id: string) => {
    if (!month) return;
    const d = draft(id);
    const current = entries.get(id) ?? null;
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
        if (!res.bq.synced) setErrors((m) => new Map(m).set(id, `保存しました（BigQuery 未反映: ${res.bq.error ?? '不明'}）。「BQ に再同期」で再試行できます`));
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
        context={month ? `${fmtMonthJa(month)} にスカウトを 1 件も送っていない契約中の企業（スカウト枠あり）${rows ? ` ・ ${fmtInt(rows.length)} 社` : ''}${reg.data ? ` ・ 登録済み ${fmtInt(reg.data.entries.length)} 社` : ''}` : null}
        actions={
          <>
            <label className="field">
              <span>月</span>
              <select className="ctl" value={month ?? ''} aria-label="対象月" onChange={(e) => setUrl({ month: e.target.value === defaultMonth ? '' : e.target.value })}>
                {[...months].reverse().map((m) => (
                  <option key={m} value={m}>
                    {fmtMonthJa(m)}
                  </option>
                ))}
              </select>
            </label>
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
        <input type="search" className="ctl" placeholder="企業名・担当で検索" aria-label="企業名・担当で検索" value={url.q} onChange={(e) => setUrl({ q: e.target.value })} />
        <span className="spacer" />
        <span className="muted small">
          理由はプルダウン、補足は自由記述（500 文字まで）。保存すると企業ページの「スカウト未利用状況」に即時反映、BigQuery（cms_scout_unused_app）にも書き込む <Help text="保存先は D1（アプリの DB）が正。BigQuery への書き込みに失敗しても保存は残り、「BQ に再同期」で再試行できる。マート（翌朝 07:45）はシート取込とアプリの登録を統合し、同じ企業・月はアプリの値を優先する" />
        </span>
      </div>
      {!rows || !bm ? (
        <Skeleton variant="row" rows={8} />
      ) : rows.length === 0 ? (
        <div className="empty">
          <b>該当する企業がありません</b>
          {fmtMonthJa(bm.month)} はスカウト枠のある契約中の企業がすべて 1 件以上送信しています
        </div>
      ) : (
        <div className="table-wrap card">
          <table className="data unused-reg" aria-label="スカウト未使用の企業と理由の登録">
            <thead>
              <tr>
                <th>企業名</th>
                <th>種別</th>
                <th>営業担当</th>
                <th className="num">枠</th>
                <th>理由</th>
                <th>補足</th>
                <th>保存</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => {
                const d = draft(c.id);
                const cur = entries.get(c.id) ?? null;
                const sh = sheet.get(c.id) ?? null;
                const dirty = !same(d, draftOf(cur));
                const busy = saving.has(c.id);
                const err = errors.get(c.id);
                return (
                  <tr key={c.id} data-company={c.id} className={dirty ? 'dirty' : ''}>
                    <td>
                      <Link to={`/companies/${c.id}?month=${bm.month}`} className="nm">
                        {c.name}
                      </Link>
                      {sh && !cur ? <SheetHint row={sh} onCopy={canEdit ? () => setDraft(c.id, { reason: sh.reason ?? '', remarks: sh.remarks ?? '' }) : undefined} /> : null}
                    </td>
                    <td>
                      <Badge tone="navy">{COMPANY_TYPE_SHORT[c.type] ?? c.type}</Badge>
                    </td>
                    <td className="nowrap">{c.owner.name ? surname(c.owner.name) : <span className="muted">未設定</span>}</td>
                    <td className="num">{fmtInt(c.limits.scout)}</td>
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
                      <Button size="sm" variant={dirty ? 'primary' : 'default'} disabled={!canEdit || !dirty} loading={busy} onClick={() => save(c.id)}>
                        {cur && !d.reason && !d.remarks.trim() ? '削除' : '保存'}
                      </Button>
                      <div className="status small">
                        {err ? (
                          <span className="warn-text">{err}</span>
                        ) : cur ? (
                          <>
                            <span className={cur.bqSyncedAt && cur.bqSyncedAt >= cur.updatedAt ? 'ok' : 'warn-text'}>{cur.bqSyncedAt && cur.bqSyncedAt >= cur.updatedAt ? 'BQ 反映済み' : 'BQ 未反映'}</span>
                            <span className="muted"> ・ {surname(cur.updatedBy.split('@')[0]) ?? cur.updatedBy} {isoToJstDisplay(cur.updatedAt) ?? ''}</span>
                          </>
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

/** シート取込に既にある記録を薄く出し、「取り込む」で入力欄にコピー */
function SheetHint({ row, onCopy }: { row: ScoutUnusedSheetRow; onCopy?: () => void }) {
  return (
    <div className="sheet-hint small muted">
      シート: {row.reason ?? '–'}
      {row.remarks ? ` / ${row.remarks}` : ''}
      {onCopy ? (
        <button type="button" className="btn ghost sm" onClick={onCopy}>
          取り込む
        </button>
      ) : null}
    </div>
  );
}
