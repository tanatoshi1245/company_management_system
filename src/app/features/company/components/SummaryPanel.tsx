import { Help } from '../../../components/ui/Help';
import { fmtInt } from '../../../lib/format';

export interface SummaryStat {
  key: string;
  label: string;
  value: number | null;
  unit?: string;
  note?: string;
  zero?: boolean;
}

/** 実績の数値タイル（直近 13 か月の累積）。求人関連 / スカウト関連で 1 枚ずつ */
export function SummaryPanel({ title, help, lead, stats, testId }: { title: string; help: string; lead: string; stats: SummaryStat[]; testId: string }) {
  return (
    <section className="card" aria-label={title} data-testid={testId}>
      <div className="card-head">
        <h2>
          {title} <Help text={help} />
        </h2>
        <span className="lead">{lead}</span>
      </div>
      <div className="stat-grid four">
        {stats.map((st) => (
          <div key={st.key} className={`stat${st.zero ? ' zero' : ''}`} data-stat={st.key} title={st.note}>
            <span className="t">{st.label}</span>
            <span className="v num">
              {st.value === null ? '–' : fmtInt(st.value)}
              {st.unit ? <span className="u">{st.unit}</span> : null}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
