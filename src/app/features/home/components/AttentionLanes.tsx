import type { Lanes } from '../../../../shared/metrics/board';
import type { ScoredCompany } from '../../../../shared/metrics/score';
import { Link } from '../../../router';
import { fmtInt } from '../../../lib/format';

function Card({ s, why, month }: { s: ScoredCompany; why: string; month: string }) {
  const h = s.health.industry.level;
  return (
    <Link to={`/companies/${s.c.id}?month=${month}`} className="lane-card">
      <span className={`dot ${h === 'alert' ? 'bad' : h === 'watch' ? 'warn' : h === 'good' ? 'good' : 'neutral'}`} aria-hidden="true" />
      <span className="nm">{s.c.name}</span>
      <span className="why">{why}</span>
    </Link>
  );
}

/** 注目レーン: ペース遅れ / ログインなし / 契約終了間近（各 6 社まで） */
export function AttentionLanes({ lanes, totals, month, onMore }: { lanes: Lanes; totals: { behind: number; noLogin: number; ending: number }; month: string; onMore: (lane: keyof Lanes) => void }) {
  const Lane = ({ k, title, total, items, why }: { k: keyof Lanes; title: string; total: number; items: ScoredCompany[]; why: (s: ScoredCompany) => string }) => (
    <section className="lane" aria-label={title}>
      <div className="lane-head">
        <h3>
          {title} <span className="cnt">{fmtInt(total)}</span>
        </h3>
        {total > items.length ? (
          <a
            href="#board"
            onClick={(e) => {
              e.preventDefault();
              onMore(k);
            }}
          >
            すべて表示 →
          </a>
        ) : null}
      </div>
      <div className="lane-cards">
        {items.length ? items.map((s) => <Card key={s.c.id} s={s} why={why(s)} month={month} />) : <div className="lane-empty">該当なし</div>}
      </div>
    </section>
  );
  return (
    <div className="lanes">
      <Lane k="behind" title="スカウトのペース遅れ" total={totals.behind} items={lanes.behind} why={(s) => `${fmtInt(s.c.m.sent)}/${s.c.limits.scout ?? '–'}・期待 ${s.pace.expected === null ? '–' : fmtInt(s.pace.expected)}`} />
      <Lane k="noLogin" title="ログインなし（14 日以上）" total={totals.noLogin} items={lanes.noLogin} why={(s) => (s.c.login.daysSince === null ? '記録なし' : `${s.c.login.daysSince} 日前`)} />
      <Lane k="ending" title="契約終了まで 60 日以内" total={totals.ending} items={lanes.ending} why={(s) => `残 ${s.c.contract.daysToEnd} 日`} />
    </div>
  );
}
