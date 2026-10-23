import { Link } from '../../../router';
import { useResource } from '../../../lib/useResource';
import { SettingsListResponseSchema } from '../../../../shared/schema/settings';
import { BoardResponseSchema } from '../../../../shared/schema/board';
import { isoToJstDisplay } from '../../../../shared/calendar/periods';
import { fmtInt } from '../../../lib/format';

/** 担当・枠の上書きがある企業（D1 company_settings） */
export function OwnerOverrideList({ month }: { month: string | null }) {
  const list = useResource('/api/settings/overrides', SettingsListResponseSchema, { ttlMs: 0 });
  const board = useResource(month ? `/api/board?month=${month}` : null, BoardResponseSchema, { ttlMs: 5 * 60_000 });
  const names = new Map((board.data?.companies ?? []).map((c) => [c.id, c]));
  const rows = list.data?.rows ?? [];
  return (
    <section className="card" id="overrides">
      <div className="card-head">
        <h2>担当・枠の上書き</h2>
        <span className="lead">{fmtInt(rows.length)} 社</span>
      </div>
      {rows.length === 0 ? (
        <div className="empty">上書きはありません。企業の目標ページ「企業の設定」から登録できます</div>
      ) : (
        <div className="table-wrap">
          <table className="data compact" aria-label="担当・枠の上書き一覧">
            <thead>
              <tr>
                <th>企業</th>
                <th>担当（上書き）</th>
                <th>SF の担当</th>
                <th>スカウト枠</th>
                <th>求人枠</th>
                <th>期間</th>
                <th>メモ</th>
                <th>更新</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const c = names.get(r.companyId);
                return (
                  <tr key={r.companyId}>
                    <td>
                      <Link to={`/targets/${r.companyId}?from=${month ?? ''}#settings`}>{c?.name ?? `ID ${r.companyId}`}</Link>
                    </td>
                    <td>{r.csOwnerName ?? r.csOwnerEmail ?? <span className="muted">–</span>}</td>
                    <td className="small muted">{c?.sfOwnerName ?? '–'}</td>
                    <td className="num">{r.scoutLimitOverride === null ? <span className="muted">–</span> : fmtInt(r.scoutLimitOverride)}</td>
                    <td className="num">{r.jobLimitOverride === null ? <span className="muted">–</span> : fmtInt(r.jobLimitOverride)}</td>
                    <td className="small">{r.scoutLimitPeriod === 'contract' ? '契約期間' : '月間'}</td>
                    <td className="small">{r.memo ?? ''}</td>
                    <td className="small muted">
                      {r.updatedBy.split('@')[0]} ・ {isoToJstDisplay(r.updatedAt)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
