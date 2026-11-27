import type { Env } from '../../src/worker/env';

export const assets = { fetch: async () => new Response('<html>spa</html>', { headers: { 'content-type': 'text/html' } }) } as unknown as Fetcher;
/** モック（BQ_MOCK=1・Google 未設定）の基本 Env */
export const baseEnv: Env = { ASSETS: assets, BQ_PROJECT: 'bq-hgt', BQ_LOCATION: 'asia-northeast1', BQ_MOCK: '1', ALLOWED_EMAIL_DOMAINS: 'daijob.com', AI_ENABLED: '1' };
/** AI 機能の停止スイッチが入っていない（既定 = 停止）Env */
export const aiOffEnv: Env = { ...baseEnv, AI_ENABLED: undefined };
/** 会員 ID から作る機能（② スカウトの member / jobMember）を開けた Env（既定 = baseEnv は閉じている）。ほかの Env に足すときは { ...env, ...SCOUT_MEMBER_ON } */
export const SCOUT_MEMBER_ON = { AI_SCOUT_MEMBER: '1' } as const satisfies Partial<Env>;
export const scoutMemberOnEnv: Env = { ...baseEnv, ...SCOUT_MEMBER_ON };
export const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
export const SECRET = 's'.repeat(40);
/** Google ログインを設定した Env（鍵は無くてもモックなら動く） */
export const googleEnv: Env = { ...baseEnv, GOOGLE_CLIENT_ID: 'cid.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'csecret', SESSION_SECRET: SECRET };
