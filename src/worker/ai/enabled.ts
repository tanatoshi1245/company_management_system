import type { Env } from '../env';

/**
 * AI 機能の停止スイッチ（2026-11-27 ユーザー指示「内容を確認するまでは、AI の実行機能を止める」）。
 * **既定は停止**。wrangler.jsonc の vars（または Worker の変数）で AI_ENABLED = "1" にしたときだけ動く。
 * 停止中は:
 *   - 左のレールに AI メニューを出さない（/api/meta の ai = false）
 *   - /api/ai/* と /api/companies/:id/ai/* は、すべて 503（code: aiDisabled）。BigQuery の分析用の表も読まない
 *   - Vertex AI を呼ばない（callVertexJson の入口でも止める = 二重の歯止め）
 *   - 週次の検証・チューニング（cron）は何もしない
 * 再開するときは、docs/AI機能.md の「再開の前に確かめること」を済ませてから。
 */
export const aiEnabled = (env: Pick<Env, 'AI_ENABLED'>): boolean => env.AI_ENABLED === '1';

export const AI_DISABLED_MESSAGE = 'AI 機能は、内容の確認が済むまで停止しています';

/**
 * ② スカウト: 会員 ID から作る 2 つの作り方（member・jobMember）を開けるか（2026-11-27）。
 * 候補者の属性（年齢層・語学力・経験職種など）を Vertex AI へ渡すので、ユーザーの確認が済むまで閉じておく。
 * **既定は閉じる**。AI_ENABLED = "1" で、かつ AI_SCOUT_MEMBER = "1" のときだけ開く。
 * 閉じている間は:
 *   - 画面に、会員 ID の 2 つの作り方を出さない（/api/ai/config の features.scoutMember = false）
 *   - GET /api/ai/scout/members/:memberId と、basis が member / jobMember の依頼は 403（code: featureDisabled）
 *   - 会員のデータ（マート cms_ai_member_profiles）を読まない・Vertex AI を呼ばない
 * 「条件を指定」「求人 ID」の 2 つは、この設定に依らず使える。
 */
export const aiScoutMemberEnabled = (env: Pick<Env, 'AI_ENABLED' | 'AI_SCOUT_MEMBER'>): boolean => aiEnabled(env) && env.AI_SCOUT_MEMBER === '1';

export const AI_SCOUT_MEMBER_DISABLED_MESSAGE = '会員 ID から作る機能は、確認が済むまで閉じています';
export const AI_SCOUT_MEMBER_DISABLED_CODE = 'featureDisabled';

