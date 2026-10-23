import type { CompanyModel } from '../companyModel';
import type { CompanyDetailResponse } from '../../../../shared/schema/company';
import { Bullet } from '../../../components/charts/Bullet';
import { CumulativeChart } from '../../../components/charts/CumulativeChart';
import { Help } from '../../../components/ui/Help';
import { endOfMonth } from '../../../../shared/calendar/periods';
import { fmtInt, fmtRate } from '../../../lib/format';

export function UtilizationPanel({ d, m }: { d: CompanyDetailResponse; m: CompanyModel }) {
  const c = d.company;
  const s = m.scored;
  const jobBench = s.bench.job_utilization;
  const scoutBench = s.bench.scout_utilization;
  const daysInMonth = Number(endOfMonth(`${d.meta.month}-01`).slice(8, 10));
  return (
    <section className="card">
      <div className="card-head">
        <h2>
          利用状況 <Help text={`求人枠 = 掲載中の求人数 ÷ 枠数。スカウト枠 = 当月送信 ÷ 枠数（${c.limits.period === 'contract' ? '契約期間の累計' : '月間枠'}）。縦の印は営業日ペースでの期待値、▼ は同業種の中央値`} />
        </h2>
        <span className="lead">
          営業日 {d.meta.bizDays.elapsed}/{d.meta.bizDays.total} 日経過（{fmtRate(d.meta.bizDays.rate)}）
        </span>
      </div>
      <div className="grid-2">
        <Bullet label="求人枠" value={c.m.jobs} limit={c.limits.job} expected={null} median={jobBench?.median ?? null} note={`新規掲載 ${fmtInt(c.m.newJobs)} 件`} />
        <Bullet label={c.limits.period === 'contract' ? 'スカウト枠（契約期間の累計）' : 'スカウト枠（当月）'} value={c.limits.period === 'contract' ? c.m.sentCtd : c.m.sent} limit={c.limits.scout} expected={s.pace.expected} median={scoutBench?.median ?? null} status={s.pace.status} note={`手動 ${fmtInt(c.m.sentManual)} / 自動 ${fmtInt(c.m.sentAuto)}`} />
      </div>
      <div className="grid-2" style={{ marginTop: 12 }}>
        <div>
          <h3>スカウト送信の月内累積</h3>
          <CumulativeChart current={m.dailyCurrent.map((p) => ({ day: p.day, v: p.sentCum }))} previous={m.dailyPrev.map((p) => ({ day: p.day, v: p.sentCum }))} limit={c.limits.period === 'month' ? c.limits.scout : null} daysInMonth={daysInMonth} label="スカウト送信" />
        </div>
        <div>
          <h3>応募の月内累積</h3>
          <CumulativeChart current={m.dailyCurrent.map((p) => ({ day: p.day, v: p.appsCum }))} previous={m.dailyPrev.map((p) => ({ day: p.day, v: p.appsCum }))} limit={c.targets?.applications ?? null} daysInMonth={daysInMonth} label="応募" />
        </div>
      </div>
    </section>
  );
}
