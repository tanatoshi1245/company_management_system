/** 小さな折れ線（KPI タイル・列見出し）。1 色・最終点だけ強調。viewBox で描くので幅は CSS 任せ */
export function Sparkline({ values, width = 96, height = 24, ariaLabel, highlightLast = true }: { values: (number | null)[]; width?: number; height?: number; ariaLabel: string; highlightLast?: boolean }) {
  const xs = values.map((v) => (v === null || !Number.isFinite(v) ? null : v));
  const nums = xs.filter((v): v is number => v !== null);
  if (nums.length < 2) return <svg className="spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel} />;
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const pad = 2;
  const sx = (i: number) => pad + (i / (xs.length - 1)) * (width - pad * 2);
  const sy = (v: number) => (max === min ? height / 2 : pad + (1 - (v - min) / (max - min)) * (height - pad * 2));
  let d = '';
  let started = false;
  xs.forEach((v, i) => {
    if (v === null) {
      started = false;
      return;
    }
    d += `${started ? 'L' : 'M'}${sx(i).toFixed(1)},${sy(v).toFixed(1)} `;
    started = true;
  });
  const lastIdx = xs.length - 1 - [...xs].reverse().findIndex((v) => v !== null);
  const last = xs[lastIdx];
  return (
    <svg className="spark" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel}>
      <path d={d.trim()} fill="none" stroke="var(--seq-4)" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
      {highlightLast && last !== null ? <circle cx={sx(lastIdx)} cy={sy(last)} r="2.2" fill="var(--seq-5)" stroke="var(--surface)" strokeWidth="1" /> : null}
    </svg>
  );
}
