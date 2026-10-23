import type { KpiTile } from '../../../../shared/metrics/board';
import { fmtInt, fmtRate } from '../../../lib/format';

/** ポートフォリオの KPI タイル（4 枚）。見出しと数字だけを出す（副説明・スパークラインは無し） */
export function KpiStrip({ tiles, onPick, active }: { tiles: KpiTile[]; onPick: (t: KpiTile) => void; active: string | null }) {
  return (
    <div className="kpi-strip" role="group" aria-label="全体の指標">
      {tiles.map((t) => (
        <button key={t.key} type="button" className="kpi" onClick={() => onPick(t)} aria-pressed={active === t.key} disabled={!t.filter} title={t.filter ? 'クリックで絞り込み' : undefined}>
          <span className="t">{t.label}</span>
          <span className={`v ${t.tone === 'bad' || t.tone === 'warn' ? t.tone : ''}`}>
            {t.unit === 'rate' ? fmtRate(t.value) : fmtInt(t.value)}
            {t.unit === 'count' ? <span className="u">社</span> : null}
            {t.rate !== undefined ? <span className="u">（{fmtRate(t.rate)}）</span> : null}
          </span>
        </button>
      ))}
    </div>
  );
}
