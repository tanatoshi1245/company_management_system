import type { z } from 'zod';
import type { Env } from '../env';
import { isMock } from '../env';
import { safeFetch } from '../lib/safeFetch';
import { parseServiceAccountKey, type ServiceAccountKey } from '../bq/auth';
import { SCOUT_MODEL_IDS, type ScoutModelId } from '../../shared/ai/scout';

/**
 * Vertex AI（generateContent）の呼び出し。AI 機能の生成は、すべてここを通る。
 *   宛先 … https://aiplatform.googleapis.com（lib/safeFetch.ts の許可リスト）。location は設定値（global）
 *   認証 … SA 鍵（Secret VERTEX_SA_KEY。無ければ BQ_SA_KEY）→ アクセストークン（scope = cloud-platform）。isolate の中で使い回す
 *   出力 … JSON（responseSchema で形を指定）→ zod で検証。読めない・通らないときは 1 回だけやり直す
 * 生成モデルの ID は設定値（wrangler.jsonc の vars）。ここには書かない。エラー文・ログに鍵・トークンを出さない
 */

export const VERTEX_HOST = 'aiplatform.googleapis.com';
const SCOPE = 'https://www.googleapis.com/auth/cloud-platform';
const TOKEN_URI = 'https://oauth2.googleapis.com/token';
export const VERTEX_TIMEOUT_MS = 40_000;
const ENGINE_ID = /^[a-z0-9.\-]{3,60}$/;
const PROJECT_ID = /^[a-z][a-z0-9\-]{4,29}$/;
const LOCATION_ID = /^[a-z0-9\-]{2,30}$/;

export type VertexFailure = 'config' | 'auth' | 'http' | 'timeout' | 'network' | 'blocked' | 'parse';

/** 画面・ログに出してよい文だけを持つ（応答の本文・鍵・トークンは入れない） */
export class VertexError extends Error {
  constructor(
    public readonly reason: VertexFailure,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
  }
}

export interface VertexTokens {
  in: number;
  out: number;
  think: number;
}
export const NO_TOKENS: VertexTokens = { in: 0, out: 0, think: 0 };
export const addTokens = (a: VertexTokens, b: VertexTokens): VertexTokens => ({ in: a.in + b.in, out: a.out + b.out, think: a.think + b.think });
export const totalTokens = (t: VertexTokens): number => t.in + t.out + t.think;

const validEngine = (s: string | undefined): string | null => {
  const t = (s ?? '').trim();
  return ENGINE_ID.test(t) ? t : null;
};

/** AI_SCOUT_ENGINES（`a=…,b=…,c=…`）を読む。3 つそろっていて、ID の形が正しいときだけ返す */
export function scoutEngines(env: Env): Record<ScoutModelId, string> | null {
  const out: Partial<Record<ScoutModelId, string>> = {};
  for (const part of (env.AI_SCOUT_ENGINES ?? '').split(',')) {
    const [k, v] = part.split('=').map((x) => x.trim());
    const engine = validEngine(v);
    if (k && engine && (SCOUT_MODEL_IDS as readonly string[]).includes(k)) out[k as ScoutModelId] = engine;
  }
  return SCOUT_MODEL_IDS.every((id) => out[id]) ? (out as Record<ScoutModelId, string>) : null;
}

/** 分析の要点とチューニングに使う生成モデル */
export const insightEngine = (env: Env): string | null => validEngine(env.AI_INSIGHT_ENGINE);
export const checkedEngine = validEngine;

const saKeyRaw = (env: Env): string => (env.VERTEX_SA_KEY?.trim() || env.BQ_SA_KEY?.trim() || '');

/** Vertex AI を呼べる設定がそろっているか（鍵・プロジェクト・location・生成モデルの ID）。値は返さない */
export function vertexConfigured(env: Env): boolean {
  return Boolean(saKeyRaw(env)) && PROJECT_ID.test(env.VERTEX_PROJECT ?? '') && LOCATION_ID.test(env.VERTEX_LOCATION ?? '') && scoutEngines(env) !== null && insightEngine(env) !== null;
}

/** 実際に Vertex AI を呼ぶ環境か（サンプルデータでは呼ばない） */
export const vertexLive = (env: Env): boolean => !isMock(env) && vertexConfigured(env);

