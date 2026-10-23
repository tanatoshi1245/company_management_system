import type { KpiTile } from '../../../../shared/metrics/board';
import { CONTRACT_KIND_LABEL } from '../../../../shared/labels';
import { fmtInt, fmtRate } from '../../../lib/format';

/** ポートフォリオの KPI タイル（4 枚）。見出しと数字、その下に契約体系（左 = 広告掲載 / 右 = 成功報酬）の内訳 */
export function KpiStrip({ tiles, onPick, active }: { tiles: KpiTile[]; onPick: (t: KpiTile) => void; active: string | null }) {
  const fmt = (t: KpiTile, v: number | null) => (v === null ? '–' : t.unit === 'rate' ? fmtRate(v) : `${fmtInt(v)} 社`);
  return (
    <div className="kpi-strip" role="group" aria-label="全体の指標">
      {tiles.map((t) => (
        <button key={t.key} type="button" className="kpi" onClick={() => onPick(t)} aria-pressed={active === t.key} disabled={!t.filter} title={t.split.unknown > 0 ? `契約体系が不明の ${fmtInt(t.split.unknown)} 社は内訳に含めない（合計には含む）` : undefined}>
          <span className="t">{t.label}</span>
          <span className={`v ${t.tone === 'bad' || t.tone === 'warn' ? t.tone : ''}`}>
            {t.unit === 'rate' ? fmtRate(t.value) : fmtInt(t.value)}
            {t.unit === 'count' ? <span className="u">社</span> : null}
            {t.rate !== undefined ? <span className="u">（{fmtRate(t.rate)}）</span> : null}
          </span>
          <span className="split" aria-label="契約体系の内訳">
            <span className="cell ad">
              <span className="k">{CONTRACT_KIND_LABEL.ad}</span>
              <span className="v2 num">{fmt(t, t.split.ad)}</span>
            </span>
            <span className="cell success">
              <span className="k">{CONTRACT_KIND_LABEL.success}</span>
              <span className="v2 num">{fmt(t, t.split.success)}</span>
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}
