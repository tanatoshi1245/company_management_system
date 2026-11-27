import { useLayoutEffect, useRef, useState } from 'react';
import type { ReportSlide } from '../../../../../shared/ai/report';

/**
 * スライド用のチャート（インライン SVG。ライブラリなし）。画面用の components/charts とは別（1920×1080 のスライドの中で、
 * 文字の大きさと配色を slide_creator のスライドにそろえるため）。規約は components/charts/README.md「スライド用のチャート」。
 *   - 1 軸だけ。系列の色は決まった順（増やさない。系列は 3 本まで）
 *   - 2 本以上は凡例 + 最後の点の値。色だけに頼らないよう、点の形も系列ごとに変える
 *   - 文字は文字の色（系列の色を文字に使わない）
 */

type TrendSlide = Extract<ReportSlide, { layout: 'trend' }>;
type BarsSlide = Extract<ReportSlide, { layout: 'bars' }>;

/** 系列の色（順番は固定）。validate_palette.js で検証済み（components/charts/README.md） */
export const SLIDE_SERIES_COLORS = ['#3f43b0', '#c98600', '#0b8a4d'] as const;
/** 棒: 主 = ネイビー、比べる相手 = 青みのグレー（slide.css の .bar-main / .bar-muted と同じ） */
export const SLIDE_BAR_MAIN = '#000066';
export const SLIDE_BAR_COMPARE = '#c9cedf';

/** グラフの文字（SVG の 1 = スライドの 1px）。目盛 11pt・最後の点の値 12pt。PDF の画像化でも同じ大きさになるよう、属性でも書く（CSS は ai-slide.css の .rs-tick / .rs-end） */
const TICK = { fontSize: 22, fill: '#767c96' } as const;
const END = { fontSize: 24, fontWeight: 700, fill: '#15182d' } as const;

const nf = new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 1 });
export const fmtNum = (v: number): string => nf.format(v);

/** "2026-01" → "1月"（1 月と先頭だけ年を付ける） */
export function monthLabel(ym: string, first: boolean): string {
  const [y, m] = ym.split('-');
  return first || Number(m) === 1 ? `${y}年${Number(m)}月` : `${Number(m)}月`;
}

/** 軸の目盛（きりのよい数。0 を含む。4〜6 本） */
export function niceTicks(min: number, max: number): number[] {
  const lo = Math.min(0, min);
  const hi = Math.max(0, max);
  const span = hi - lo || 1;
  const raw = span / 4;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((k) => k * pow).find((s) => s >= raw) ?? 10 * pow;
  const start = Math.floor(lo / step) * step;
  const out: number[] = [];
  for (let v = start; v < hi + step * 0.999; v += step) out.push(Number(v.toPrecision(12)));
  return out;
}

/** 置き場所が測れないとき（テストの jsdom など）の大きさ */
const FALLBACK = { w: 1680, h: 520 };
const M = { l: 104, r: 170, t: 22, b: 58 };

/**
 * グラフを描く箱の大きさを、スライド上の px（1920×1080 の座標）で返す。
 * 本文は SlideFrame が倍率 --z で拡大・縮小するので、箱の大きさ（拡大前）× --z がスライド上の大きさになる。
 * viewBox をこの大きさにすると、SVG の 1 = スライドの 1px になり、文字の大きさ（22〜24px = 11〜12pt）が倍率に左右されない。
 */
function useSlideBox(): [React.RefObject<HTMLDivElement | null>, { w: number; h: number }] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [box, setBox] = useState(FALLBACK);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const z = parseFloat(getComputedStyle(el).getPropertyValue('--z')) || 1;
      const w = Math.round(el.clientWidth * z);
      const h = Math.round(el.clientHeight * z);
      if (w > 200 && h > 120) setBox((b) => (b.w === w && b.h === h ? b : { w, h }));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, box];
}

function Marker({ shape, x, y, color, k = 1 }: { shape: number; x: number; y: number; color: string; k?: number }) {
  // 白い縁（2px）で、線や他の点と重なっても読めるようにする
  const ring = { stroke: '#ffffff', strokeWidth: 2.5 * k, fill: color };
  const a = 7 * k;
  if (shape === 1) return <rect x={x - a} y={y - a} width={a * 2} height={a * 2} {...ring} />;
  if (shape === 2) return <rect x={x - a} y={y - a} width={a * 2} height={a * 2} transform={`rotate(45 ${x} ${y})`} {...ring} />;
  return <circle cx={x} cy={y} r={a * 1.1} {...ring} />;
}

