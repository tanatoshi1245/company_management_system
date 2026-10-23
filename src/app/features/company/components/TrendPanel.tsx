import { useState } from 'react';
import type { CompanyModel } from '../companyModel';
import { SmallMultiples } from '../../../components/charts/SmallMultiples';
import { Help } from '../../../components/ui/Help';
import { fmtMonthShort } from '../../../../shared/calendar/periods';
import { fmtInt } from '../../../lib/format';

export function TrendPanel({ m }: { m: CompanyModel }) {
  const [table, setTable] = useState(false);
  return (
    <section className="card">
      <div className="card-head">
        <h2>
          13 か月の推移 <Help text="当月は途中経過（点線）。破線は契約時の目標、薄い帯は同業種・同種別の p25〜p75（5 社未満は上位の群で代替）" />
        </h2>
        <button type="button" className="btn ghost sm" onClick={() => setTable((t) => !t)}>
          {table ? 'グラフで見る' : '表で見る'}
        </button>
      </div>
      {table ? (
        <div className="table-wrap">
          <table className="data compact" aria-label="月次の実績">
            <thead>
              <tr>
                <th>月</th>
                {m.panels.slice(0, 6).map((p) => (
                  <th key={p.key} className="num">
                    {p.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {m.months.map((mo, i) => (
                <tr key={mo}>
                  <td className="nowrap">{fmtMonthShort(mo)}</td>
                  {m.panels.slice(0, 6).map((p) => (
                    <td key={p.key} className="num">
                      {p.values[i] === null ? '–' : fmtInt(p.values[i])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <SmallMultiples months={m.months} panels={m.panels} cols={4} />
      )}
    </section>
  );
}
