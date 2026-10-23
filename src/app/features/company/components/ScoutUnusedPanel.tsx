import type { ScoutUnusedRow } from '../../../../shared/schema/company';
import { Help } from '../../../components/ui/Help';
import { fmtMonthShort } from '../../../../shared/calendar/periods';

/** スカウト未利用状況（CS が月次で記入した理由と補足。契約期間中の全月） */
export function ScoutUnusedPanel({ rows }: { rows: ScoutUnusedRow[] }) {
  return (
    <section className="card" aria-label="スカウト未利用状況">
      <div className="card-head">
        <h2>
          スカウト未利用状況 <Help text="スカウトを使わなかった月について CS が記入した理由と補足（scout_unused_companies_monthly）。契約期間に入る月をすべて、新しい月から表示" />
        </h2>
        <span className="lead">{rows.length ? `${rows.length} 件（契約期間中）` : ''}</span>
      </div>
      {rows.length ? (
        <div className="table-wrap">
          <table className="data compact unused" aria-label="スカウト未利用の記録">
            <thead>
              <tr>
                <th>対象月</th>
                <th>理由</th>
                <th>補足</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={`${r.month}-${i}`}>
                  <td className="nowrap">{fmtMonthShort(r.month)}</td>
                  <td>{r.reason ?? <span className="muted">–</span>}</td>
                  <td>{r.remarks ?? <span className="muted">–</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="empty">未利用の記録はありません</div>
      )}
    </section>
  );
}
