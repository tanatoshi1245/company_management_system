import { useState } from 'react';
import type { CompanyModel } from '../companyModel';
import { DualLineChart } from '../../../components/charts/DualLineChart';
import { SeriesTable } from './SeriesTable';
import { Help } from '../../../components/ui/Help';
import { fmtMonthShort } from '../../../../shared/calendar/periods';
import { fmtInt } from '../../../lib/format';

/** 契約期間中の累積（閲覧人数・応募人数）。マートの窓（直近 13 か月 + 当月）に限る */
export function CumulativePanel({ m }: { m: CompanyModel }) {
  const [table, setTable] = useState(false);
  const c = m.cumulative;
  const lead = c.months.length ? `${fmtMonthShort(c.fromMonth)} からの累積${c.truncated ? '（契約開始はそれ以前。直近 13 か月 + 当月のみ）' : ''}` : '契約期間のデータがありません';
  return (
    <section className="card" aria-label="契約期間中の累積（閲覧・応募）">
      <div className="card-head">
        <h2>
          契約期間中の累積（閲覧・応募） <Help text="契約開始月から各月までの累積。閲覧 = 求人を閲覧した会員数、応募 = 応募数。マートは直近 13 か月 + 当月しか持たないため、それより前の契約開始は窓の先頭からの累積" />
        </h2>
        <span className="lead">{lead}</span>
        <button type="button" className="btn ghost sm" onClick={() => setTable((t) => !t)}>
          {table ? 'グラフで見る' : '表で見る'}
        </button>
      </div>
      {table ? (
        <SeriesTable months={c.months} cols={[{ label: '閲覧（累積）', values: c.views }, { label: '応募（累積）', values: c.apps }]} ariaLabel="契約期間中の累積（閲覧・応募）の表" />
      ) : (
        <DualLineChart months={c.months} series={[{ key: 'views', label: '閲覧人数（累積）', values: c.views, color: '--cat-1' }, { key: 'apps', label: '応募人数（累積）', values: c.apps, color: '--cat-2' }]} format={fmtInt} ariaLabel="契約期間中の閲覧人数と応募人数の累積" partialLast={c.partialLast} />
      )}
    </section>
  );
}
