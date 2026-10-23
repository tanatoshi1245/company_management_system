import { AppError } from './errors';

/**
 * サーバ側 fetch の宛先をホスト名の許可リストで固定する（SSRF 対策。セキュリティ要件 §2.2）。
 * 利用者入力の URL を fetch する機能は無い。BigQuery と Google ログイン以外には出ていかない。
 */
export const ALLOWED_HOSTS: ReadonlySet<string> = new Set(['bigquery.googleapis.com', 'oauth2.googleapis.com', 'www.googleapis.com', 'accounts.google.com']);

export function assertAllowedUrl(input: RequestInfo | URL): URL {
  const u = new URL(typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url);
  if (u.protocol !== 'https:' || !ALLOWED_HOSTS.has(u.hostname)) {
    throw new AppError('ssrfBlocked', 500, '外部への接続先が許可リストにありません');
  }
  return u;
}

/** グローバル fetch を正しい this（globalThis）で呼ぶ。Workers では別オブジェクトに束縛すると Illegal invocation になる */
export const safeFetch: typeof fetch = (input, init) => {
  assertAllowedUrl(input);
  return globalThis.fetch(input, init);
};
