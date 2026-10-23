import { HEAT_LABEL_INDUSTRY, HEAT_LABEL_TARGET, HEAT_SCORES, heatToken } from '../../../../shared/metrics/heatmap';
import type { BenchMode } from '../../../../shared/metrics/score';
import type { BoardMeta } from '../../../../shared/schema/board';

export function BoardLegend({ mode, meta }: { mode: BenchMode; meta: BoardMeta }) {
  const labels = mode === 'industry' ? HEAT_LABEL_INDUSTRY : HEAT_LABEL_TARGET;
  return (
    <div className="board-foot">
      <div className="legend" aria-label="色の意味">
        {HEAT_SCORES.map((s) => (
          <span key={s}>
            <span className={`sw heat-${heatToken(s)}`} style={{ background: `var(--heat-${heatToken(s)})` }} />
            {labels[s]}
          </span>
        ))}
        <span>
          <span className="sw na" />
          データなし・基準なし
        </span>
      </div>
      <div>
        {mode === 'industry' ? `同業種・同種別の契約企業（${meta.benchMinN} 社以上）の中央値との比。足りなければ業種全体 → 種別全体 → 全体で代替` : '契約時の目標 × 営業日消化率 = 期待値。達成率 = 実績 ÷ 期待値'}
        {meta.isCurrentMonth ? `・営業日 ${meta.bizDays.elapsed}/${meta.bizDays.total} 日経過（データは ${meta.dataDate} まで）` : '・月の全営業日で比較'}
      </div>
    </div>
  );
}
