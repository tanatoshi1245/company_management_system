import type { Env } from '../env';

/**
 * AI 機能の停止スイッチ（2026-11-27 ユーザー指示「内容を確認するまでは、AI の実行機能を止める」）。
 * **既定は停止**。wrangler.jsonc の vars（または Worker の変数）で AI_ENABLED = "1" にしたときだけ動く。
 * 停止中は:
 *   - 左のレールに AI メニューを出さない（/api/meta の ai = false）
 *   - /api/ai/* と /api/companies/:id/ai/* は、すべて 503（code: aiDisabled）。BigQuery の分析用の表（候補者の職務経歴を含む）も読まない
 *   - Vertex AI を呼ばない（callVertexJson の入口でも止める = 二重の歯止め）
 *   - 週次の検証・チューニング（cron）は何もしない
 * 再開するときは、docs/AI機能.md の「再開の前に確かめること」を済ませてから。
 */
export const aiEnabled = (env: Pick<Env, 'AI_ENABLED'>): boolean => env.AI_ENABLED === '1';

export const AI_DISABLED_MESSAGE = 'AI 機能は、内容の確認が済むまで停止しています';
