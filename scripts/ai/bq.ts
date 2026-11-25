/**
 * AI 機能のセッションが BigQuery を読むための入口（読むだけ。書き込みの口は作らない）。
 *   鍵の順: BQ_SA_KEY（1 行 JSON）→ BQ_SA_KEY_FILE（鍵ファイルのパス）→ BQ_ACCESSOR_KEY（アクセサー SA の鍵 JSON）から Secret Manager 経由。
 *   Secret Manager の経路は claude_analysis の 02_データエンジニアリング/scripts/fetch-bq-credentials.py と同じ（Node の crypto で JWT に署名する。pip に頼らない）。
 * 鍵・トークンは、メモリの中だけで使う（ファイル・標準出力・エラーメッセージに出さない）。
 */
import { spawnSync } from 'node:child_process';
import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { RestBqClient } from '../../src/worker/bq/client';

const SECRET_URL = 'https://secretmanager.googleapis.com/v1/projects/bq-hgt/secrets/bq-sa-key-for-claude/versions/latest:access';
const TOKEN_URI = 'https://oauth2.googleapis.com/token';
const b64url = (s: string | Buffer): string => Buffer.from(s).toString('base64url');

/**
 * Node の fetch は HTTPS_PROXY を自分では読まない（NODE_USE_ENV_PROXY=1 が要る）。
 * プロキシのある環境（Claude Code のセッション）では、その変数を付けて自分をもう一度起動する。
 * 各スクリプトの最初に呼ぶ。
 */
export function ensureProxyEnv(): void {
  const proxy = process.env.HTTPS_PROXY ?? process.env.https_proxy;
  if (!proxy || process.env.NODE_USE_ENV_PROXY) return;
  const r = spawnSync(process.execPath, [...process.execArgv, ...process.argv.slice(1)], { stdio: 'inherit', env: { ...process.env, NODE_USE_ENV_PROXY: '1', NODE_NO_WARNINGS: '1' } });
  process.exit(r.status ?? 1);
}

async function accessorToken(accessorKey: string): Promise<string> {
  let sa: { client_email?: string; private_key?: string; token_uri?: string };
  try {
    sa = JSON.parse(accessorKey);
  } catch {
    throw new Error('BQ_ACCESSOR_KEY が JSON として読めません');
  }
  if (!sa.client_email || !sa.private_key) throw new Error('BQ_ACCESSOR_KEY に client_email / private_key がありません');
  const now = Math.floor(Date.now() / 1000);
  const aud = sa.token_uri ?? TOKEN_URI;
  const input = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(
    JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/cloud-platform', aud, iat: now, exp: now + 600 }),
  )}`;
  const signer = createSign('RSA-SHA256');
  signer.update(input);
  const assertion = `${input}.${signer.sign(sa.private_key).toString('base64url')}`;
  const res = await fetch(aud, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
  });
  // 応答の本文は出さない（トークンが入りうる）
  if (!res.ok) throw new Error(`アクセサー SA のトークンが取れません（HTTP ${res.status}）`);
  const json = (await res.json()) as { access_token?: string };
  if (!json.access_token) throw new Error('アクセサー SA のトークンが取れません');
  return json.access_token;
}

/** BigQuery 用の SA 鍵（JSON の文字列）。返した値を出力・保存しないこと */
export async function loadSaKey(env: NodeJS.ProcessEnv = process.env): Promise<string> {
  if (env.BQ_SA_KEY) return env.BQ_SA_KEY;
  if (env.BQ_SA_KEY_FILE) return readFileSync(env.BQ_SA_KEY_FILE, 'utf8');
  if (!env.BQ_ACCESSOR_KEY) throw new Error('BigQuery の鍵がありません（BQ_SA_KEY / BQ_SA_KEY_FILE / BQ_ACCESSOR_KEY のどれかが要ります）');
  const token = await accessorToken(env.BQ_ACCESSOR_KEY);
  const res = await fetch(SECRET_URL, { headers: { authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Secret Manager から鍵が取れません（HTTP ${res.status}）`);
  const json = (await res.json()) as { payload?: { data?: string } };
  if (!json.payload?.data) throw new Error('Secret Manager の応答に鍵がありません');
  return Buffer.from(json.payload.data, 'base64').toString('utf8');
}

/** セッション用の BigQuery クライアント。上限は照会ごと（BuiltQuery.maxBytes）に渡す。既定の 200 MB は変えない */
export async function createBqClient(): Promise<RestBqClient> {
  const saKey = await loadSaKey();
  return new RestBqClient({
    saKey,
    project: process.env.BQ_PROJECT ?? 'bq-hgt',
    location: process.env.BQ_LOCATION ?? 'asia-northeast1',
    // messages を読む照会は 1〜2 分かかる（25 秒 × 24 回 = 10 分まで待つ）
    timeoutMs: 25000,
    maxPolls: 24,
    fetchImpl: (input, init) => globalThis.fetch(input, init),
  });
}
