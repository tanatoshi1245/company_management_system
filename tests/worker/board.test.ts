import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { installFakeCache, uninstallFakeCache } from '../helpers/fakeCache';
import app from '../../src/worker/index';
import { baseEnv, ctx } from '../helpers/env';
import { BoardResponseSchema } from '../../src/shared/schema/board';
import { addMonths, monthOf, todayJst } from '../../src/shared/calendar/periods';
import { makeContext, scoreCompany } from '../../src/shared/metrics/score';
import { filterCompanies, isContracted, isNoLogin, kpiStrip, ownerKey, sortCompanies, DEFAULT_FILTERS } from '../../src/shared/metrics/board';
import { companyMasterQuery } from '../../src/worker/sql/companyMaster';

const get = (q = '', env = baseEnv) => app.fetch(new Request(`http://x/api/board${q}`), env, ctx);

describe('/api/board（モック）', () => {
  beforeAll(() => installFakeCache());
  afterAll(() => uninstallFakeCache());

  it('当月のボード: 企業・ベンチマーク・営業日を返し、形が合う。2 回目はキャッシュヒット', async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get('x-cache')).toBe('MISS');
    const text = await res.text();
    const body = BoardResponseSchema.parse(JSON.parse(text));
    expect(body.meta.month).toBe(monthOf(todayJst()));
    expect(body.meta.isCurrentMonth).toBe(true);
    expect(body.meta.months).toHaveLength(14);
    expect(body.meta.bizDays.total).toBeGreaterThan(15);
    expect(body.companies.length).toBeGreaterThanOrEqual(30);
    expect(body.companies.length).toBeLessThanOrEqual(40);
    expect(body.benchmarks.length).toBeGreaterThan(20);
    expect(body.benchmarks.some((b) => b.industry === '__ALL__' && b.companyType === '__ALL__' && b.metric === 'scout_utilization')).toBe(true);
    for (const c of body.companies) {
      expect(c.trend.sent).toHaveLength(14);
      expect(['active', 'ending_30d', 'upcoming', 'ended_recent', 'ended']).toContain(c.state);
      expect(c.targets).toBeNull(); // D1 未接続
    }
    // 40 社で 150 KB 未満（600 社で ≈ 2 MB 未満の目安。gzip で 1/5 程度）
    expect(text.length).toBeLessThan(150_000);
    const again = await get();
    expect(again.headers.get('x-cache')).toBe('HIT');
    expect((await again.json() as { meta: { cached: boolean } }).meta.cached).toBe(true);
  });

  it('担当=自分: ログイン者（DEV_USER_EMAIL）が担当の企業に isMine が付く', async () => {
    const body = BoardResponseSchema.parse(await (await get('', { ...baseEnv, DEV_USER_EMAIL: 'preview@daijob.com' })).json());
    const mine = body.companies.filter((c) => c.isMine);
    expect(mine.length).toBeGreaterThan(0);
    for (const c of mine) expect(c.owner.email).toBe('preview@daijob.com');
    const other = BoardResponseSchema.parse(await (await get('', { ...baseEnv, DEV_USER_EMAIL: 'nobody@daijob.com' })).json());
    expect(other.companies.some((c) => c.isMine)).toBe(false);
  });

  it('過去月は営業日消化率 1、範囲外・形式違いは 400', async () => {
    const prev = addMonths(monthOf(todayJst()), -1);
    const body = BoardResponseSchema.parse(await (await get(`?month=${prev}`)).json());
    expect(body.meta.month).toBe(prev);
    expect(body.meta.isCurrentMonth).toBe(false);
    expect(body.meta.bizDays.rate).toBe(1);
    for (const q of ['?month=2026/10', '?month=2020-01', `?month=${addMonths(monthOf(todayJst()), 1)}`]) {
      const bad = await get(q);
      expect(bad.status, q).toBe(400);
      expect(await bad.json()).toMatchObject({ code: 'badRequest' });
    }
  });

  it('共用の metrics でスコア・ヘルス・絞り込み・並べ替え・KPI が計算できる', async () => {
    const body = BoardResponseSchema.parse(await (await get('', { ...baseEnv, DEV_USER_EMAIL: 'preview@daijob.com' })).json());
    const ctx = makeContext(body.benchmarks, body.meta.benchMinN, body.meta.bizDays.rate, body.meta.bizDays.elapsed, body.meta.isCurrentMonth);
    const scored = body.companies.map((c) => scoreCompany(c, ctx));
    expect(scored.some((s) => s.pace.status === 'behind')).toBe(true);
    expect(scored.some((s) => s.bench.scout_utilization?.score !== null)).toBe(true);
    expect(scored.every((s) => s.health.target.level === 'none')).toBe(true); // 目標なし
    // 契約中の企業だけ（終了済み・開始前・直近終了は出ない）
    const all = filterCompanies(scored, DEFAULT_FILTERS, body.meta);
    expect(all.length).toBeLessThan(scored.length);
    expect(all.every((s) => s.c.state === 'active' || s.c.state === 'ending_30d')).toBe(true);
    expect(scored.some((s) => s.c.state === 'ended_recent' || s.c.state === 'upcoming')).toBe(true);
    const mine = filterCompanies(scored, { ...DEFAULT_FILTERS, mine: true }, body.meta);
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.length).toBeLessThan(all.length);
    const byPace = sortCompanies(scored, 'pace');
    const ratios = byPace.map((s) => s.pace.ratio).filter((r): r is number => r !== null);
    for (let i = 1; i < ratios.length; i++) expect(ratios[i]).toBeGreaterThanOrEqual(ratios[i - 1]);
    const tiles = kpiStrip(all, body.meta);
    expect(tiles.map((t) => t.key)).toEqual(['contracted', 'active', 'scoutUsers', 'scoutUtil']);
    const active = tiles.find((t) => t.key === 'active')!;
    expect(active.value).toBe(all.filter((s) => isContracted(s.c, body.meta) && s.c.login.daysSince !== null && s.c.login.daysSince < 30).length);
    expect(tiles[1].label).toBe('アクティブ企業数（最終ログイン30日以内）');
    // 契約終了: 30 日以内 / 90 日以上先（無期限を含む）
    const soon = filterCompanies(scored, { ...DEFAULT_FILTERS, ending: '30' }, body.meta);
    expect(soon.every((s) => s.c.contract.daysToEnd !== null && s.c.contract.daysToEnd <= 30)).toBe(true);
    const far = filterCompanies(scored, { ...DEFAULT_FILTERS, ending: 'over90' }, body.meta);
    expect(far.length).toBeGreaterThan(0);
    expect(far.every((s) => s.c.contract.daysToEnd === null || s.c.contract.daysToEnd > 90)).toBe(true);
    expect(soon.length + far.length).toBeLessThanOrEqual(all.length);
    expect(tiles[0].value).toBe(all.length);
    expect(tiles[0].value).toBeGreaterThan(20);
    // 30 日以上ログインなし（記録なしを含む）はセルの赤強調の判定にだけ使う
    expect(all.some((s) => s.c.login.daysSince !== null && s.c.login.daysSince >= 14 && s.c.login.daysSince < 30 && !isNoLogin(s.c))).toBe(true);
    // スカウト消化率 = Σ送信 ÷ Σ枠（枠のある契約企業）、利用率 = 1 件以上送信 ÷ 契約中
    const contracted = all.filter((s) => isContracted(s.c, body.meta));
    const withLimit = contracted.filter((s) => s.c.limits.scout);
    expect(tiles[3].value).toBeCloseTo(withLimit.reduce((a, s) => a + s.c.m.sent, 0) / withLimit.reduce((a, s) => a + (s.c.limits.scout ?? 0), 0), 6);
    expect(tiles[2].value).toBe(contracted.filter((s) => s.c.m.sent > 0).length);
    expect(tiles[2].rate).toBeCloseTo(contracted.filter((s) => s.c.m.sent > 0).length / contracted.length, 6);
    expect(tiles[2].label).toBe('スカウト利用社数（利用率）');
    // CS 担当で絞り込み
    const key = ownerKey(scored.find((s) => s.c.owner.email)!.c);
    const byOwner = filterCompanies(scored, { ...DEFAULT_FILTERS, owner: [key] }, body.meta);
    expect(byOwner.length).toBeGreaterThan(0);
    expect(byOwner.every((s) => ownerKey(s.c) === key)).toBe(true);
    // 実数の列で並べ替え
    const byApps = sortCompanies(scored, '-apps');
    for (let i = 1; i < byApps.length; i++) expect(byApps[i].c.m.apps).toBeLessThanOrEqual(byApps[i - 1].c.m.apps);
    expect(scored.some((s) => s.c.type === '派遣')).toBe(true);
    // NW（Network 契約）はボードに出さない（モックには NW の企業があるが応答に含めない）
    expect(scored.some((s) => s.c.type === 'NW')).toBe(false);
    expect(companyMasterQuery().sql).toContain("WHERE company_type != 'NW'");
    const q = filterCompanies(scored, { ...DEFAULT_FILTERS, q: 'ｱｰｸ' }, body.meta);
    const byType = sortCompanies(all, 'type');
    for (let i = 1; i < byType.length; i++) expect(byType[i].c.type.localeCompare(byType[i - 1].c.type, 'ja')).toBeGreaterThanOrEqual(0);
    expect(q.length).toBeGreaterThan(0);
  });
});
