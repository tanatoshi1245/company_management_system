/** ジョブ ID（英小文字と数字。時刻 + 8 バイトの乱数）。AiJobIdSchema の形 */
export function newJobId(now: Date = new Date()): string {
  const rand = Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => b.toString(16).padStart(2, '0')).join('');
  return now.getTime().toString(36) + rand;
}

/** 文面の案の ID（ジョブ ID + モデルの ID。ScoutDraftSchema.draftId の形） */
export const draftIdOf = (jobId: string, modelId: string): string => `${jobId}${modelId}`;
