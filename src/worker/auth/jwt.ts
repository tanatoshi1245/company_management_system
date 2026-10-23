// 複製元: sales_dashboard_IS-FS_ver2（営業行動モニタリング）の同名ファイル。変更なし。
/**
 * RS256 の JWT を JWKS（公開鍵の一覧 URL）で検証する共通部品。
 * Cloudflare Access の JWT（access.ts）と Google の ID トークン（google.ts）の両方で使う。
 * 公開鍵は URL ごとに 1 時間キャッシュし、未知の kid（鍵ローテーション直後）は 1 回だけ取り直す。
 */
export class JwtError extends Error {
  constructor(
    message: string,
    public readonly reason: string,
  ) {
    super(message);
  }
}

interface Jwk {
  kid: string;
  kty: string;
  alg?: string;
  n: string;
  e: string;
  use?: string;
}

const JWKS_TTL_MS = 60 * 60 * 1000;
const jwksCache = new Map<string, { keys: Map<string, CryptoKey>; fetchedAt: number }>();

export function b64urlDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function b64urlEncode(bytes: Uint8Array | ArrayBuffer): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = '';
  for (const b of u8) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function decodeJson<T>(part: string): T {
  return JSON.parse(new TextDecoder().decode(b64urlDecode(part))) as T;
}

async function loadKeys(jwksUrl: string, fetchImpl: typeof fetch, force = false): Promise<Map<string, CryptoKey>> {
  const now = Date.now();
  const cached = jwksCache.get(jwksUrl);
  if (!force && cached && now - cached.fetchedAt < JWKS_TTL_MS) return cached.keys;
  const res = await fetchImpl(jwksUrl);
  if (!res.ok) throw new JwtError(`公開鍵の取得に失敗しました (${res.status})`, 'jwksFetch');
  const json = (await res.json()) as { keys?: Jwk[] };
  const keys = new Map<string, CryptoKey>();
  for (const k of json.keys ?? []) {
    if (k.kty !== 'RSA') continue;
    const key = await crypto.subtle.importKey('jwk', { kty: 'RSA', n: k.n, e: k.e, alg: 'RS256', ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    keys.set(k.kid, key);
  }
  jwksCache.set(jwksUrl, { keys, fetchedAt: now });
  return keys;
}

export interface JwtClaims {
  iss?: string;
  aud?: string | string[];
  exp?: number;
  nbf?: number;
  iat?: number;
  sub?: string;
  email?: string;
  [k: string]: unknown;
}

/** 署名（RS256・JWKS の鍵）だけを検証して header と payload を返す。iss / aud / exp は呼び出し側で確かめる */
export async function verifyRs256Jwt(token: string, jwksUrl: string, fetchImpl: typeof fetch = fetch.bind(globalThis)): Promise<{ header: { alg?: string; kid?: string }; payload: JwtClaims }> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new JwtError('JWT の形式が不正です', 'malformed');
  let header: { alg?: string; kid?: string };
  let payload: JwtClaims;
  try {
    header = decodeJson(parts[0]);
    payload = decodeJson(parts[1]);
  } catch {
    throw new JwtError('JWT の形式が不正です', 'malformed');
  }
  if (header.alg !== 'RS256' || !header.kid) throw new JwtError('JWT のアルゴリズムが未対応です', 'alg');
  let keys = await loadKeys(jwksUrl, fetchImpl);
  let key = keys.get(header.kid);
  if (!key) {
    keys = await loadKeys(jwksUrl, fetchImpl, true);
    key = keys.get(header.kid);
  }
  if (!key) throw new JwtError('JWT の署名鍵が見つかりません', 'kid');
  const data = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlDecode(parts[2]), data);
  if (!ok) throw new JwtError('JWT の署名が一致しません', 'signature');
  return { header, payload };
}

/** exp / nbf の確認（exp は必須） */
export function checkTime(payload: JwtClaims, nowSec: number): void {
  if (typeof payload.exp !== 'number' || payload.exp <= nowSec) throw new JwtError('JWT の有効期限が切れています', 'exp');
  if (typeof payload.nbf === 'number' && payload.nbf > nowSec + 60) throw new JwtError('JWT がまだ有効になっていません', 'nbf');
}

export function audiences(payload: JwtClaims): string[] {
  return Array.isArray(payload.aud) ? payload.aud : payload.aud ? [payload.aud] : [];
}

/** テスト用 */
export function _resetJwksCache(): void {
  jwksCache.clear();
}
