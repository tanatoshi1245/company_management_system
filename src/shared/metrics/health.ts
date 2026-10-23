import type { HeatScore } from './heatmap';

/** 指標ごとの重み（スカウト 2、返信・応募・採用 1、閲覧 0.5、求人枠 1、ログイン 0.5） */
export const HEALTH_WEIGHTS: Record<string, number> = {
  scout_utilization: 2,
  reply_rate: 1,
  apps_per_active_job: 1,
  hires: 1,
  views_per_active_job: 0.5,
  job_utilization: 1,
  login_days: 0.5,
};

export type HealthLevel = 'alert' | 'watch' | 'good' | 'none';
export const HEALTH_LABEL: Record<HealthLevel, string> = { alert: '要注意', watch: '注意', good: '順調', none: '判定なし' };

export interface Health {
  level: HealthLevel;
  /** 重み付き平均を四捨五入（−2〜2）。判定できなければ null */
  s: HeatScore | null;
  score: number | null;
  /** 最もスコアの低い指標 */
  worst: string | null;
  worstScore: HeatScore | null;
}

/** 指標スコア（null は無視）→ ヘルス。要注意 = 平均 ≤ −1、注意 = 平均 0 だが −1 以下の指標がある、順調 = それ以外 */
export function companyHealth(scores: Record<string, HeatScore | null | undefined>, weights: Record<string, number> = HEALTH_WEIGHTS): Health {
  let sum = 0;
  let wsum = 0;
  let worst: string | null = null;
  let worstScore: HeatScore | null = null;
  for (const [k, s] of Object.entries(scores)) {
    if (s === null || s === undefined) continue;
    const w = weights[k] ?? 1;
    sum += s * w;
    wsum += w;
    if (worstScore === null || s < worstScore) {
      worst = k;
      worstScore = s;
    }
  }
  if (wsum === 0) return { level: 'none', s: null, score: null, worst: null, worstScore: null };
  const score = sum / wsum;
  const s = (Math.max(-2, Math.min(2, Math.round(score))) || 0) as HeatScore; // -0 を 0 に
  const level: HealthLevel = s <= -1 ? 'alert' : worstScore !== null && worstScore <= -1 ? 'watch' : 'good';
  return { level, s, score, worst, worstScore };
}
