import { fmtInt, fmtRate } from '../../lib/format';
import { fmtMonthJa } from '../../../shared/calendar/periods';

export interface CohortMatrixData {
  months: string[];
  statuses: string[];
  /** `${month}|${status}` → 件数 */
  cells: Map<string, number>;
  totals: Map<string, number>;
  hiredKey: string;
}

/** コホート月 × 現ステータスのマトリクス。件数の濃淡は順序ランプ（1 色）、右端は合計と採用率 */
export function CohortMatrix({ data, labelOf, rowLabel }: { data: CohortMatrixData; labelOf: (s: string) => string; rowLabel: string }) {
  const max = Math.max(1, ...Array.from(data.cells.values()));
  const step = (v: number) => (v === 0 ? 0 : Math.min(6, 1 + Math.floor((v / max) * 5)));
  return (
    <div className="table-wrap">
      <table className="data compact cohort" aria-label={`${rowLabel} × 現在の選考ステータス`}>
        <thead>
          <tr>
            <th>{rowLabel}</th>
            {data.statuses.map((s) => (
              <th key={s} className="num">
                {labelOf(s)}
              </th>
            ))}
            <th className="num">合計</th>
            <th className="num">採用率</th>
          </tr>
        </thead>
        <tbody>
          {data.months.map((m) => {
            const total = data.totals.get(m) ?? 0;
            const hired = data.cells.get(`${m}|${data.hiredKey}`) ?? 0;
            return (
              <tr key={m}>
                <td className="nowrap">{fmtMonthJa(m)}</td>
                {data.statuses.map((s) => {
                  const v = data.cells.get(`${m}|${s}`) ?? 0;
                  const k = step(v);
                  return (
                    <td key={s} className={`num cohort-cell seq-${k}`} title={`${fmtMonthJa(m)} ${labelOf(s)}: ${fmtInt(v)} 件`}>
                      {v ? fmtInt(v) : ''}
                    </td>
                  );
                })}
                <td className="num">
                  <b>{fmtInt(total)}</b>
                </td>
                <td className="num">{total ? fmtRate(hired / total, 1) : '–'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
