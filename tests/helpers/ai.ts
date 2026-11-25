import { vi } from 'vitest';
import app from '../../src/worker/index';
import { ctx, googleEnv } from './env';
import { jsonHeaders } from './login';
import { createFakeD1 } from './fakeD1';
import type { Env } from '../../src/worker/env';

/** AI 機能のテストの道具: 本番相当（サンプルデータではない）の Env、発火の fetch の差し替え、リクエストの短縮形 */
export const FIRE_TOKEN = 'sk-ant-oat01-TESTTOKENVALUE';
export const SESSION_URL = 'https://claude.ai/code/session_test123';

export function prodEnv(d1: ReturnType<typeof createFakeD1>, extra: Partial<Env> = {}): Env {
  return { ...googleEnv, BQ_MOCK: '0', CMS_DB: d1 as unknown as D1Database, AI_ROUTINE_ID: 'trig_test01', AI_ROUTINE_TOKEN: FIRE_TOKEN, ...extra };
}

export interface FireCall {
  url: string;
  headers: Record<string, string>;
  text: string;
}

/** globalThis.fetch を差し替える（発火の API だけが呼ばれる想定）。calls に、宛先・ヘッダー・本文の text を残す */
export function stubFire(respond: () => Response = () => new Response(JSON.stringify({ type: 'routine_fire', claude_code_session_id: 'session_test123', claude_code_session_url: SESSION_URL }), { status: 200 })): FireCall[] {
  const calls: FireCall[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), headers: (init?.headers ?? {}) as Record<string, string>, text: (JSON.parse(String(init?.body ?? '{}')) as { text: string }).text });
      return respond();
    }),
  );
  return calls;
}

/** 発火の本文から、合言葉と URL を取り出す（セッションの役） */
export function parseFireText(text: string): { token: string; context: string; result: string } {
  return { token: /[0-9a-f]{64}/.exec(text)?.[0] ?? '', context: /https?:\/\/\S+\/context/.exec(text)?.[0] ?? '', result: /https?:\/\/\S+\/result/.exec(text)?.[0] ?? '' };
}

export const client = (env: () => Env, cookie: () => string) => ({
  get: (path: string, c = cookie()) => app.fetch(new Request(`http://x${path}`, { headers: c ? { cookie: c } : {} }), env(), ctx),
  post: (path: string, body: unknown, c = cookie()) => app.fetch(new Request(`http://x${path}`, { method: 'POST', headers: jsonHeaders(c ? { cookie: c } : {}), body: JSON.stringify(body) }), env(), ctx),
  put: (path: string, body: unknown, c = cookie()) => app.fetch(new Request(`http://x${path}`, { method: 'PUT', headers: jsonHeaders(c ? { cookie: c } : {}), body: JSON.stringify(body) }), env(), ctx),
  del: (path: string, c = cookie()) => app.fetch(new Request(`http://x${path}`, { method: 'DELETE', headers: jsonHeaders(c ? { cookie: c } : {}) }), env(), ctx),
  hookGet: (url: string, token: string | null) => app.fetch(new Request(url, { headers: token === null ? {} : { authorization: `Bearer ${token}` } }), env(), ctx),
  hookPost: (url: string, token: string | null, body: unknown) => app.fetch(new Request(url, { method: 'POST', headers: { 'content-type': 'application/json', ...(token === null ? {} : { authorization: `Bearer ${token}` }) }, body: typeof body === 'string' ? body : JSON.stringify(body) }), env(), ctx),
});

export const scoutInput = (over: Record<string, unknown> = {}) => ({ purpose: 'review', subject: '【営業職】ご経験を拝見しました', body: 'はじめまして。{{企業名}} の {{担当者名}} です。ご経験を拝見してご連絡しました。', industry: 'IT・通信', occupations: ['営業'], positionName: '法人営業', ...over });
export const jobInput = (over: Record<string, unknown> = {}) => ({ purpose: 'create', industry: 'IT・通信', occupations: ['営業'], positionName: '法人営業', ...over });
