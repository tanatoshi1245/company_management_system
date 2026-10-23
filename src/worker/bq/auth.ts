// 複製元: sales_dashboard_IS-FS_ver2（営業行動モニタリング）の同名ファイル。変更なし。
/**
 * サービスアカウント鍵（JSON）から RS256 署名の JWT を作り OAuth アクセストークンを得る。
 * 02_データエンジニアリング/scripts/gcp_helper.py の get_access_token を WebCrypto に移植。
 */
export interface ServiceAccountKey {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

const SCOPE = 'https://www.googleapis.com/auth/bigquery';
const TOKEN_URI = 'https://oauth2.googleapis.com/token';

let cachedKey: { email: string; key: CryptoKey } | null = null;
let cachedToken: { token: string; expiresAt: number } | null = null;
let inflight: Promise<string> | null = null;

function b64url(input: ArrayBuffer | string): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : new Uint8Array(input);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function pemToDer(pem: string): ArrayBuffer {
  const body = pem
    .replace(/-----BEGIN [A-Z ]+-----/g, '')
    .replace(/-----END [A-Z ]+-----/g, '')
    .replace(/\s+/g, '');
  const bin = atob(body);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

async function importKey(sa: ServiceAccountKey): Promise<CryptoKey> {
  if (cachedKey && cachedKey.email === sa.client_email) return cachedKey.key;
  if (!sa.private_key.includes('BEGIN PRIVATE KEY')) {
    throw new Error('BQ_SA_KEY の private_key は PKCS#8 (BEGIN PRIVATE KEY) 形式である必要があります');
  }
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemToDer(sa.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  cachedKey = { email: sa.client_email, key };
  return key;
}

export function parseServiceAccountKey(raw: string): ServiceAccountKey {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('BQ_SA_KEY が JSON として解釈できません');
  }
  const sa = parsed as Partial<ServiceAccountKey>;
  if (!sa.client_email || !sa.private_key) throw new Error('BQ_SA_KEY に client_email / private_key がありません');
  return sa as ServiceAccountKey;
}

export async function getAccessToken(sa: ServiceAccountKey, fetchImpl: typeof fetch = fetch): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.expiresAt - 300 > now) return cachedToken.token;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const key = await importKey(sa);
      const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
      const claims = b64url(
        JSON.stringify({ iss: sa.client_email, scope: SCOPE, aud: sa.token_uri ?? TOKEN_URI, iat: now, exp: now + 3600 }),
      );
      const signingInput = `${header}.${claims}`;
      const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(signingInput));
      const assertion = `${signingInput}.${b64url(sig)}`;
      const body = new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion });
      const res = await fetchImpl(sa.token_uri ?? TOKEN_URI, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
      });
      if (!res.ok) throw new Error(`OAuth token 取得失敗: ${res.status} ${await res.text()}`);
      const json = (await res.json()) as { access_token: string; expires_in: number };
      cachedToken = { token: json.access_token, expiresAt: now + (json.expires_in ?? 3600) };
      return cachedToken.token;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** テスト用 */
export function _resetAuthCache(): void {
  cachedKey = null;
  cachedToken = null;
  inflight = null;
}
