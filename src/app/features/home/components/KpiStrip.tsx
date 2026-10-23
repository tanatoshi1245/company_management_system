import type { KpiTile } from '../../../../shared/metrics/board';
import { Sparkline } from '../../../components/charts/Sparkline';
import { fmtInt, fmtRate } from '../../../lib/format';

/** ポートフォリオの KPI タイル（5 枚）。クリックで該当の絞り込みを適用 */
export function KpiStrip({ tiles, onPick, active }: { tiles: KpiTile[]; onPick: (t: KpiTile) => void; active: string | null }) {
  return (
    <div className="kpi-strip" role="group" aria-label="全体の指標">
      {tiles.map((t) => (
        <button key={t.key} type="button" className="kpi" onClick={() => onPick(t)} aria-pressed={active === t.key} disabled={!t.filter} title={t.filter ? 'クリックで絞り込み' : undefined}>
          <span className="t">{t.label}</span>
          <span className={`v ${t.tone === 'bad' || t.tone === 'warn' ? t.tone : ''}`}>
            {t.unit === 'rate' ? fmtRate(t.value) : fmtInt(t.value)}
            {t.unit === 'count' ? <span className="u">社</span> : null}
          </span>
          <span className="n">
            <span>{t.sub}</span>
            {t.spark.length > 2 ? <Sparkline values={t.spark} width={72} height={18} ariaLabel={`${t.label} の 14 か月の推移`} /> : null}
          </span>
        </button>
      ))}
    </div>
  );
}
