import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { RestBqClient } from '../../src/worker/bq/client';
import { _resetAuthCache } from '../../src/worker/bq/auth';

/** テスト用に RSA 鍵を生成し、サービスアカウント鍵 JSON の形にする */
async function makeSaKeyJson(): Promise<string> {
  const pair = (await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true,
    ['sign', 'verify'],
  )) as CryptoKeyPair;
  const der = await crypto.subtle.exportKey('pkcs8', pair.privateKey);
  const b64 = Buffer.from(der).toString('base64').replace(/(.{64})/g, '$1\n');
  const pem = `-----BEGIN PRIVATE KEY-----\n${b64}\n-----END PRIVATE KEY-----\n`;
  return JSON.stringify({ type: 'service_account', client_email: 'test@example.iam.gserviceaccount.com', private_key: pem });
}

/**
 * Cloudflare Workers のグローバル fetch を模した関数。
 * Workers では `obj.fetch(...)` のように this が別オブジェクトに束縛された状態で呼ぶと
 * "Illegal invocation" (TypeError) になるため、同じ挙動を再現する。
 */
function workersLikeFetch(this: unknown, input: RequestInfo | URL, _init?: RequestInit): Promise<Response> {
  if (this !== undefined && this !== globalThis) {
    throw new TypeError('Illegal invocation: function called with incorrect `this` reference.');
  }
  const url = String(input);
  if (url.includes('oauth2.googleapis.com')) {
    return Promise.resolve(Response.json({ access_token: 'token', expires_in: 3600 }));
  }
  return Promise.resolve(
    Response.json({
      jobComplete: true,
      jobReference: { jobId: 'job-1', location: 'asia-northeast1' },
      schema: { fields: [{ name: 'n', type: 'INTEGER' }] },
      rows: [{ f: [{ v: '1' }] }],
      totalBytesProcessed: '0',
    }),
  );
}

describe('RestBqClient と Workers の fetch', () => {
  const origFetch = globalThis.fetch;
  beforeEach(() => {
    _resetAuthCache();
    globalThis.fetch = workersLikeFetch as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = origFetch;
    _resetAuthCache();
  });

  it('fetchImpl 未指定でもグローバル fetch を正しい this で呼べる（Illegal invocation にならない）', async () => {
    const client = new RestBqClient({ project: 'p', location: 'asia-northeast1', saKey: await makeSaKeyJson() });
    const r = await client.run({ sql: 'SELECT 1 AS n', params: [], label: 'test' });
    expect(r.rows).toEqual([{ n: 1 }]);
    expect(r.jobId).toBe('job-1');
  });
});
