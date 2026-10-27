import { useState } from 'react';
import { PIE_COLORS, PIE_OTHER_COLOR } from '../../../shared/labels';
import { fmtInt, fmtRate } from '../../lib/format';

export interface PieSlice {
  label: string;
  value: number;
}

/** 上位 maxSlices − 1 件 + 「その他」にまとめる（(未入力) は常に末尾でグレー） */
export interface PieSliceOut {
  label: string;
  value: number;
  color: string;
  share: number;
}

export function pieSlices(rows: PieSlice[], maxSlices = 8): PieSliceOut[] {
  const total = rows.reduce((a, r) => a + r.value, 0);
  if (total <= 0) return [];
  const blank = rows.filter((r) => r.label === '(未入力)');
  const main = rows.filter((r) => r.label !== '(未入力)' && r.value > 0);
  const limit = maxSlices - 1;
  const head = main.slice(0, limit);
  const rest = main.slice(limit);
  const out: PieSliceOut[] = head.map((r, i) => ({ label: r.label, value: r.value, color: PIE_COLORS[i % PIE_COLORS.length] as string, share: r.value / total }));
  const restSum = rest.reduce((a, r) => a + r.value, 0);
  if (restSum > 0) out.push({ label: `その他（${rest.length} 件）`, value: restSum, color: PIE_OTHER_COLOR, share: restSum / total });
  const blankSum = blank.reduce((a, r) => a + r.value, 0);
  if (blankSum > 0) out.push({ label: '(未入力)', value: blankSum, color: '#DEDAD3', share: blankSum / total });
  return out;
}

function arc(cx: number, cy: number, r: number, r0: number, a0: number, a1: number): string {
  const p = (rr: number, a: number) => [cx + rr * Math.cos(a), cy + rr * Math.sin(a)];
  const [x0, y0] = p(r, a0);
  const [x1, y1] = p(r, a1);
  const [x2, y2] = p(r0, a1);
  const [x3, y3] = p(r0, a0);
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M${x0.toFixed(2)},${y0.toFixed(2)} A${r},${r} 0 ${large} 1 ${x1.toFixed(2)},${y1.toFixed(2)} L${x2.toFixed(2)},${y2.toFixed(2)} A${r0},${r0} 0 ${large} 0 ${x3.toFixed(2)},${y3.toFixed(2)} Z`;
}

/**
 * 同一サイズのドーナツ（構成比）。スライスは 2px の隙間、8% 以上のスライスに % を直接ラベル、右に凡例（件数と構成比）。
 * 色は識別用（PIE_COLORS、検証済み）。単位（unit）は「件」「人」
 */
export function PieChart({ rows, size = 200, unit = '件', ariaLabel, total }: { rows: PieSlice[]; size?: number; unit?: string; ariaLabel: string; total?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const slices = pieSlices(rows);
  const sum = slices.reduce((a, s) => a + s.value, 0);
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 4;
  const r0 = r * 0.58;
  let a = -Math.PI / 2;
  const gap = 0.012;
  const shown = total ?? sum;
  if (!slices.length) return <div className="empty">データがありません</div>;
  return (
    <div className="pie" role="group" aria-label={ariaLabel}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${ariaLabel}（合計 ${fmtInt(shown)} ${unit}）`}>
        {slices.map((s, i) => {
          const span = (s.value / sum) * Math.PI * 2;
          const a0 = a + (span > gap * 2 ? gap : 0);
          const a1 = a + span - (span > gap * 2 ? gap : 0);
          const mid = a + span / 2;
          a += span;
          const lr = (r + r0) / 2;
          return (
            <g key={s.label} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} opacity={hover === null || hover === i ? 1 : 0.45}>
              <path d={arc(cx, cy, r, r0, a0, Math.max(a0, a1))} fill={s.color} stroke="var(--surface)" strokeWidth="1">
                <title>{`${s.label}: ${fmtInt(s.value)} ${unit}（${fmtRate(s.share, 1)}）`}</title>
              </path>
              {s.share >= 0.08 ? (
                <text x={cx + lr * Math.cos(mid)} y={cy + lr * Math.sin(mid) + 4} textAnchor="middle" fontSize="11" fontWeight="700" fill="#fff" className="pie-label">
                  {fmtRate(s.share)}
                </text>
              ) : null}
            </g>
          );
        })}
        <text x={cx} y={cy - 2} textAnchor="middle" fontSize="16" fontWeight="600" fill="var(--heading)" className="num">
          {fmtInt(shown)}
        </text>
        <text x={cx} y={cy + 14} textAnchor="middle" fontSize="11" fill="var(--muted)">
          {unit}
        </text>
      </svg>
      <ul className="pie-legend">
        {slices.map((s, i) => (
          <li key={s.label} className={hover === i ? 'on' : ''} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <span className="sw" style={{ background: s.color }} />
            <span className="lbl" title={s.label}>
              {s.label}
            </span>
            <span className="num val">{fmtInt(s.value)}</span>
            <span className="num pct">{fmtRate(s.share, 1)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
