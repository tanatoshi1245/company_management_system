import { useWidth } from './useWidth';
import { fmtInt } from '../../lib/format';

/** 月内の累積（当月 = 紺、前月 = 灰、期待の直線 = 破線）。x = 日 */
export function CumulativeChart({ current, previous, limit, daysInMonth, label }: { current: { day: number; v: number }[]; previous: { day: number; v: number }[]; limit: number | null; daysInMonth: number; label: string }) {
  const [ref, w] = useWidth<HTMLDivElement>(320);
  const h = 110;
  const pad = { l: 34, r: 10, t: 10, b: 18 };
  const max = Math.max(1, limit ?? 0, ...current.map((p) => p.v), ...previous.map((p) => p.v));
  const xs = (d: number) => pad.l + ((d - 1) / Math.max(1, daysInMonth - 1)) * (w - pad.l - pad.r);
  const ys = (v: number) => pad.t + (1 - v / max) * (h - pad.t - pad.b);
  const path = (pts: { day: number; v: number }[]) => pts.map((p, i) => `${i ? 'L' : 'M'}${xs(p.day).toFixed(1)},${ys(p.v).toFixed(1)}`).join(' ');
  const last = current[current.length - 1];
  return (
    <div className="chart" ref={ref}>
      <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`${label} の月内累積。当月 ${last ? fmtInt(last.v) : 0}`}>
        <g className="grid">
          {[0.5, 1].map((f) => (
            <line key={f} x1={pad.l} y1={ys(max * f)} x2={w - pad.r} y2={ys(max * f)} />
          ))}
        </g>
        <line x1={pad.l} y1={ys(0)} x2={w - pad.r} y2={ys(0)} stroke="var(--axis)" />
        {limit ? <line x1={xs(1)} y1={ys(0)} x2={xs(daysInMonth)} y2={ys(limit)} stroke="var(--target-line)" strokeWidth="1" strokeDasharray="3 3" /> : null}
        {previous.length ? <path d={path(previous)} fill="none" stroke="var(--de-emphasis)" strokeWidth="2" /> : null}
        {current.length ? <path d={path(current)} fill="none" stroke="var(--seq-4)" strokeWidth="2" /> : null}
        {last ? <circle cx={xs(last.day)} cy={ys(last.v)} r="3" fill="var(--seq-5)" stroke="var(--surface)" /> : null}
        <text x={pad.l - 4} y={ys(max) + 4} className="tick" textAnchor="end">
          {fmtInt(max)}
        </text>
        <text x={pad.l - 4} y={ys(0) + 4} className="tick" textAnchor="end">
          0
        </text>
        <text x={xs(1)} y={h - 4} className="tick">
          1日
        </text>
        <text x={xs(daysInMonth)} y={h - 4} className="tick" textAnchor="end">
          {daysInMonth}日
        </text>
      </svg>
      <div className="chart-legend">
        <span>
          <span className="sw" style={{ background: 'var(--seq-4)' }} />
          当月
        </span>
        <span>
          <span className="sw" style={{ background: 'var(--de-emphasis)' }} />
          前月
        </span>
        {limit ? <span>- - 枠を使い切るペース</span> : null}
      </div>
    </div>
  );
}