/* ---------- アクセストークン（bq/auth.ts と同じ手順。scope が違うので、キャッシュも別に持つ） ---------- */

let cachedToken: { email: string; token: string; expiresAt: number } | null = null;
let inflight: Promise<string> | null = null;

function b64url(input: ArrayBuffer | string): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : new Uint8Array(input);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function pemToDer(pem: string): ArrayBuffer {
  const bin = atob(pem.replace(/-----(BEGIN|END) [A-Z ]+-----/g, '').replace(/\s+/g, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

async function accessToken(sa: ServiceAccountKey, fetchImpl: typeof fetch): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  // 期限の 5 分前までは使い回す
  if (cachedToken && cachedToken.email === sa.client_email && cachedToken.expiresAt - 300 > now) return cachedToken.token;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const key = await crypto.subtle.importKey('pkcs8', pemToDer(sa.private_key), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
      const signingInput = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(JSON.stringify({ iss: sa.client_email, scope: SCOPE, aud: TOKEN_URI, iat: now, exp: now + 3600 }))}`;
      const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(signingInput));
      const res = await fetchImpl(TOKEN_URI, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${signingInput}.${b64url(sig)}` }) });
      if (!res.ok) throw new VertexError('auth', `Vertex AI の認証に失敗しました（HTTP ${res.status}）`, res.status);
      const json = (await res.json()) as { access_token?: string; expires_in?: number };
      if (!json.access_token) throw new VertexError('auth', 'Vertex AI の認証に失敗しました（トークンがありません）');
      cachedToken = { email: sa.client_email, token: json.access_token, expiresAt: now + (json.expires_in ?? 3600) };
      return cachedToken.token;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** テスト用 */
export function _resetVertexAuth(): void {
  cachedToken = null;
  inflight = null;
}

/* ---------- generateContent ---------- */

/**
 * 思考トークンを抑える設定（2026-11-27 に実際に呼んで確かめた = scout/README.md）。
 *   off … thinkingBudget: 0（3 つの生成モデルすべてで受け付け、思考トークン 0）。文面の作成に使う
 *   low … thinkingLevel: 'low'。分析の要点・チューニングに使う
 * 生成モデルを替えて、この設定を受け付けなくなった（400）ときは、設定を外して 1 回だけやり直す
 */
export type VertexThinking = 'off' | 'low';
const thinkingConfigOf = (t: VertexThinking): Record<string, unknown> => (t === 'off' ? { thinkingBudget: 0 } : { thinkingLevel: 'low' });

