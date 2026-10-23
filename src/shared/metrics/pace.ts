import { rate } from './utilization';

export type PaceStatus = 'na' | 'early' | 'behind' | 'watch' | 'on' | 'ahead';
export const PACE_LABEL: Record<PaceStatus, string> = { na: '枠なし', early: '判定前', behind: '遅れ', watch: '注意', on: '順調', ahead: '前倒し' };

export interface PaceInput {
  /** 当月の送信数（枠の期間が契約なら契約開始からの累計） */
  sent: number;
  limit: number | null;
  /** 営業日消化率（0〜1）。枠の期間が契約なら契約経過率 */
  progressRate: number;
  /** 経過営業日（3 未満は判定しない） */
  elapsedDays: number;
}

export interface Pace {
  /** 消化率 = sent / limit */
  util: number | null;
  /** 期待消化数 = limit × progressRate */
  expected: number | null;
  /** 消化率 − 進捗率 */
  gap: number | null;
  /** 消化率 ÷ 進捗率（ヒートマップの比率） */
  ratio: number | null;
  status: PaceStatus;
}

export const PACE_MIN_DAYS = 3;

export function scoutPace(i: PaceInput): Pace {
  const util = rate(i.sent, i.limit);
  if (util === null || i.limit === null) return { util, expected: null, gap: null, ratio: null, status: 'na' };
  const expected = i.limit * i.progressRate;
  const gap = util - i.progressRate;
  const ratio = i.progressRate > 0 ? util / i.progressRate : null;
  if (i.elapsedDays < PACE_MIN_DAYS || ratio === null) return { util, expected, gap, ratio, status: 'early' };
  return { util, expected, gap, ratio, status: paceStatus(ratio) };
}

export function paceStatus(ratio: number): PaceStatus {
  if (ratio < 0.8) return 'behind';
  if (ratio < 1.0) return 'watch';
  if (ratio <= 1.2) return 'on';
  return 'ahead';
}

/** 目標比の達成率: 実績 ÷ (目標 × 進捗率)。目標なし・期待 0 は null */
export function targetProgress(actual: number, target: number | null | undefined, progressRate: number): { expected: number | null; progress: number | null } {
  if (target === null || target === undefined) return { expected: null, progress: null };
  const expected = target * progressRate;
  if (expected <= 0) return { expected, progress: null };
  return { expected, progress: actual / expected };
}
