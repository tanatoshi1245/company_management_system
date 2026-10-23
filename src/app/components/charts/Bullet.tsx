import { useWidth } from './useWidth';
import { fmtInt, fmtRate } from '../../lib/format';
import type { PaceStatus } from '../../../shared/metrics/pace';
import { PACE_LABEL } from '../../../shared/metrics/pace';

/**
 * 枠に対する消化のゲージ。塗り = 実績、縦の印 = 期待値（営業日ペース）、三角 = 業界中央値。
 * 枠が無いときは実績だけを棒で出す
 */
export function Bullet({ label, value, limit, expected, median, status, note }: { label: string; value: number; limit: number | null; expected: number | null; median: number | null; status?: PaceStatus; note?: string }) {
  const [ref, w] = useWidth<HTMLDivElement>(320);
  const h = 44;
  const max = Math.max(limit ?? 0, value, expected ?? 0, 1);
  const x = (v: number) => Math.max(0, Math.min(w, (v / max) * w));
  const util = limit ? value / limit : null;
  const tone = status === 'behind' ? 'bad' : status === 'watch' ? 'warn' : status === 'on' || status === 'ahead' ? 'good' : 'neutral';
  return (
    <div className="bullet" ref={ref}>
      <div className="bullet-head">
        <span className="bullet-label">{label}</span>
        <span className="bullet-val num">
          {fmtInt(value)}
          <span className="muted"> / {limit === null ? '枠なし' : fmtInt(limit)}</span>
          {util !== null ? <span className={`badge ${tone}`}>{fmtRate(util)}</span> : null}
        </span>
      </div>
      <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`${label}: ${fmtInt(value)}${limit ? ` / ${fmtInt(limit)}` : ''}${expected !== null ? `、期待 ${fmtInt(expected)}` : ''}`}>
        <rect x="0" y="12" width={w} height="14" fill="var(--surface-sunken)" />
        {limit ? <rect x="0" y="12" width={x(limit)} height="14" fill="var(--accent-soft)" /> : null}
        <rect x="0" y="12" width={x(value)} height="14" fill="var(--seq-4)" />
        {expected !== null ? (
          <g>
            <line x1={x(expected)} y1="6" x2={x(expected)} y2="32" stroke="var(--ink)" strokeWidth="2" />
            <text x={Math.min(w - 40, x(expected) + 4)} y="42" className="tick">
              期待 {fmtInt(expected)}
            </text>
          </g>
        ) : null}
        {median !== null && limit ? (
          <g>
            <polygon points={`${x(median * limit) - 4},2 ${x(median * limit) + 4},2 ${x(median * limit)},9`} fill="var(--dj-gold-deep)" />
            <title>業界中央値 {fmtRate(median)}</title>
          </g>
        ) : null}
      </svg>
      <div className="bullet-foot">
        {status ? <span className={`dot ${tone === 'neutral' ? 'neutral' : tone}`} /> : null}
        {status ? <span>ペース: {PACE_LABEL[status]}</span> : null}
        {median !== null ? <span className="muted">業界中央値 {fmtRate(median)}（▼）</span> : null}
        {note ? <span className="muted">{note}</span> : null}
      </div>
    </div>
  );
}
