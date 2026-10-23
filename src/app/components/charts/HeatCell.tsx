import type { ReactNode } from 'react';
import { heatToken, type HeatScore } from '../../../shared/metrics/heatmap';

/**
 * ヒートマップのセル。5 段階（--heat-n2 … --heat-p2）、データなしは斜線。数値は右寄せの等幅数字、副情報は小さく。
 * 色だけに頼らず title（ツールチップ）と data-score を持つ
 */
export function HeatCell({ score, value, secondary, title, polarity, mark }: { score: HeatScore | null; value: string; secondary?: ReactNode; title: string; polarity?: 'higher' | 'lower'; mark?: ReactNode }) {
  const tok = heatToken(score);
  return (
    <td className={`heat heat-${tok}`} data-score={score ?? ''} title={title} data-polarity={polarity ?? 'higher'}>
      <div className="heat-in">
        <span className="heat-v num">{value}</span>
        {secondary !== undefined && secondary !== null ? <span className="heat-s">{secondary}</span> : null}
        {mark ? <span className="heat-m">{mark}</span> : null}
      </div>
    </td>
  );
}
