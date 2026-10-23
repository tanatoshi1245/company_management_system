// 複製元: sales_dashboard_IS-FS_ver2 の src/worker/google.ts。変更点: Cookie 名を cms_session / cms_oauth に、Google への fetch を safeFetch（許可ホストのみ）に。
import { audiences, b64urlEncode, checkTime, JwtError, verifyRs256Jwt } from './jwt';
import { safeFetch } from '../lib/safeFetch';

/**
 * Worker 内蔵の Google ログイン（OpenID Connect の認可コードフロー + PKCE）。Cloudflare Zero Trust を使わずに
 * 「会社の Google アカウント（@daijob.com）の人だけ」を Worker 側で確かめる。
 *
 *   /auth/login    → state と PKCE の verifier を署名付き Cookie に入れ、Google の認可画面へリダイレクト
 *   /auth/callback → state を照合 → 認可コードをトークンに交換 → ID トークン（RS256）を Google の公開鍵で検証
 *                    → メール（email_verified）を許可リスト（ALLOWED_EMAIL_DOMAINS / ALLOWED_EMAILS）で確認
 *                    → 署名付きのセッション Cookie を発行して元のページへ
 *   /auth/logout   → セッション Cookie を消す
 *
 * セッション = HMAC-SHA256 で署名した JSON（email / sub / name / exp）。Secret SESSION_SECRET で署名し、改ざん・期限切れは拒否する。
 * Cookie は HttpOnly / SameSite=Lax / Secure（https のとき）。
 */
export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const GOOGLE_JWKS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

export const SESSION_COOKIE = 'cms_session';
export const STATE_COOKIE = 'cms_oauth';
/** 認可画面に行って戻るまでの猶予 */
export const STATE_TTL_SEC = 10 * 60;
/** セッションの既定の長さ（7 日） */
export const DEFAULT_SESSION_TTL_SEC = 7 * 24 * 3600;

export interface GoogleConfig {
  clientId: string;
  clientSecret: string;
  sessionSecret: string;
  sessionTtlSec: number;
}

export interface SessionPayload {
  kind: 'session';
  email: string;
  sub: string;
  name?: string;
  iat: number;
  exp: number;
}

export interface StatePayload {
  kind: 'state';
  state: string;
  verifier: string;
  /** ログイン後に戻る同一オリジンのパス */
  returnTo: string;
  exp: number;
}

export interface GoogleIdentity {
  email: string;
  sub: string;
  name?: string;
  /** Google Workspace のドメイン（個人アカウントは無い） */
  hd?: string;
}

// ---- 乱数・PKCE --------------------------------------------------------------------------

export function randomToken(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return b64urlEncode(buf);
}

export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return b64urlEncode(digest);
}

// ---- 署名付きの値（セッション / state） -------------------------------------------------

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

/** JSON を base64url にして HMAC-SHA256 の署名を付ける: `<payload>.<sig>` */
export async function signPayload(payload: object, secret: string): Promise<string> {
  const body = b64urlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const sig = await crypto.subtle.sign('HMAC', await hmacKey(secret), new TextEncoder().encode(body));
  return `${body}.${b64urlEncode(sig)}`;
}

/** 署名を検証して payload を返す。壊れている・改ざん・期限切れは null */
export async function verifyPayload<T extends { exp: number; kind: string }>(token: string | null | undefined, secret: string, kind: T['kind'], nowSec: number = Math.floor(Date.now() / 1000)): Promise<T | null> {
  if (!token) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  try {
    const ok = await crypto.subtle.verify('HMAC', await hmacKey(secret), b64urlDecodeBytes(sig), new TextEncoder().encode(body));
    if (!ok) return null;
    const payload = JSON.parse(new TextDecoder().decode(b64urlDecodeBytes(body))) as T;
    if (payload.kind !== kind) return null;
    if (typeof payload.exp !== 'number' || payload.exp <= nowSec) return null;
    return payload;
  } catch {
    return null;
  }
}

function b64urlDecodeBytes(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ---- Cookie ----------------------------------------------------------------------------------

export function parseCookies(header: string | null | undefined): Map<string, string> {
  const out = new Map<string, string>();
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i === -1) continue;
    const k = part.slice(0, i).trim();
    if (k) out.set(k, part.slice(i + 1).trim());
  }
  return out;
}

export function serializeCookie(name: string, value: string, opts: { maxAgeSec: number; secure: boolean }): string {
  const attrs = [`${name}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${Math.max(0, Math.floor(opts.maxAgeSec))}`];
  if (opts.secure) attrs.push('Secure');
  return attrs.join('; ');
}

// ---- Google とのやりとり ---------------------------------------------------------------------

/** 認可画面の URL。許可ドメインのヒント（hd）は付けない（未ログインでも見える URL に会社のドメインを出さない） */
export function buildAuthUrl(args: { clientId: string; redirectUri: string; state: string; codeChallenge: string }): string {
  const u = new URL(GOOGLE_AUTH_URL);
  u.searchParams.set('client_id', args.clientId);
  u.searchParams.set('redirect_uri', args.redirectUri);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', 'openid email profile');
  u.searchParams.set('state', args.state);
  u.searchParams.set('code_challenge', args.codeChallenge);
  u.searchParams.set('code_challenge_method', 'S256');
  u.searchParams.set('prompt', 'select_account');
  return u.toString();
}

/** 認可コードを ID トークンに交換する */
export async function exchangeCode(args: { code: string; redirectUri: string; codeVerifier: string; clientId: string; clientSecret: string; fetchImpl?: typeof fetch }): Promise<string> {
  const fetchImpl = args.fetchImpl ?? safeFetch;
  const body = new URLSearchParams({ code: args.code, client_id: args.clientId, client_secret: args.clientSecret, redirect_uri: args.redirectUri, grant_type: 'authorization_code', code_verifier: args.codeVerifier });
  const res = await fetchImpl(GOOGLE_TOKEN_URL, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: body.toString() });
  const json = (await res.json().catch(() => ({}))) as { id_token?: string; error?: string; error_description?: string };
  if (!res.ok || !json.id_token) throw new JwtError(`Google のトークン交換に失敗しました: ${json.error ?? res.status}${json.error_description ? ` (${json.error_description})` : ''}`, 'tokenExchange');
  return json.id_token;
}

/** Google の ID トークンを検証する（署名・iss・aud・exp・email_verified） */
export async function verifyGoogleIdToken(idToken: string, clientId: string, opts: { fetchImpl?: typeof fetch; nowSec?: number } = {}): Promise<GoogleIdentity> {
  const now = opts.nowSec ?? Math.floor(Date.now() / 1000);
  const { payload } = await verifyRs256Jwt(idToken, GOOGLE_JWKS_URL, opts.fetchImpl ?? safeFetch);
  if (!GOOGLE_ISSUERS.includes(String(payload.iss))) throw new JwtError('ID トークンの発行者が Google ではありません', 'iss');
  if (!audiences(payload).includes(clientId)) throw new JwtError('ID トークンの対象 (aud) がこのアプリではありません', 'aud');
  checkTime(payload, now);
  if (!payload.email || payload.email_verified !== true) throw new JwtError('Google がメールアドレスを確認していないアカウントです', 'email');
  return { email: String(payload.email).toLowerCase(), sub: String(payload.sub ?? ''), name: typeof payload.name === 'string' ? payload.name : undefined, hd: typeof payload.hd === 'string' ? payload.hd : undefined };
}

/** ログイン後に戻る先。同一オリジンのパスだけ許す（`//evil` や `https://…` は `/` に落とす） */
export function safeReturnPath(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\') || raw.startsWith('/auth/')) return '/';
  return raw;
}