function Swatch({ shape, color }: { shape: number; color: string }) {
  return (
    <svg width="26" height="14" viewBox="0 0 26 14" aria-hidden="true" style={{ flex: 'none' }}>
      <line x1="0" y1="7" x2="26" y2="7" stroke={color} strokeWidth="3" />
      <Marker shape={shape} x={13} y={7} color={color} k={0.65} />
    </svg>
  );
}

/** 月次の推移（折れ線。1〜3 本・同じ単位・1 軸） */
export function TrendChart({ slide }: { slide: TrendSlide }) {
  const [boxRef, { w: W, h: H }] = useSlideBox();
  const months = Array.from(new Set(slide.series.flatMap((s) => s.points.map((p) => p.x)))).sort();
  const ys = slide.series.flatMap((s) => s.points.map((p) => p.y));
  const ticks = niceTicks(Math.min(...ys), Math.max(...ys));
  const y0 = ticks[0];
  const y1 = ticks[ticks.length - 1];
  const pw = W - M.l - M.r;
  const ph = H - M.t - M.b;
  const xOf = (m: string) => M.l + (months.length > 1 ? (months.indexOf(m) / (months.length - 1)) * pw : pw / 2);
  const yOf = (v: number) => M.t + ph - ((v - y0) / (y1 - y0 || 1)) * ph;
  const unit = slide.unit;
  // 最後の点の値。近い値どうしが重ならないよう、縦に 30 以上離す
  const ends = slide.series
    .map((s, i) => {
      const sorted = [...s.points].sort((a, b) => a.x.localeCompare(b.x));
      const last = sorted[sorted.length - 1];
      return { i, x: xOf(last.x), y: yOf(last.y), ly: yOf(last.y), text: `${fmtNum(last.y)}${unit}` };
    })
    .sort((a, b) => a.y - b.y);
  for (let k = 1; k < ends.length; k++) if (ends[k].ly - ends[k - 1].ly < 30) ends[k].ly = ends[k - 1].ly + 30;
  const multi = slide.series.length > 1;
  // 月のラベルは 1 つ 130px を目安に、入り切らないときは間引く（最後の月から数えて等間隔。年は最初のラベルと 1 月に付ける）
  const labelEvery = Math.max(1, Math.ceil((months.length * 130) / pw));
  const label = `${slide.series.map((s) => s.name).join('・')}の月次の推移（${monthLabel(months[0], true)}〜${monthLabel(months[months.length - 1], true)}）`;
  return (
    <div className="rs-chart" data-testid="trend-chart">
      {(multi || unit) && (
        <div className="rs-legend">
          {multi &&
            slide.series.map((s, i) => (
              <span key={i} className="rs-legend-item">
                <Swatch shape={i} color={SLIDE_SERIES_COLORS[i]} />
                {s.name}
              </span>
            ))}
          {!multi && <span className="rs-legend-item">{slide.series[0].name}</span>}
          {unit && <span className="rs-legend-unit">単位：{unit}</span>}
        </div>
      )}
      <div ref={boxRef} className="rs-chart-box">
      <svg className="chart-svg rs-chart-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label} preserveAspectRatio="xMidYMid meet">
        {ticks.map((t) => (
          <g key={t}>
            <line className={t === 0 ? 'axis' : 'grid-line'} x1={M.l} x2={W - M.r} y1={yOf(t)} y2={yOf(t)} />
            <text className="rs-tick" {...TICK} x={M.l - 16} y={yOf(t)} textAnchor="end" dominantBaseline="central">
              {fmtNum(t)}
            </text>
          </g>
        ))}
        {months.map(
          (m, i) =>
            (months.length - 1 - i) % labelEvery === 0 && (
              <text key={m} className="rs-tick" {...TICK} x={xOf(m)} y={H - M.b + 38} textAnchor="middle">
                {monthLabel(m, i === (months.length - 1) % labelEvery)}
              </text>
            ),
        )}
        {slide.series.map((s, i) => {
          const pts = [...s.points].sort((a, b) => a.x.localeCompare(b.x));
          return (
            <g key={i} data-series={s.name}>
              <polyline points={pts.map((p) => `${xOf(p.x)},${yOf(p.y)}`).join(' ')} fill="none" stroke={SLIDE_SERIES_COLORS[i]} strokeWidth={4} strokeLinejoin="round" strokeLinecap="round" />
              {pts.map((p) => (
                <g key={p.x}>
                  <Marker shape={i} x={xOf(p.x)} y={yOf(p.y)} color={SLIDE_SERIES_COLORS[i]} />
                  {/* 点に乗せたときの値（ブラウザの標準のツールチップ） */}
                  <circle cx={xOf(p.x)} cy={yOf(p.y)} r={20} fill="transparent">
                    <title>{`${s.name} ${monthLabel(p.x, true)}：${fmtNum(p.y)}${unit}`}</title>
                  </circle>
                </g>
              ))}
            </g>
          );
        })}
        {ends.map((e) => (
          <text key={e.i} className="rs-end" {...END} x={e.x + 20} y={e.ly} dominantBaseline="central">
            {e.text}
          </text>
        ))}
      </svg>
      </div>
    </div>
  );
}

