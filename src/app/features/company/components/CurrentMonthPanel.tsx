import type { CompanyModel } from '../companyModel';
import type { CompanyDetailResponse } from '../../../../shared/schema/company';
import { Bullet } from '../../../components/charts/Bullet';
import { Help } from '../../../components/ui/Help';
import { fmtMonthJa } from '../../../../shared/calendar/periods';
import { fmtInt, fmtMd, fmtRate } from '../../../lib/format';

/** 当月の実績（ボードの列と同じ値・式）+ 求人枠 / スカウト枠のゲージ */
export function CurrentMonthPanel({ d, m }: { d: CompanyDetailResponse; m: CompanyModel }) {
  const c = d.company;
  const s = m.scored;
  const lim = (v: number | null) => (v === null ? '–' : fmtInt(v));
  const stats: { key: string; label: string; value: string; zero?: boolean }[] = [
    { key: 'jobs', label: '掲載 / 枠', value: `${fmtInt(c.m.jobs)} / ${lim(c.limits.job)}`, zero: c.m.jobs === 0 },
    { key: 'views', label: '閲覧', value: fmtInt(c.m.views), zero: c.m.views === 0 },
    { key: 'apps', label: '応募', value: fmtInt(c.m.apps), zero: c.m.apps === 0 },
    { key: 'sent', label: '送信 / 枠', value: `${fmtInt(c.m.sent)} / ${lim(c.limits.scout)}`, zero: c.m.sent === 0 },
    { key: 'intReply', label: '返信', value: fmtInt(c.m.intReply) },
    { key: 'inSel', label: '選考中', value: fmtInt(c.m.inSel) },
    { key: 'hires', label: '採用', value: fmtInt(c.m.hires) },
    { key: 'login', label: '最終ログイン', value: c.login.last ? fmtMd(c.login.last) : '記録なし' },
  ];
  return (
    <section className="card" aria-label="当月の実績">
      <div className="card-head">
        <h2>
          {fmtMonthJa(d.meta.month)} の実績 <Help text={`ボードの列と同じ値。返信はその月に「興味あり」返信があったスカウト数（送信月は問わない）。最終ログインは CT 画面（${d.meta.loginAvailableFrom} 以降のデータ）。ゲージ = 掲載中の求人数 ÷ 求人枠、当月送信 ÷ スカウト枠（${c.limits.period === 'contract' ? '契約期間の累計' : '月間枠'}）。縦の印は営業日ペースでの期待値、▼ は同業種の中央値`} />
        </h2>
        <span className="lead">
          営業日 {d.meta.bizDays.elapsed}/{d.meta.bizDays.total} 日経過（{fmtRate(d.meta.bizDays.rate)}）・データは {d.meta.dataDate} まで
        </span>
      </div>
      <div className="stat-grid">
        {stats.map((st) => (
          <div key={st.key} className={`stat${st.zero ? ' zero' : ''}`} data-stat={st.key}>
            <span className="t">{st.label}</span>
            <span className="v num">{st.value}</span>
          </div>
        ))}
      </div>
      <div className="grid-2" style={{ marginTop: 12 }}>
        <Bullet label="求人枠" value={c.m.jobs} limit={c.limits.job} expected={null} median={s.bench.job_utilization?.median ?? null} note={`新規掲載 ${fmtInt(c.m.newJobs)} 件`} />
        <Bullet label={c.limits.period === 'contract' ? 'スカウト枠（契約期間の累計）' : 'スカウト枠（当月）'} value={c.limits.period === 'contract' ? c.m.sentCtd : c.m.sent} limit={c.limits.scout} expected={s.pace.expected} median={s.bench.scout_utilization?.median ?? null} status={s.pace.status} note={`手動 ${fmtInt(c.m.sentManual)} / 自動 ${fmtInt(c.m.sentAuto)}`} />
      </div>
    </section>
  );
}