export interface VertexJsonRequest<T> {
  engine: string;
  system: string;
  user: string;
  /** 出力の検証（zod） */
  schema: z.ZodType<T, z.ZodTypeDef, unknown>;
  /** Vertex AI へ渡す出力の形（JSON スキーマ） */
  responseSchema: Record<string, unknown>;
  maxOutputTokens: number;
  temperature: number;
  /** 既定 off */
  thinking?: VertexThinking;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface VertexJsonResult<T> {
  data: T;
  tokens: VertexTokens;
  ms: number;
}

interface GenerateResponse {
  candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
  promptFeedback?: { blockReason?: string };
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);

/** 文の前後に付いた ``` を外して JSON として読む */
function parseJsonText(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  return JSON.parse(t);
}

async function once<T>(env: Env, token: string, r: VertexJsonRequest<T>, fetchImpl: typeof fetch, withThinking: boolean): Promise<{ data: T; tokens: VertexTokens } | { retry: VertexError; tokens: VertexTokens }> {
  const url = `https://${VERTEX_HOST}/v1/projects/${env.VERTEX_PROJECT}/locations/${env.VERTEX_LOCATION}/publishers/google/models/${r.engine}:generateContent`;
  const thinking = withThinking ? thinkingConfigOf(r.thinking ?? 'off') : null;
  const body = {
    contents: [{ role: 'user', parts: [{ text: r.user }] }],
    systemInstruction: { parts: [{ text: r.system }] },
    generationConfig: { maxOutputTokens: r.maxOutputTokens, temperature: r.temperature, responseMimeType: 'application/json', responseSchema: r.responseSchema, ...(thinking ? { thinkingConfig: thinking } : {}) },
  };
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), r.timeoutMs ?? VERTEX_TIMEOUT_MS);
  let res: Response;
  let json: GenerateResponse;
  try {
    res = await fetchImpl(url, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body), signal: ac.signal });
    if (!res.ok) {
      // 応答の本文は返さない（ログにも状態だけ）
      const err = new VertexError('http', `Vertex AI がエラーを返しました（HTTP ${res.status}）`, res.status);
      if (res.status === 429 || res.status >= 500 || (res.status === 400 && withThinking)) return { retry: err, tokens: NO_TOKENS };
      throw err;
    }
    json = (await res.json()) as GenerateResponse;
  } catch (e) {
    if (e instanceof VertexError) throw e;
    if (ac.signal.aborted) throw new VertexError('timeout', 'Vertex AI の応答が時間内に返りませんでした');
    throw new VertexError('network', 'Vertex AI に接続できませんでした');
  } finally {
    clearTimeout(timer);
  }
  const u = json.usageMetadata ?? {};
  const tokens: VertexTokens = { in: num(u.promptTokenCount), out: num(u.candidatesTokenCount), think: num(u.thoughtsTokenCount) };
  const cand = json.candidates?.[0];
  if (!cand) return { retry: new VertexError('blocked', `Vertex AI が出力を返しませんでした${json.promptFeedback?.blockReason ? `（${String(json.promptFeedback.blockReason).slice(0, 40)}）` : ''}`), tokens };
  const text = (cand.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? '').join('');
  let raw: unknown;
  try {
    raw = parseJsonText(text);
  } catch {
    return { retry: new VertexError('parse', `Vertex AI の出力を JSON として読めませんでした${cand.finishReason === 'MAX_TOKENS' ? '（出力が長すぎて途中で切れました）' : ''}`), tokens };
  }
  const parsed = r.schema.safeParse(raw);
  if (!parsed.success) return { retry: new VertexError('parse', `Vertex AI の出力が決まった形ではありませんでした（${parsed.error.issues[0]?.path.join('.') ?? ''}）`), tokens };
  return { data: parsed.data, tokens };
}

/** JSON を返させて zod で検証する。読めない・通らない（と 429 / 5xx）は 1 回だけやり直す */
export async function callVertexJson<T>(env: Env, r: VertexJsonRequest<T>): Promise<VertexJsonResult<T>> {
  const t0 = Date.now();
  const fetchImpl = r.fetchImpl ?? safeFetch;
  if (!vertexConfigured(env) || !validEngine(r.engine)) throw new VertexError('config', 'Vertex AI の設定がありません');
  let sa: ServiceAccountKey;
  try {
    sa = parseServiceAccountKey(saKeyRaw(env));
  } catch {
    throw new VertexError('config', 'Vertex AI の鍵を読めませんでした（Secret を 1 行の JSON で貼り直してください）');
  }
  let token: string;
  try {
    token = await accessToken(sa, fetchImpl);
  } catch (e) {
    if (e instanceof VertexError) throw e;
    throw new VertexError('auth', 'Vertex AI の認証に失敗しました');
  }
  let tokens = NO_TOKENS;
  let last: VertexError | null = null as VertexError | null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const withThinking: boolean = last?.status !== 400;
    const out: Awaited<ReturnType<typeof once<T>>> = await once(env, token, r, fetchImpl, withThinking);
    tokens = addTokens(tokens, out.tokens);
    if ('data' in out) return { data: out.data, tokens, ms: Date.now() - t0 };
    last = out.retry;
  }
  throw last ?? new VertexError('parse', 'Vertex AI の出力を読めませんでした');
}

/** responseSchema を書くための短い部品 */
export const S = {
  str: (description?: string) => ({ type: 'STRING', ...(description ? { description } : {}) }),
  arr: (items: Record<string, unknown>, opts: { min?: number; max?: number; description?: string } = {}) => ({ type: 'ARRAY', items, ...(opts.min !== undefined ? { minItems: opts.min } : {}), ...(opts.max !== undefined ? { maxItems: opts.max } : {}), ...(opts.description ? { description: opts.description } : {}) }),
  obj: (properties: Record<string, Record<string, unknown>>) => ({ type: 'OBJECT', properties, required: Object.keys(properties), propertyOrdering: Object.keys(properties) }),
};
