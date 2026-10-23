import { daysBetween } from '../../lib/format';

/** 契約期間の細線（開始 → 終了、今日の印、経過の塗り）。compact はボードの行用（幅 88px・ラベルなし） */
export function TimelineBar({ start, end, today, compact = false }: { start: string; end: string | null; today: string; compact?: boolean }) {
  const w = compact ? 88 : 100;
  const total = end ? Math.max(1, daysBetween(start, end)) : null;
  const elapsed = Math.max(0, daysBetween(start, today));
  const frac = total === null ? Math.min(1, elapsed / 365) : Math.max(0, Math.min(1, elapsed / total));
  const x = frac * w;
  const label = end ? `${start} 〜 ${end}（経過 ${Math.round(frac * 100)}%）` : `${start} 〜 無期限`;
  return (
    <svg className="timeline" width={compact ? w : '100%'} height={compact ? 10 : 14} viewBox={`0 0 ${w} ${compact ? 10 : 14}`} preserveAspectRatio="none" role="img" aria-label={label}>
      <line x1="0" y1="5" x2={w} y2="5" stroke="var(--rule-strong)" strokeWidth="1" />
      <line x1="0" y1="5" x2={x} y2="5" stroke="var(--seq-3)" strokeWidth="2" />
      <line x1={x} y1="1" x2={x} y2="9" stroke="var(--ink)" strokeWidth="1.5" />
      {end === null ? <polygon points={`${w - 4},2 ${w},5 ${w - 4},8`} fill="var(--rule-strong)" /> : null}
    </svg>
  );
}
