import { useState, type MouseEvent } from 'react';
import { useWidth } from './useWidth';
import { ChartTooltip, type TipState } from './ChartTooltip';
import { fmtMonthShort } from '../../../shared/calendar/periods';

export interface LineSeries {
  key: string;
  label: string;
  values: (number | null)[];
  /** CSS 変数（--cat-1 / --cat-2） */
  color: string;
}

const PAD = { l: 44, r: 64, t: 12, b: 22 };

/** 右軸の最大値 = 左軸の最大値 × 比率。比率は「右 ÷ 左」の最大率を 10% 以上のきりのよい値に切り上げる（応募の線が閲覧の線より上に出ない） */
const NICE_RATIOS = [0.1, 0.15, 0.2, 0.25, 0.3, 0.4, 0.5, 0.75, 1];
export function rightAxisRatio(left: (number | null)[], right: (number | null)[]): number {
  let maxRate = 0;
  left.forEach((l, i) => {
    const r = right[i];
    if (l !== null && r !== null && Number.isFinite(l) && Number.isFinite(r) && l > 0) maxRate = Math.max(maxRate, r / l);
  });
  const want = Math.max(0.1, maxRate);
  return NICE_RATIOS.find((x) => x >= want) ?? Math.ceil(want);
}

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  const m = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return m * p;
}

/**
 * 2 本の折れ線（月次）。凡例 + 最終点の直接ラベル + ホバーのツールチップ。
 * 既定は 1 軸。dualAxis = true のときだけ系列 0 を左軸、系列 1 を右軸にする（閲覧と応募のように桁が違う組み合わせ。ユーザー指示の例外。
 * 誤読を防ぐため目盛の数字を系列の色で塗り、凡例に左軸 / 右軸を書く）。
 * 右軸の最大値は左軸の最大値 × 比率（rightAxisRatio。既定 10%、「右 ÷ 左」の最大率がそれを超えたら 15% → 20% → … に連動）に固定し、
 * 右軸の線（応募・返信）が左軸の線（閲覧・送信）より常に下に描かれるようにする（2026-11-02）
 */
