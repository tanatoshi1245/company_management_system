import { useWidth } from './useWidth';
import { fmtMonthShort } from '../../../shared/calendar/periods';

export interface Panel {
  key: string;
  label: string;
  values: (number | null)[];
  /** 破線で描く目標 */
  target?: (number | null)[];
  /** 業界 p25〜p75 の帯 */
  band?: ({ lo: number; hi: number } | null)[];
  format: (v: number) => string;
  /** 当月（最後の点）は途中経過。薄く描く */
  partialLast?: boolean;
}

const PAD = { l: 8, r: 36, t: 14, b: 18 };

function Line({ months, p, w, h }: { months: string[]; p: Panel; w: number; h: number }) {
  const n = months.length;
  const xs = (i: number) => PAD.l + (i / Math.max(1, n - 1)) * (w - PAD.l - PAD.r);
  const all = [...p.values, ...(p.target ?? []), ...(p.band ?? []).flatMap((b) => (b ? [b.lo, b.hi] : []))].filter((v): v is number => v !== null && Number.isFinite(v));
  const max = Math.max(1, ...all);
  const ys = (v: number) => PAD.t + (1 - v / max) * (h - PAD.t - PAD.b);
  const path = (vals: (number | null)[]) => {
    let d = '';
    let on = false;
    vals.forEach((v, i) => {
      if (v === null) {
        on = false;
        return;
      }
      d += `${on ? 'L' : 'M'}${xs(i).toFixed(1)},${ys(v).toFixed(1)} `;
      on = true;
    });
    return d.trim();
  };
  const lastIdx = p.values.length - 1;
  const last = p.values[lastIdx];
  const bandPath = (() => {
    if (!p.band) return '';
    const pts = p.band.map((b, i) => (b ? [xs(i), ys(b.hi), ys(b.lo)] : null));
    const up = pts.filter((x): x is number[] => x !== null).map((x) => `${x[0].toFixed(1)},${x[1].toFixed(1)}`);
    const down = pts.filter((x): x is number[] => x !== null).map((x) => `${x[0].toFixed(1)},${x[2].toFixed(1)}`).reverse();
    return up.length ? `M${up.join(' L')} L${down.join(' L')} Z` : '';
  })();
  return (
    <svg width="100%" height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={`${p.label} の 14 か月の推移。直近 ${last === null ? '–' : p.format(last)}`}>
      <line x1={PAD.l} y1={ys(0)} x2={w - PAD.r} y2={ys(0)} stroke="var(--axis)" strokeWidth="1" />
      {bandPath ? <path d={bandPath} fill="var(--band)" stroke="none" /> : null}
      {p.target ? <path d={path(p.target)} fill="none" stroke="var(--target-line)" strokeWidth="1" strokeDasharray="3 3" /> : null}
      <path d={path(p.values.slice(0, p.partialLast ? -1 : undefined))} fill="none" stroke="var(--seq-4)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
      {p.partialLast && lastIdx > 0 && last !== null && p.values[lastIdx - 1] !== null ? <path d={path([...Array(lastIdx - 1).fill(null), p.values[lastIdx - 1], last])} fill="none" stroke="var(--seq-2)" strokeWidth="2" strokeDasharray="2 3" /> : null}
      {last !== null ? (
        <g>
          <circle cx={xs(lastIdx)} cy={ys(last)} r="3" fill="var(--seq-5)" stroke="var(--surface)" strokeWidth="1" />
          <text x={xs(lastIdx) + 6} y={ys(last) + 4} className="value">
            {p.format(last)}
          </text>
        </g>
      ) : null}
      {months.map((m, i) => (i === 0 || i === n - 1 || m.endsWith('-01') ? (
        <text key={m} x={xs(i)} y={h - 4} className="tick" textAnchor={i === n - 1 ? 'end' : i === 0 ? 'start' : 'middle'}>
          {fmtMonthShort(m)}
        </text>
      ) : null))}
      {p.values.map((v, i) => (
        <rect key={i} className="hit" x={xs(i) - (w - PAD.l - PAD.r) / n / 2} y="0" width={(w - PAD.l - PAD.r) / n} height={h}>
          <title>{`${months[i]}: ${v === null ? '–' : p.format(v)}${p.target?.[i] !== null && p.target?.[i] !== undefined ? `（目標 ${p.format(p.target[i]!)}）` : ''}${p.band?.[i] ? `（業界 p25〜p75 ${p.format(p.band[i]!.lo)}〜${p.format(p.band[i]!.hi)}）` : ''}`}</title>
        </rect>
      ))}
    </svg>
  );
}

/** 同じ x（14 か月）で並べた小さな折れ線。1 色、最終点だけラベル。目標は破線、業界の帯は薄い塗り */
export function SmallMultiples({ months, panels, cols = 4 }: { months: string[]; panels: Panel[]; cols?: number }) {
  const [ref, width] = useWidth<HTMLDivElement>(900);
  const gap = 12;
  const w = Math.max(160, Math.floor((width - gap * (cols - 1)) / cols));
  const h = 96;
  return (
    <div className="multiples" ref={ref} style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
      {panels.map((p) => (
        <div className="panel chart" key={p.key}>
          <div className="panel-label">{p.label}</div>
          <Line months={months} p={p} w={w} h={h} />
        </div>
      ))}
    </div>
  );
}
