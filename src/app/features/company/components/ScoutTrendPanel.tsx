import { useState } from 'react';
import type { CompanyModel } from '../companyModel';
import { DualLineChart } from '../../../components/charts/DualLineChart';
import { SeriesTable } from './SeriesTable';
import { Help } from '../../../components/ui/Help';
import { fmtMonthShort } from '../../../../shared/calendar/periods';
import { fmtInt } from '../../../lib/format';

/** スカウト送信件数と興味あり返信件数（返信月基準）の月次推移。選択期間（契約期間中・マートの窓内）・選択アカウント */
export function ScoutTrendPanel({ m }: { m: CompanyModel }) {
  const [table, setTable] = useState(false);
  const t = m.scoutTrend;
  const lead = t.months.length ? `${fmtMonthShort(t.fromMonth)}〜${fmtMonthShort(t.months[t.months.length - 1])}${t.truncated ? '（直近 13 か月 + 当月のみ）' : ''}` : 'この期間に契約期間のデータがありません';
  return (
    <section className="card" aria-label="スカウト送信と興味あり返信の推移">
      <div className="card-head">
        <h2>
          スカウト送信と興味あり返信の推移 <Help text="月ごとのスカウト送信数と、その月に「興味あり」返信があったスカウト数（送信月は問わない。質問・開封のみは含まない。ボードの「興味あり返信」と同じ）。桁が違うため左軸 = 送信件数、右軸 = 興味あり返信件数（目盛の数字は線の色）" />
        </h2>
        <span className="lead">{lead}</span>
        <button type="button" className="btn ghost sm" onClick={() => setTable((v) => !v)}>
          {table ? 'グラフで見る' : '表で見る'}
        </button>
      </div>
      {table ? (
        <SeriesTable months={t.months} cols={[{ label: '送信', values: t.sent }, { label: '興味あり返信', values: t.intReply }]} ariaLabel="スカウト送信と興味あり返信の推移の表" />
      ) : (
        <DualLineChart months={t.months} series={[{ key: 'sent', label: 'スカウト送信件数', values: t.sent, color: '--cat-1' }, { key: 'intReply', label: '興味あり返信件数', values: t.intReply, color: '--cat-2' }]} format={fmtInt} ariaLabel="スカウト送信件数と興味あり返信件数の月次推移（左軸 = 送信、右軸 = 興味あり返信）" partialLast={t.partialLast} dualAxis />
      )}
    </section>
  );
}