/** 横棒（項目の比較）。比べる相手（compare）があれば、細い棒を下に並べる。目盛は 0 から */
export function BarsChart({ slide }: { slide: BarsSlide }) {
  const hasCompare = slide.items.some((it) => it.compare !== null);
  const max = Math.max(1e-9, ...slide.items.flatMap((it) => [it.value, it.compare ?? 0]));
  const pct = (v: number) => `${Math.max(0, Math.min(100, (v / max) * 100))}%`;
  const unit = slide.unit;
  const valueLabel = slide.valueLabel || '実績';
  const compareLabel = slide.compareLabel || '比較';
  return (
    <div className="rs-chart" data-testid="bars-chart" role="img" aria-label={`${slide.items.map((it) => `${it.label} ${fmtNum(it.value)}${unit}`).join('、')}`}>
      {(hasCompare || unit) && (
        <div className="rs-legend">
          {hasCompare && (
            <>
              <span className="rs-legend-item">
                <span className="rs-swatch" style={{ background: SLIDE_BAR_MAIN }} />
                {valueLabel}
              </span>
              <span className="rs-legend-item">
                <span className="rs-swatch" style={{ background: SLIDE_BAR_COMPARE }} />
                {compareLabel}
              </span>
            </>
          )}
          {!hasCompare && slide.valueLabel && <span className="rs-legend-item">{slide.valueLabel}</span>}
          {unit && <span className="rs-legend-unit">単位：{unit}</span>}
        </div>
      )}
      <div className="rs-bars" style={{ gridTemplateRows: `repeat(${slide.items.length}, 1fr)` }}>
        {slide.items.map((it, i) => (
          <div key={i} className="rs-bar-row">
            <div className="rs-bar-label">{it.label}</div>
            <svg className="rs-bar-svg" width="100%" height={hasCompare ? 28 : 16} aria-hidden="true">
              <title>{`${it.label}：${fmtNum(it.value)}${unit}${it.compare !== null ? `（${compareLabel} ${fmtNum(it.compare)}${unit}）` : ''}`}</title>
              <line className="axis" x1="0.5" x2="0.5" y1="0" y2="100%" />
              {/* 根元は角、先だけ丸める */}
              <rect x="0" y="0" width={pct(it.value)} height="16" rx="4" fill={SLIDE_BAR_MAIN} />
              {it.value > 0 && <rect x="0" y="0" width="4" height="16" fill={SLIDE_BAR_MAIN} />}
              {it.compare !== null && <rect x="0" y="19" width={pct(it.compare)} height="9" rx="3" fill={SLIDE_BAR_COMPARE} />}
              {it.compare !== null && it.compare > 0 && <rect x="0" y="19" width="3" height="9" fill={SLIDE_BAR_COMPARE} />}
            </svg>
            <div className="rs-bar-value">
              <span className="num rs-bar-num">{fmtNum(it.value)}</span>
              {unit && <span className="rs-bar-unit">{unit}</span>}
              {it.compare !== null && (
                <span className="rs-bar-compare">
                  {compareLabel} {fmtNum(it.compare)}
                  {unit}
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
