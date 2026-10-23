import { DERIVED_DEFINITIONS, GROUP_LABEL, METRICS } from '../../../../shared/metrics/definitions';
import { TARGET_METRIC_LABEL } from '../../../../shared/schema/targets';

/** 指標レジストリ（src/shared/metrics/definitions.ts）から生成する定義一覧。docs/指標定義.md と同じ内容 */
export function DefinitionsList() {
  return (
    <>
      <section className="card" id="metrics">
        <div className="card-head">
          <h2>ボードの指標</h2>
          <span className="lead">{METRICS.length} 指標</span>
        </div>
        <div className="table-wrap">
          <table className="data compact" aria-label="指標の定義">
            <thead>
              <tr>
                <th>指標</th>
                <th>グループ</th>
                <th>式</th>
                <th>元の列</th>
                <th>業界比</th>
                <th>目標比</th>
              </tr>
            </thead>
            <tbody>
              {METRICS.map((m) => (
                <tr key={m.key} id={`metric-${m.key}`} className="def-row">
                  <td>
                    <b>{m.label}</b>
                  </td>
                  <td className="small">{GROUP_LABEL[m.group]}</td>
                  <td className="small">{m.formula}</td>
                  <td className="small">
                    <code>{m.source}</code>
                  </td>
                  <td className="small">{m.benchMetric ? '○' : '–'}</td>
                  <td className="small">{m.targetKey ? `○（${TARGET_METRIC_LABEL[m.targetKey]}）` : '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section className="card" id="derived">
        <div className="card-head">
          <h2>判定・派生の式</h2>
        </div>
        <dl className="defs">
          {DERIVED_DEFINITIONS.map((d) => (
            <div key={d.key} className="def-row" id={`derived-${d.key}`}>
              <dt>{d.label}</dt>
              <dd>{d.formula}</dd>
            </div>
          ))}
        </dl>
      </section>
    </>
  );
}
