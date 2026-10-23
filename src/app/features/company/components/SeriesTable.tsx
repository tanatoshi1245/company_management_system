import { fmtMonthShort } from '../../../../shared/calendar/periods';
import { fmtInt } from '../../../lib/format';

/** 2 系列の折れ線の「表で見る」 */
export function SeriesTable({ months, cols, ariaLabel }: { months: string[]; cols: { label: string; values: number[] }[]; ariaLabel: string }) {
  return (
    <div className="table-wrap">
      <table className="data compact" aria-label={ariaLabel}>
        <thead>
          <tr>
            <th>月</th>
            {cols.map((c) => (
              <th key={c.label} className="num">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {months.map((m, i) => (
            <tr key={m}>
              <td className="nowrap">{fmtMonthShort(m)}</td>
              {cols.map((c) => (
                <td key={c.label} className="num">
                  {fmtInt(c.values[i])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
