import { targetProgress } from '../../../../shared/metrics/pace';
import { heatToken, scoreRatio } from '../../../../shared/metrics/heatmap';
import { fmtInt, fmtRate } from '../../../lib/format';

/** 目標に対する達成率の棒。期待値（目標 × 営業日消化率）の位置に印 */
export function TargetProgressBar({ actual, target, rate, label }: { actual: number; target: number | null | undefined; rate: number; label: string }) {
  if (target === null || target === undefined) return <span className="muted small">目標なし</span>;
  const { expected, progress } = targetProgress(actual, target, rate);
  const score = scoreRatio(progress);
  const pct = progress === null ? 0 : Math.min(1.5, progress);
  return (
    <span className="tpb" title={`${label}: 実績 ${fmtInt(actual)} / 目標 ${fmtInt(target)}（期待 ${fmtInt(expected)}）達成率 ${fmtRate(progress)}`}>
      <span className="progress">
        <span className={`fill heat-${heatToken(score)}`} style={{ width: `${(pct / 1.5) * 100}%` }} />
        <span className="mark" style={{ left: `${(1 / 1.5) * 100}%` }} />
      </span>
      <span className="num small">
        {fmtInt(actual)}
        <span className="muted"> / {fmtInt(target)}</span> <b>{fmtRate(progress)}</b>
      </span>
    </span>
  );
}
