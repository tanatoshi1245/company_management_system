import { describe, expect, it } from 'vitest';
import { assertAllowedUrl, safeFetch } from '../../src/worker/lib/safeFetch';
import { cacheKey, canonicalJson } from '../../src/worker/lib/cache';
import { martTtlSec, secondsUntilJst } from '../../src/worker/services/refreshMeta';
import { createFakeD1 } from '../helpers/fakeD1';
import { AppMetaRepo } from '../../src/worker/d1/appMetaRepo';

describe('safeFetch（SSRF 対策）', () => {
  it('許可ホスト以外・http は投げる', () => {
    expect(assertAllowedUrl('https://bigquery.googleapis.com/bigquery/v2/x').hostname).toBe('bigquery.googleapis.com');
    expect(() => assertAllowedUrl('https://evil.example/')).toThrow();
    expect(() => assertAllowedUrl('http://bigquery.googleapis.com/')).toThrow();
    expect(() => assertAllowedUrl('https://169.254.169.254/latest/meta-data')).toThrow();
    expect(() => assertAllowedUrl(new URL('https://oauth2.googleapis.com/token'))).not.toThrow();
    expect(() => safeFetch('https://evil.example/')).toThrow();
  });
});

describe('キャッシュキー', () => {
  it('キーの順序に依らず同じ', async () => {
    expect(canonicalJson({ b: 1, a: [1, { d: 2, c: 3 }] })).toBe('{"a":[1,{"c":3,"d":2}],"b":1}');
    const a = await cacheKey('x', { m: '2026-10', v: 1 });
    const b = await cacheKey('x', { v: 1, m: '2026-10' });
    expect(a.url).toBe(b.url);
    expect((await cacheKey('y', { m: '2026-10', v: 1 })).url).not.toBe(a.url);
  });
});

describe('マート応答の TTL', () => {
  it('次の 08:30 JST までの秒数', () => {
    // 2026-10-23 07:00 JST = 2026-10-22T22:00Z → 90 分
    expect(secondsUntilJst(new Date('2026-10-22T22:00:00Z'), 8, 30)).toBe(90 * 60);
    // 2026-10-23 09:00 JST → 翌日 08:30 = 23.5 時間
    expect(secondsUntilJst(new Date('2026-10-23T00:00:00Z'), 8, 30)).toBe(23.5 * 3600);
  });
  it('当日の更新が成功していれば次の 08:30 まで、そうでなければ 300 秒。上限で切れる', () => {
    const now = new Date('2026-10-22T22:00:00Z');
    expect(martTtlSec({ dataVersion: '2026-10-23', dataDate: '2026-10-22', refreshedAt: null, refreshStatus: 'ok', lastError: null }, now)).toBe(5400);
    expect(martTtlSec({ dataVersion: '2026-10-22', dataDate: '2026-10-21', refreshedAt: null, refreshStatus: 'ok', lastError: null }, now)).toBe(300);
    expect(martTtlSec({ dataVersion: '2026-10-23', dataDate: '2026-10-22', refreshedAt: null, refreshStatus: 'error', lastError: 'x' }, now)).toBe(300);
    expect(martTtlSec({ dataVersion: '2026-10-23', dataDate: '2026-10-22', refreshedAt: null, refreshStatus: 'ok', lastError: null }, now, 3600)).toBe(3600);
  });
});

describe('D1（node:sqlite の代替）と app_meta', () => {
  it('migrations が適用され、cache_epoch を +1 できる', async () => {
    const db = createFakeD1();
    const repo = new AppMetaRepo(db);
    expect(await repo.cacheEpoch()).toBe('1');
    expect(await repo.bumpCacheEpoch('a@daijob.com', '2026-10-23T00:00:00Z')).toBe('2');
    expect(await repo.cacheEpoch()).toBe('2');
    const tables = (await db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all<{ name: string }>()).results.map((r) => r.name);
    expect(tables).toEqual(expect.arrayContaining(['company_targets', 'company_settings', 'audit_log', 'app_meta', 'plan_target_defaults']));
  });
});