export function DualLineChart({ months, series, format, ariaLabel, partialLast = false, height = 200, dualAxis = false }: { months: string[]; series: LineSeries[]; format: (v: number) => string; ariaLabel: string; partialLast?: boolean; height?: number; dualAxis?: boolean }) {
  const [ref, w] = useWidth<HTMLDivElement>(480);
  const [tip, setTip] = useState<TipState | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const n = months.length;
  const finite = (vals: (number | null)[]) => vals.filter((v): v is number => v !== null && Number.isFinite(v));
  const maxAll = niceMax(Math.max(0, ...finite(series.flatMap((s) => s.values))));
  const leftMax = niceMax(Math.max(0, ...finite(series[0]?.values ?? [])));
  const ratio = dualAxis ? rightAxisRatio(series[0]?.values ?? [], series[1]?.values ?? []) : 1;
  /** 系列ごとの軸の最大値（1 軸なら共通、2 軸なら系列 0 = 左、系列 1 以降 = 右 = 左 × 比率） */
  const axisMax = (si: number) => (dualAxis ? (si === 0 ? leftMax : leftMax * ratio) : maxAll);
  const iw = Math.max(40, w - PAD.l - PAD.r);
  const ih = height - PAD.t - PAD.b;
  const sx = (i: number) => PAD.l + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw);
  const syOf = (si: number) => (v: number) => PAD.t + (1 - v / axisMax(si)) * ih;
  const path = (vals: (number | null)[], sy: (v: number) => number) => {
    let d = '';
    let started = false;
    vals.forEach((v, i) => {
      if (v === null) {
        started = false;
        return;
      }
      d += `${started ? 'L' : 'M'}${sx(i).toFixed(1)},${sy(v).toFixed(1)} `;
      started = true;
    });
    return d.trim();
  };
  const fracs = [0, 0.25, 0.5, 0.75, 1];
  const ticksLeft = fracs.map((f) => f * axisMax(0));
  const ticksRight = dualAxis ? fracs.map((f) => f * axisMax(1)) : [];
  const step = n > 8 ? Math.ceil(n / 7) : 1;
  const onMove = (e: MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const i = Math.max(0, Math.min(n - 1, Math.round(((x - PAD.l) / iw) * (n - 1))));
    setHover(i);
    setTip({
      x: sx(i),
      y: PAD.t,
      content: (
        <div>
          <b>{fmtMonthShort(months[i])}{partialLast && i === n - 1 ? '（途中）' : ''}</b>
          {series.map((s) => (
            <div key={s.key}>
              <span className="dot" style={{ background: `var(${s.color})` }} /> {s.label}: <span className="num">{s.values[i] === null ? '–' : format(s.values[i] as number)}</span>
            </div>
          ))}
        </div>
      ),
    });
  };
  const onLeave = () => {
    setHover(null);
    setTip(null);
  };
  if (!n) return <div className="empty">データがありません</div>;
  return (
    <div className="chart dual" ref={ref} style={{ position: 'relative' }} data-right-ratio={dualAxis ? ratio : undefined}>
      <div className="legend" aria-hidden="true">
        {series.map((s, si) => (
          <span key={s.key}>
            <span className="sw" style={{ background: `var(${s.color})` }} /> {s.label}
            {dualAxis ? <span className="muted">（{si === 0 ? '左軸' : `右軸。最大値は左軸の ${Math.round(ratio * 100)}%`}）</span> : null}
          </span>
        ))}
      </div>
      <svg width={w} height={height} role="img" aria-label={ariaLabel} onMouseMove={onMove} onMouseLeave={onLeave}>
        {ticksLeft.map((t, ti) => (
          <g key={`l${ti}`}>
            <line x1={PAD.l} x2={PAD.l + iw} y1={syOf(0)(t)} y2={syOf(0)(t)} stroke="var(--grid)" strokeWidth="1" />
            <text x={PAD.l - 6} y={syOf(0)(t) + 4} textAnchor="end" className="tick left" fill={dualAxis ? `var(${series[0]?.color})` : undefined}>
              {format(t)}
            </text>
          </g>
        ))}
        {ticksRight.map((t, ti) => (
          <text key={`r${ti}`} x={PAD.l + iw + 6} y={syOf(1)(t) + 4} textAnchor="start" className="tick right" fill={`var(${series[1]?.color})`}>
            {format(t)}
          </text>
        ))}
        {months.map((m, i) =>
          i % step === 0 || i === n - 1 ? (
            <text key={m} x={sx(i)} y={height - 6} textAnchor="middle" className="tick">
              {fmtMonthShort(m)}
            </text>
          ) : null,
        )}
        {hover !== null ? <line x1={sx(hover)} x2={sx(hover)} y1={PAD.t} y2={PAD.t + ih} stroke="var(--rule-strong)" strokeWidth="1" /> : null}
        {series.map((s, si) => {
          const sy = syOf(si);
          const lastIdx = s.values.length - 1 - [...s.values].reverse().findIndex((v) => v !== null);
          const last = s.values[lastIdx];
          return (
            <g key={s.key} data-series={s.key}>
              <path d={path(s.values, sy)} fill="none" stroke={`var(${s.color})`} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
              {hover !== null && s.values[hover] !== null ? <circle cx={sx(hover)} cy={sy(s.values[hover] as number)} r="4" fill={`var(${s.color})`} stroke="var(--surface)" strokeWidth="2" /> : null}
              {last !== null && last !== undefined ? (
                <>
                  <circle cx={sx(lastIdx)} cy={sy(last)} r="3" fill={`var(${s.color})`} stroke="var(--surface)" strokeWidth="1.5" />
                  <text x={dualAxis ? sx(lastIdx) - 6 : sx(lastIdx) + 6} y={sy(last) - (dualAxis ? 6 : -4)} textAnchor={dualAxis ? 'end' : 'start'} className="value" fill={`var(${s.color})`} fontSize="11" fontWeight="600">
                    {format(last)}
                  </text>
                </>
              ) : null}
            </g>
          );
        })}
      </svg>
      <ChartTooltip tip={tip} width={w} />
    </div>
  );
}
