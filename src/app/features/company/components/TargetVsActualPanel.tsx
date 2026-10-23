import type { CompanyModel } from '../companyModel';
import type { CompanyDetailResponse } from '../../../../shared/schema/company';
import { METRIC_BY_KEY, HEAT_COLUMNS_TARGET } from '../../../../shared/metrics/definitions';
import { TARGET_METRIC_LABEL } from '../../../../shared/schema/targets';
import { heatToken } from '../../../../shared/metrics/heatmap';
import { Link } from '../../../router';
import { Help } from '../../../components/ui/Help';
import { fmtInt, fmtRate } from '../../../lib/format';

export function TargetVsActualPanel({ d, m }: { d: CompanyDetailResponse; m: CompanyModel }) {
  const s = m.scored;
  return (
    <section className="card" id="targets">
      <div className="card-head">
        <h2>
          契約時の目標との比較 <Help text="期待値 = 月の目標 × 営業日消化率。達成率 = 実績 ÷ 期待値。色はヒートマップと同じ 5 段階" />
        </h2>
        <Link to={`/targets/${d.company.id}?from=${d.meta.month}`} className="btn sm">
          目標を編集
        </Link>
      </div>
      {!s.hasTargets ? (
        <div className="empty">
          <b>この月の目標は未登録です</b>
          契約時に合意したスカウト送信数・応募数などを登録すると、ボードの「目標比」とここで進捗が見えます
        </div>
      ) : (
        <div className="table-wrap">
          <table className="data compact" aria-label="目標と実績">
            <thead>
              <tr>
                <th>指標</th>
                <th className="num">目標</th>
                <th className="num">期待（今日時点）</th>
                <th className="num">実績</th>
                <th className="num">達成率</th>
                <th>進捗</th>
              </tr>
            </thead>
            <tbody>
              {HEAT_COLUMNS_TARGET.map((k) => {
                const def = METRIC_BY_KEY[k];
                const t = s.target[k];
                if (!t || !def.targetKey) return null;
                const pct = t.progress === null ? 0 : Math.min(1.5, t.progress);
                return (
                  <tr key={k}>
                    <td>{TARGET_METRIC_LABEL[def.targetKey]}</td>
                    <td className="num">{t.target === null ? '–' : fmtInt(t.target)}</td>
                    <td className="num">{t.expected === null ? '–' : fmtInt(t.expected)}</td>
                    <td className="num">{fmtInt(t.actual)}</td>
                    <td className="num">{fmtRate(t.progress)}</td>
                    <td>
                      <span className="progress" title={`達成率 ${fmtRate(t.progress)}`}>
                        <span className={`fill heat-${heatToken(t.score)}`} style={{ width: `${(pct / 1.5) * 100}%` }} />
                        <span className="mark" style={{ left: `${(1 / 1.5) * 100}%` }} />
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {d.settings?.updatedBy ? <p className="small muted">最終更新 {d.settings.updatedAt} {d.settings.updatedBy}</p> : null}
        </div>
      )}
    </section>
  );
}
