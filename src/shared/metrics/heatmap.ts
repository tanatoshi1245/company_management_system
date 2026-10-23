export type HeatScore = -2 | -1 | 0 | 1 | 2;
export const HEAT_SCORES: HeatScore[] = [-2, -1, 0, 1, 2];

/** 比率（実績 ÷ 基準）→ 5 段階。0.5 / 0.8 / 1.2 / 1.5 */
export const HEAT_THRESHOLDS = [0.5, 0.8, 1.2, 1.5] as const;

export function scoreRatio(r: number | null | undefined, polarity: 'higher' | 'lower' = 'higher'): HeatScore | null {
  if (r === null || r === undefined || !Number.isFinite(r)) return null;
  let s: HeatScore;
  if (r < HEAT_THRESHOLDS[0]) s = -2;
  else if (r < HEAT_THRESHOLDS[1]) s = -1;
  else if (r < HEAT_THRESHOLDS[2]) s = 0;
  else if (r < HEAT_THRESHOLDS[3]) s = 1;
  else s = 2;
  return polarity === 'lower' ? (-s as HeatScore) : s;
}

export const HEAT_LABEL_INDUSTRY: Record<HeatScore, string> = { [-2]: '中央値の半分未満', [-1]: '中央値を下回る', 0: '中央値付近', 1: '中央値を上回る', 2: '中央値の 1.5 倍以上' };
export const HEAT_LABEL_TARGET: Record<HeatScore, string> = { [-2]: '期待の 50% 未満', [-1]: '期待の 50〜80%', 0: '期待の 80〜120%', 1: '期待の 120〜150%', 2: '期待の 150% 以上' };

/** CSS のトークン名 */
export function heatToken(s: HeatScore | null): string {
  if (s === null) return 'na';
  return s < 0 ? `n${-s}` : s > 0 ? `p${s}` : '0';
}
