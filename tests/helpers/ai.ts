import { generateKeyPairSync } from 'node:crypto';
import { vi } from 'vitest';
import app from '../../src/worker/index';
import { ctx, googleEnv } from './env';
import { jsonHeaders } from './login';
import { createFakeD1 } from './fakeD1';
import type { Env } from '../../src/worker/env';

/** AI 機能のテストの道具: 本番相当（サンプルデータではない）の Env、Vertex AI の fetch の差し替え、リクエストの短縮形 */
export const ACCESS_TOKEN = 'ya29.TESTACCESSTOKENVALUE';
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
/** テスト用に、その場で作った鍵（どこの認証にも使えない） */
export const TEST_SA_KEY = JSON.stringify({ client_email: 'vertex-test@example.iam.gserviceaccount.com', private_key: privateKey });
export const ENGINES = { a: 'eng-a', b: 'eng-b', c: 'eng-c', insight: 'eng-insight' } as const;

export function prodEnv(d1: ReturnType<typeof createFakeD1>, extra: Partial<Env> = {}): Env {
  return { ...googleEnv, BQ_MOCK: '0', CMS_DB: d1 as unknown as D1Database, VERTEX_PROJECT: 'bq-hgt', VERTEX_LOCATION: 'global', VERTEX_SA_KEY: TEST_SA_KEY, AI_SCOUT_ENGINES: `a=${ENGINES.a},b=${ENGINES.b},c=${ENGINES.c}`, AI_INSIGHT_ENGINE: ENGINES.insight, ...extra };
}

export interface VertexCall {
  url: string;
  engine: string;
  authorization: string;
  system: string;
  user: string;
  config: Record<string, unknown>;
}

export const insightJson = () => ({
  subjectPatterns: ['【勤務地・働き方】ポジション名｜魅力をひとこと', '【活かせる経験】ポジション名のご案内'],
  structure: ['呼びかけと名乗り', 'なぜあなたに送ったか', 'お任せしたいこと（箇条書き）', '次の一歩'],
  volume: '本文 310〜720 字（中央値 480 字）。',
  traits: [
    { title: '送った理由を冒頭に', body: '経験のどこを見て連絡したかを書いています。' },
    { title: '箇条書き', body: '業務を 3 点ほどにまとめています。' },
  ],
  avoid: ['会社紹介から始める'],
});
export const draftJson = (engine: string) => ({ subject: `【東京】法人営業のご案内（${engine}）`, body: `{{候補者名}} 様\n\n{{企業名}} の {{担当者名}} です。ご経験を拝見し、ご連絡しました（${engine}）。\n・{{仕事内容}}\n\nご興味があれば、ひとことご返信ください。`, rationale: `件名の型と構成に沿いました（${engine}）。`, changes: ['件名を型に合わせました。'] });
export const tunedJson = (label: string) => ({ playbook: `【持ち味】${label}（直した版）。\n${'【件名】分析の型に沿い、ポジション名を先頭に置く。'.repeat(8)}\n【してはいけないこと】依頼に無い事実を作らない。差し込み {{候補者名}} を使う。`, note: `件名でポジション名を先頭に置くようにしました（${label}）。` });

export const vertexResponse = (data: unknown, usage = { promptTokenCount: 1000, candidatesTokenCount: 200, thoughtsTokenCount: 0 }): Response =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: typeof data === 'string' ? data : JSON.stringify(data) }] }, finishReason: 'STOP' }], usageMetadata: usage }), { status: 200, headers: { 'content-type': 'application/json' } });

/** 既定の応答: 分析の要点 / チューニング（system に「プレイブック」）/ 文面 */
export function defaultVertex(call: VertexCall): Response {
  if (call.engine === ENGINES.insight) return vertexResponse(call.system.includes('プレイブック') ? tunedJson(/# このモデル\n([abc])/.exec(call.user)?.[1] ?? 'x') : insightJson());
  return vertexResponse(draftJson(call.engine));
}

/**
 * globalThis.fetch を差し替える（Vertex AI と、そのアクセストークンの取得だけが呼ばれる想定）。
 * calls に Vertex AI の呼び出しを、tokenCalls にトークンの取得の回数を残す
 */
export function stubVertex(respond: (call: VertexCall) => Response | Promise<Response> = defaultVertex): { calls: VertexCall[]; tokenCalls: { n: number }; other: string[] } {
  const calls: VertexCall[] = [];
  const tokenCalls = { n: 0 };
  const other: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === 'https://oauth2.googleapis.com/token') {
        tokenCalls.n++;
        return new Response(JSON.stringify({ access_token: ACCESS_TOKEN, expires_in: 3600 }), { status: 200 });
      }
      const m = /^https:\/\/aiplatform\.googleapis\.com\/v1\/projects\/bq-hgt\/locations\/global\/publishers\/google\/models\/([a-z0-9.-]+):generateContent$/.exec(url);
      if (!m) {
        other.push(url);
        return new Response('unexpected', { status: 500 });
      }
      const body = JSON.parse(String(init?.body ?? '{}')) as { contents: { parts: { text: string }[] }[]; systemInstruction: { parts: { text: string }[] }; generationConfig: Record<string, unknown> };
      const call: VertexCall = { url, engine: m[1]!, authorization: (init?.headers as Record<string, string>).authorization ?? '', system: body.systemInstruction.parts[0]!.text, user: body.contents[0]!.parts[0]!.text, config: body.generationConfig };
      calls.push(call);
      return respond(call);
    }),
  );
  return { calls, tokenCalls, other };
}

export const client = (env: () => Env, cookie: () => string) => ({
  get: (path: string, c = cookie()) => app.fetch(new Request(`http://x${path}`, { headers: c ? { cookie: c } : {} }), env(), ctx),
  post: (path: string, body: unknown, c = cookie()) => app.fetch(new Request(`http://x${path}`, { method: 'POST', headers: jsonHeaders(c ? { cookie: c } : {}), body: JSON.stringify(body) }), env(), ctx),
  put: (path: string, body: unknown, c = cookie()) => app.fetch(new Request(`http://x${path}`, { method: 'PUT', headers: jsonHeaders(c ? { cookie: c } : {}), body: JSON.stringify(body) }), env(), ctx),
  del: (path: string, c = cookie()) => app.fetch(new Request(`http://x${path}`, { method: 'DELETE', headers: jsonHeaders(c ? { cookie: c } : {}) }), env(), ctx),
});

export const scoutInput = (over: Record<string, unknown> = {}) => ({ purpose: 'template', industry: 'IT・通信', positionName: '法人営業', jobOccupations: ['営業'], jobLocation: '東京都', ...over });
export const scoutReviewInput = (over: Record<string, unknown> = {}) => scoutInput({ purpose: 'review', subject: '【営業職】ご経験を拝見しました', body: 'はじめまして。{{企業名}} の {{担当者名}} です。ご経験を拝見してご連絡しました。', ...over });
export const jobInput = (over: Record<string, unknown> = {}) => ({ purpose: 'create', industry: 'IT・通信', occupations: ['営業'], positionName: '法人営業', ...over });
