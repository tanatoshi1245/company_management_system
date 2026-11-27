import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import app from '../../src/worker/index';
import { aiEnabled } from '../../src/worker/ai/enabled';
import { callVertexJson } from '../../src/worker/ai/vertex';
import { aiOffEnv, baseEnv, ctx, googleEnv } from '../helpers/env';
import { jsonHeaders, sessionCookie } from '../helpers/login';
import { z } from 'zod';

/**
 * AI 機能の停止スイッチ（2026-11-27 ユーザー指示。内容の確認が済むまで止める）。
 * 既定は停止で、止まっている間は、AI の API・Vertex AI・cron・メニューのどれも動かないこと。
 */
describe('AI 機能の停止スイッチ', () => {
  afterEach(() => vi.restoreAllMocks());

  it('既定は停止（AI_ENABLED = "1" のときだけ動く）', () => {
    expect(aiEnabled({})).toBe(false);
    expect(aiEnabled({ AI_ENABLED: '0' })).toBe(false);
    expect(aiEnabled({ AI_ENABLED: 'true' })).toBe(false);
    expect(aiEnabled({ AI_ENABLED: '1' })).toBe(true);
  });

  it('設定ファイルは、本番・プレビューで停止。テスト環境だけ動かす（会員 ID から作る機能は、どこでも閉じる）。cron は無い', () => {
    const raw = readFileSync(join(process.cwd(), 'wrangler.jsonc'), 'utf8').replace(/^\s*\/\/.*$/gm, '');
    const cfg = JSON.parse(raw) as { vars: Record<string, string>; triggers?: unknown; previews: { vars: Record<string, string> }; env: { staging: { vars: Record<string, string>; triggers?: unknown } } };
    expect(cfg.vars.AI_ENABLED).toBe('0');
    expect(cfg.previews.vars.AI_ENABLED).toBe('0');
    // 2026-11-27 ユーザー指示: 求人 ID からの作成を、テスト環境へ反映（本番は、確認が済むまで停止）
    expect(cfg.env.staging.vars.AI_ENABLED).toBe('1');
    for (const v of [cfg.vars, cfg.previews.vars, cfg.env.staging.vars]) expect(v.AI_SCOUT_MEMBER).toBe('0');
    expect(cfg.triggers).toBeUndefined();
    expect(cfg.env.staging.triggers).toBeUndefined();
  });

  it('停止中は、AI の API がすべて 503（aiDisabled）で、外へ何も出ていかない', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      throw new Error('外へ出てはいけない');
    });
    const cookie = await sessionCookie();
    const env = { ...googleEnv, AI_ENABLED: undefined, BQ_MOCK: '1' };
    const req = (method: string, path: string, body?: unknown) =>
      app.request(`https://cms.example${path}`, { method, headers: jsonHeaders({ cookie, origin: 'https://cms.example' }), body: body === undefined ? undefined : JSON.stringify(body) }, env, ctx);
    const paths: [string, string, unknown?][] = [
      ['GET', '/api/ai/config'],
      ['GET', '/api/ai/companies'],
      ['GET', '/api/ai/companies/1001/defaults'],
      ['GET', '/api/ai/scout/options'],
      ['GET', '/api/ai/scout/models'],
      ['GET', '/api/ai/scout/members/20001'],
      ['GET', '/api/companies/1001/ai/scout/jobs/1001'],
      ['GET', '/api/ai/jobs?company=1001&kind=scout'],
      ['POST', '/api/companies/1001/ai/jobs', { kind: 'scout', input: { purpose: 'template', basis: 'conditions', industry: 'IT', positionName: '営業' } }],
      ['POST', '/api/ai/scout/tune', {}],
    ];
    for (const [method, path, body] of paths) {
      const res = await req(method, path, body);
      expect(res.status, `${method} ${path}`).toBe(503);
      expect(((await res.json()) as { code: string }).code).toBe('aiDisabled');
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('停止中は、Vertex AI の呼び出しそのものが入口で止まる（二重の歯止め）', async () => {
    const fetchImpl = vi.fn();
    await expect(callVertexJson(aiOffEnv, { engine: 'eng-a', system: 's', user: 'u', schema: z.object({}), responseSchema: {}, maxOutputTokens: 10, temperature: 0, fetchImpl: fetchImpl as unknown as typeof fetch })).rejects.toThrow(/停止/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('停止中は、cron が何もしない。/api/meta の ai が false（左のレールに AI メニューを出さない）', async () => {
    const waitUntil = vi.fn();
    (app as unknown as { scheduled: (c: unknown, e: unknown, x: unknown) => void }).scheduled({}, aiOffEnv, { waitUntil });
    expect(waitUntil).not.toHaveBeenCalled();
    const off = (await (await app.request('https://cms.example/api/meta', {}, aiOffEnv, ctx)).json()) as { ai: boolean };
    expect(off.ai).toBe(false);
    const on = (await (await app.request('https://cms.example/api/meta', {}, baseEnv, ctx)).json()) as { ai: boolean };
    expect(on.ai).toBe(true);
  });
});
