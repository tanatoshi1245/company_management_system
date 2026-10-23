import { useState } from 'react';
import type { CompanyModel } from '../companyModel';
import { DualLineChart } from '../../../components/charts/DualLineChart';
import { SeriesTable } from './SeriesTable';
import { Help } from '../../../components/ui/Help';
import { fmtMonthShort } from '../../../../shared/calendar/periods';
import { fmtInt } from '../../../lib/format';

/** 閲覧人数と応募人数の月次推移（単月の実績）。契約期間中・マートの窓（直近 13 か月 + 当月）に限る */
export function ViewsAppsPanel({ m }: { m: CompanyModel }) {
  const [table, setTable] = useState(false);
  const v = m.viewsApps;
  const lead = v.months.length ? `${fmtMonthShort(v.fromMonth)}〜${fmtMonthShort(v.months[v.months.length - 1])}${v.truncated ? '（直近 13 か月 + 当月のみ）' : ''}` : '契約期間のデータがありません';
  return (
    <section className="card" aria-label="閲覧と応募の推移">
      <div className="card-head">
        <h2>
          閲覧と応募の推移 <Help text="月ごとの実績（累積ではない）。閲覧 = 求人を閲覧した会員数、応募 = 応募数。ボードの「閲覧」「応募」と同じ値" />
        </h2>
        <span className="lead">{lead}</span>
        <button type="button" className="btn ghost sm" onClick={() => setTable((t) => !t)}>
          {table ? 'グラフで見る' : '表で見る'}
        </button>
      </div>
      {table ? (
        <SeriesTable months={v.months} cols={[{ label: '閲覧', values: v.views }, { label: '応募', values: v.apps }]} ariaLabel="閲覧と応募の推移の表" />
      ) : (
        <DualLineChart months={v.months} series={[{ key: 'views', label: '閲覧人数', values: v.views, color: '--cat-1' }, { key: 'apps', label: '応募人数', values: v.apps, color: '--cat-2' }]} format={fmtInt} ariaLabel="閲覧人数と応募人数の月次推移" partialLast={v.partialLast} />
      )}
    </section>
  );
}
