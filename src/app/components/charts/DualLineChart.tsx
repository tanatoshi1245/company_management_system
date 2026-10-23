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

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  const m = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return m * p;
}

/** 同じ軸に 2 本の折れ線（月次）。凡例 + 最終点の直接ラベル + ホバーのツールチップ。1 軸のみ（2 軸にしない） */
export function DualLineChart({ months, series, format, ariaLabel, partialLast = false, height = 200 }: { months: string[]; series: LineSeries[]; format: (v: number) => string; ariaLabel: string; partialLast?: boolean; height?: number }) {
  const [ref, w] = useWidth<HTMLDivElement>(480);
  const [tip, setTip] = useState<TipState | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const n = months.length;
  const all = series.flatMap((s) => s.values).filter((v): v is number => v !== null && Number.isFinite(v));
  const max = niceMax(Math.max(0, ...all));
  const iw = Math.max(40, w - PAD.l - PAD.r);
  const ih = height - PAD.t - PAD.b;
  const sx = (i: number) => PAD.l + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw);
  const sy = (v: number) => PAD.t + (1 - v / max) * ih;
  const path = (vals: (number | null)[]) => {
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
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max);
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
    <div className="chart dual" ref={ref} style={{ position: 'relative' }}>
      <div className="legend" aria-hidden="true">
        {series.map((s) => (
          <span key={s.key}>
            <span className="sw" style={{ background: `var(${s.color})` }} /> {s.label}
          </span>
        ))}
      </div>
      <svg width={w} height={height} role="img" aria-label={ariaLabel} onMouseMove={onMove} onMouseLeave={onLeave}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.l} x2={PAD.l + iw} y1={sy(t)} y2={sy(t)} stroke="var(--grid)" strokeWidth="1" />
            <text x={PAD.l - 6} y={sy(t) + 4} textAnchor="end" className="tick">
              {format(t)}
            </text>
          </g>
        ))}
        {months.map((m, i) =>
          i % step === 0 || i === n - 1 ? (
            <text key={m} x={sx(i)} y={height - 6} textAnchor="middle" className="tick">
              {fmtMonthShort(m)}
            </text>
          ) : null,
        )}
        {hover !== null ? <line x1={sx(hover)} x2={sx(hover)} y1={PAD.t} y2={PAD.t + ih} stroke="var(--rule-strong)" strokeWidth="1" /> : null}
        {series.map((s) => {
          const lastIdx = s.values.length - 1 - [...s.values].reverse().findIndex((v) => v !== null);
          const last = s.values[lastIdx];
          return (
            <g key={s.key} data-series={s.key}>
              <path d={path(s.values)} fill="none" stroke={`var(${s.color})`} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
              {hover !== null && s.values[hover] !== null ? <circle cx={sx(hover)} cy={sy(s.values[hover] as number)} r="4" fill={`var(${s.color})`} stroke="var(--surface)" strokeWidth="2" /> : null}
              {last !== null && last !== undefined ? (
                <>
                  <circle cx={sx(lastIdx)} cy={sy(last)} r="3" fill={`var(${s.color})`} stroke="var(--surface)" strokeWidth="1.5" />
                  <text x={sx(lastIdx) + 6} y={sy(last) + 4} className="value" fill={`var(${s.color})`} fontSize="11" fontWeight="600">
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
