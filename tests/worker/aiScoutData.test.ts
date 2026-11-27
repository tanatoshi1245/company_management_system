import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { baseEnv } from '../helpers/env';
import { EMPTY_SCOUT_FILTERS, SCOUT_FILTER_KEYS, SCOUT_MIN_SENDS, SCOUT_MIN_TEMPLATES, SCOUT_RATE_THRESHOLD, SCOUT_TOP_TEMPLATES, SCOUT_WINDOW_MONTHS, ScoutBasisSchema, ScoutOptionsResponseSchema, ScoutStatsSchema, type ScoutFilters } from '../../src/shared/ai/scout';
import { INDUSTRY_GROUPS, industryGroupOf } from '../../src/shared/ai/industryGroups';
import { DIGEST_BODY_CHARS, DIGEST_MAX } from '../../src/worker/ai/scout/dataSource';
import { makeScoutDataSource, normalizeFilters, scopeLabelOf, scoutCacheKey, scoutDataSourceOf, toBenchmark } from '../../src/worker/ai/scout/bqDataSource';
import { aiScoutBenchmarkQuery, aiScoutDraftsMergeQuery, aiScoutOptionsQuery, aiScoutOutcomesQuery, EXPORT_MAX_ROWS, SCOUT_FEATURES } from '../../src/worker/sql/aiScout';
import type { BqClient } from '../../src/worker/bq/client';
import type { BuiltQuery } from '../../src/worker/bq/params';
import { BqError } from '../../src/worker/bq/client';

const filters = (f: Partial<ScoutFilters> = {}): ScoutFilters => ({ ...EMPTY_SCOUT_FILTERS, ...f });
const draft = (n: number) => ({ draftId: `d${String(n).padStart(8, '0')}`, jobId: 'job1', companyId: '1001', modelId: 'a', modelVersion: 1, subject: '件名', body: '本文', chosenAt: '2026-11-27T01:00:00.000Z' });

const ALLOWED_TABLES = ['cms_ai_refresh_log', 'cms_ai_scout_sends', 'cms_ai_scout_templates', 'cms_ai_scout_drafts', 'cms_ai_scout_draft_outcomes', 'cms_ai_dim_industry_group'];
const queries: BuiltQuery[] = [
  aiScoutBenchmarkQuery({ companyId: '1001', industry: '人材紹介会社', industryGroup: 'hr', filters: filters({ ageGroups: ['25-34歳'] }), lang: 'ja' }),
  aiScoutOptionsQuery(),
  aiScoutOutcomesQuery(['d00000001']),
  aiScoutDraftsMergeQuery([draft(1)]),
];

describe('AI スカウトのマートの SQL（src/worker/sql/aiScout.ts）', () => {
  it.each(queries.map((q) => [q.label, q] as const))('%s: cms_ai_* だけを使い、値は @param で渡し、上限（maxBytes）を持つ', (_l, q) => {
    const tables = Array.from(q.sql.matchAll(/`bq-hgt\.dwh\.([a-z_]+)`/g)).map((m) => m[1]);
    expect(tables.length).toBeGreaterThan(0);
    for (const t of tables) {
      expect(t.startsWith('cms_ai_')).toBe(true);
      expect(ALLOWED_TABLES).toContain(t);
    }
    // バッククォートで囲まない表の参照が無い（FROM / JOIN / MERGE の直後は、表かサブクエリか CTE）
    expect(q.sql).not.toMatch(/dwh\.(?!cms_ai_)/);
    expect(q.sql).not.toMatch(/'\d{4}-\d{2}(-\d{2})?'/);
    const refs = Array.from(new Set(Array.from(q.sql.matchAll(/@([a-z_]+)/g)).map((m) => m[1])));
    const names = q.params.map((x) => x.name);
    for (const r of refs) expect(names).toContain(r);
    for (const n of names) expect(refs).toContain(n);
    expect(q.maxBytes).toBeGreaterThan(0);
    expect(q.maxBytes).toBeLessThanOrEqual(400 * 1024 ** 2);
  });

  it('SQL の本文を文字列連結・差し込みで組み立てていない（入力が違っても本文は同じ）', () => {
    const src = readFileSync(join(process.cwd(), 'src/worker/sql/aiScout.ts'), 'utf8');
    const sqlBlocks = Array.from(src.matchAll(/sql: `([\s\S]*?)`,\n/g)).map((m) => m[1]);
    expect(sqlBlocks.length).toBe(4);
    for (const b of sqlBlocks) expect(b).not.toContain('${');
    expect(src).not.toMatch(/sql:\s*[^`\s]/);
    expect(src).not.toMatch(/\.sql\s*\+=|sql\s*\+\s*/);
    const a = aiScoutBenchmarkQuery({ companyId: '1', industry: 'A', industryGroup: '', filters: filters(), lang: 'ja' });
    const b = aiScoutBenchmarkQuery({ companyId: "2'; DROP TABLE x; --", industry: "B' OR 1=1 --", industryGroup: 'it', filters: filters({ residences: ["東京都') OR ('1'='1"] }), lang: 'en' });
    expect(b.sql).toBe(a.sql);
    expect(aiScoutOutcomesQuery(['x']).sql).toBe(aiScoutOutcomesQuery(["y' OR '1'='1"]).sql);
    expect(aiScoutDraftsMergeQuery([draft(1)]).sql).toBe(aiScoutDraftsMergeQuery([{ ...draft(2), body: "'); DELETE FROM t; --" }]).sql);
  });

  it('benchmark の @param の一覧と、分析の決まり（ユーザー指定の値）', () => {
    const q = queries[0];
    expect(q.params.map((x) => x.name).sort()).toEqual(
      ['ages', 'company_id', 'digest_chars', 'digest_max', 'english_levels', 'industry', 'industry_group', 'japanese_levels', 'lang', 'min_sends', 'min_templates', 'months', 'nationalities', 'occupations', 'per_company', 'residences', 'step', 'threshold', 'top_n'].sort(),
    );
    const v = (n: string) => q.params.find((x) => x.name === n)!.parameterValue.value;
    expect(v('threshold')).toBe(String(SCOUT_RATE_THRESHOLD));
    expect(v('top_n')).toBe(String(SCOUT_TOP_TEMPLATES));
    expect(v('months')).toBe(String(SCOUT_WINDOW_MONTHS));
    expect(v('min_sends')).toBe(String(SCOUT_MIN_SENDS));
    expect(v('min_templates')).toBe(String(SCOUT_MIN_TEMPLATES));
    expect(v('digest_max')).toBe(String(DIGEST_MAX));
    expect(v('digest_chars')).toBe(String(DIGEST_BODY_CHARS));
    expect(v('company_id')).toBe('1001');
    // 配列の条件は ARRAY<STRING>。空 = 指定なし
    const ages = q.params.find((x) => x.name === 'ages')!;
    expect(ages.parameterType).toEqual({ type: 'ARRAY', arrayType: { type: 'STRING' } });
    expect(ages.parameterValue.arrayValues).toEqual([{ value: '25-34歳' }]);
    for (const n of ['ages', 'nationalities', 'japanese_levels', 'english_levels', 'residences', 'occupations']) expect(q.sql).toContain(`IFNULL(ARRAY_LENGTH(@${n}), 0) = 0 OR`);
    // 10% を「超える」（以上ではない）。依頼した企業は除く
    expect(q.sql).toContain('rate > @threshold');
    expect(q.sql).toContain('company_id != @company_id');
    // 数字でない企業 ID は、どの企業にも当たらない値にする
    expect(aiScoutBenchmarkQuery({ companyId: 'abc', industry: 'A', industryGroup: '', filters: filters(), lang: 'ja' }).params.find((x) => x.name === 'company_id')!.parameterValue.value).toBe('-1');
  });

  it('案の書き込みは 1 回 50 行まで（JSON 1 つを @rows で渡す）', () => {
    const q = aiScoutDraftsMergeQuery(Array.from({ length: EXPORT_MAX_ROWS }, (_, i) => draft(i)));
    expect(q.params.map((x) => x.name)).toEqual(['rows']);
    expect(JSON.parse(String(q.params[0].parameterValue.value))).toHaveLength(EXPORT_MAX_ROWS);
    expect(() => aiScoutDraftsMergeQuery(Array.from({ length: EXPORT_MAX_ROWS + 1 }, (_, i) => draft(i)))).toThrow();
    expect(q.sql).toContain('MERGE `bq-hgt.dwh.cms_ai_scout_drafts`');
  });

  it('特徴のフラグは、マートの列と SQL の両方にある', () => {
    const mart = readFileSync(join(process.cwd(), 'bq/ai/scout_marts.sql'), 'utf8');
    expect(SCOUT_FEATURES.length).toBeGreaterThanOrEqual(8);
    expect(SCOUT_FEATURES.length).toBeLessThanOrEqual(16);
    for (const f of SCOUT_FEATURES) {
      expect(mart).toContain(`AS ${f.key},`);
      expect(queries[0].sql).toContain(`COUNTIF(${f.key}) AS ${f.key}`);
      expect(f.label.length).toBeLessThanOrEqual(40);
    }
  });
});

describe('類似業界のまとまり（industryGroups.ts と bq/ai/scout_marts.sql の対応表）', () => {
  const mart = readFileSync(join(process.cwd(), 'bq/ai/scout_marts.sql'), 'utf8');
  const block = mart.split('-- industry_groups:begin')[1]?.split('-- industry_groups:end')[0] ?? '';
  const sqlRows = Array.from(block.matchAll(/\('([^']+)',\s*'([^']+)',\s*'([^']+)'\)/g)).map((m) => ({ industry: m[1], id: m[2], label: m[3] }));

  it('SQL と定数が一致する（業界 → まとまりの ID・名前）', () => {
    const tsRows = INDUSTRY_GROUPS.flatMap((g) => g.industries.map((industry) => ({ industry, id: g.id, label: g.label })));
    const key = (r: { industry: string; id: string; label: string }) => `${r.industry}|${r.id}|${r.label}`;
    expect(sqlRows.length).toBeGreaterThan(0);
    expect(sqlRows.map(key).sort()).toEqual(tsRows.map(key).sort());
  });

  it('48 業界を 10〜12 のまとまりに、重複なく割り当てている。「その他」は単独', () => {
    const all = INDUSTRY_GROUPS.flatMap((g) => g.industries);
    expect(all).toHaveLength(48);
    expect(new Set(all).size).toBe(48);
    expect(INDUSTRY_GROUPS.length).toBeGreaterThanOrEqual(10);
    expect(INDUSTRY_GROUPS.length).toBeLessThanOrEqual(12);
    expect(new Set(INDUSTRY_GROUPS.map((g) => g.id)).size).toBe(INDUSTRY_GROUPS.length);
    expect(industryGroupOf('その他')?.industries).toEqual(['その他']);
    expect(industryGroupOf('ITコンサルティング')?.id).toBe('it');
    expect(industryGroupOf('人材紹介会社')?.id).toBe('hr');
    expect(industryGroupOf('一覧に無い業界')).toBeNull();
  });
});

describe('makeScoutDataSource（サンプルデータ = BQ_MOCK=1 でも同じ道を通る）', () => {
  const ds = makeScoutDataSource(baseEnv);

  it('options: 契約の型を通り、未入力を含まない', async () => {
    const o = ScoutOptionsResponseSchema.parse(await ds.options());
    expect(o.dataDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    for (const k of SCOUT_FILTER_KEYS) {
      expect(o[k].length).toBeGreaterThan(0);
      expect(o[k]).not.toContain('(未入力)');
      expect(new Set(o[k]).size).toBe(o[k].length);
    }
  });

  it('benchmark: basis・stats が契約の型を通り、要点の材料に社名・個人名が無い', async () => {
    const b = await ds.benchmark({ companyId: '1001', industry: 'ITコンサルティング', filters: filters(), lang: 'ja' });
    expect(b).not.toBeNull();
    const basis = ScoutBasisSchema.parse(b!.basis);
    const stats = ScoutStatsSchema.parse(b!.stats);
    expect(basis.scope).toBe('industry');
    expect(basis.scopeLabel).toBe('同じ業界（ITコンサルティング）');
    expect(basis.threshold).toBe('over10');
    expect(basis.filtersApplied).toBe(false);
    expect(basis.filtersRelaxed).toEqual([]);
    expect(basis.ratePct).toBeGreaterThan(SCOUT_RATE_THRESHOLD * 100);
    expect(basis.overallRatePct).toBeLessThan(basis.ratePct!);
    expect(basis.templates).toBeLessThanOrEqual(SCOUT_TOP_TEMPLATES);
    expect(stats.features.map((f) => f.key)).toEqual(SCOUT_FEATURES.map((f) => f.key));
    expect(stats.bodyChars.p25).toBeLessThanOrEqual(stats.bodyChars.median);
    expect(b!.digest.length).toBeGreaterThan(0);
    expect(b!.digest.length).toBeLessThanOrEqual(DIGEST_MAX);
    expect(b!.digest[0].lang).toBe('ja');
    for (const d of b!.digest) {
      expect(d.body.length).toBeLessThanOrEqual(DIGEST_BODY_CHARS);
      expect(`${d.subject}\n${d.body}`).not.toMatch(/株式会社|https?:|@/);
      expect(d.ratePct).toBeCloseTo((100 * d.replies) / d.sends, 0);
    }
    expect(b!.cacheKey).toMatch(/^[0-9a-f]{32}$/);
  });

  it('benchmark: 条件つきは類似業界（数え直し）、条件が厳しすぎるときは条件を外して、外した条件の名前を返す', async () => {
    const f1 = filters({ ageGroups: ['35-44歳'], englishLevels: ['4. ビジネス会話', '5. 流暢'] });
    const b1 = await ds.benchmark({ companyId: '1001', industry: 'ITコンサルティング', filters: f1, lang: 'en' });
    expect(ScoutBasisSchema.parse(b1!.basis)).toMatchObject({ scope: 'group', scopeLabel: '類似業界: IT・通信（8 業種）', filtersApplied: true, filtersRelaxed: [] });
    expect(b1!.digest[0].lang).toBe('en');
    const f2 = filters({ ageGroups: ['24歳以下'], nationalities: ['日本国籍'], japaneseLevels: ['1. なし'], residences: ['沖縄県'] });
    const b2 = await ds.benchmark({ companyId: '1001', industry: 'ITコンサルティング', filters: f2, lang: 'ja' });
    expect(ScoutBasisSchema.parse(b2!.basis)).toMatchObject({ filtersApplied: false, filtersRelaxed: ['年齢層', '国籍', '日本語力', '現住所'] });
    // 条件を外したときのキーは、条件なしと同じ範囲のキーと同じになる
    const b3 = await ds.benchmark({ companyId: '1001', industry: '一覧に無い業界', filters: filters(), lang: 'ja' });
    expect(b3!.basis).toMatchObject({ scope: 'all', scopeLabel: '全業界' });
  });

  it('まとまりに業界が 1 つだけでも、類似業界（= その業界）として @industry_group を渡す', async () => {
    const seen: BuiltQuery[] = [];
    const client: BqClient = { mock: true, run: async (q) => (seen.push(q), { rows: [], bytesProcessed: 0, cacheHit: false, jobId: null }), dryRun: async () => ({ bytesProcessed: 0 }) };
    const d = scoutDataSourceOf(client);
    expect(await d.benchmark({ companyId: '1', industry: 'マスコミ・広告・出版・印刷・放送', filters: filters(), lang: 'ja' })).toBeNull();
    expect(await d.benchmark({ companyId: '1', industry: ' 派遣会社 ', filters: filters(), lang: 'ja' })).toBeNull();
    const grp = (q: BuiltQuery) => q.params.find((x) => x.name === 'industry_group')!.parameterValue.value;
    expect(grp(seen[0])).toBe('media');
    expect(grp(seen[1])).toBe('hr');
    expect(seen[1].params.find((x) => x.name === 'industry')!.parameterValue.value).toBe('派遣会社');
  });

  it('サンプルデータでは書き込まない（exportDrafts = false）。outcomes は空', async () => {
    expect(await ds.exportDrafts([draft(1)])).toBe(false);
    expect(await ds.outcomes(['d00000001'])).toEqual([]);
    expect(await ds.outcomes([])).toEqual([]);
  });

  it('表が無い・権限が無い・鍵が無いときは、例外にせず「データなし」を返す', async () => {
    const failing: BqClient = {
      mock: false,
      run: async () => {
        throw new BqError('Not found: Table bq-hgt:dwh.cms_ai_scout_sends', 'notFound', 404);
      },
      dryRun: async () => ({ bytesProcessed: 0 }),
    };
    const d = scoutDataSourceOf(failing);
    expect(await d.benchmark({ companyId: '1', industry: 'その他', filters: filters(), lang: 'ja' })).toBeNull();
    expect(ScoutOptionsResponseSchema.parse(await d.options())).toMatchObject({ ageGroups: [], occupations: [], dataDate: null });
    expect(await d.exportDrafts([draft(1)])).toBe(false);
    expect(await d.outcomes(['d00000001'])).toEqual([]);
    // 鍵が無い（makeClient が投げる）
    const noKey = makeScoutDataSource({ ...baseEnv, BQ_MOCK: undefined });
    expect(await noKey.benchmark({ companyId: '1', industry: 'その他', filters: filters(), lang: 'ja' })).toBeNull();
    expect((await noKey.options()).dataDate).toBeNull();
  });

  it('書き込みは 50 行ずつに分け、照合結果を型に直す', async () => {
    const seen: BuiltQuery[] = [];
    const client: BqClient = {
      mock: false,
      run: async (q) => {
        seen.push(q);
        const rows = q.label === 'ai_scout_outcomes' ? [{ draft_id: 'd00000001', matched: true, sends: 40, replies: 6, hires: 1, first_sent_on: '2026-12-01' }, { draft_id: 'd00000002', matched: false, sends: 0, replies: 0, hires: 0, first_sent_on: null }] : [];
        return { rows, bytesProcessed: 0, cacheHit: false, jobId: null };
      },
      dryRun: async () => ({ bytesProcessed: 0 }),
    };
    const d = scoutDataSourceOf(client);
    expect(await d.exportDrafts(Array.from({ length: 120 }, (_, i) => draft(i)))).toBe(true);
    expect(seen.filter((q) => q.label === 'ai_scout_drafts_merge')).toHaveLength(3);
    expect(await d.outcomes(['d00000001', 'd00000002', 'd00000001'])).toEqual([
      { draftId: 'd00000001', matched: true, sends: 40, replies: 6, hires: 1, firstSentOn: '2026-12-01' },
      { draftId: 'd00000002', matched: false, sends: 0, replies: 0, hires: 0, firstSentOn: null },
    ]);
  });

  it('対象が 0 件・更新日なしの行は null、10% 超が無ければ topBelow10', async () => {
    const q = { companyId: '1', industry: 'その他', filters: filters(), lang: 'ja' as const };
    expect(await toBenchmark(undefined, q, '')).toBeNull();
    expect(await toBenchmark({ level: 6, any_over: false, data_date: null, templates: 0 }, q, '')).toBeNull();
    expect(await toBenchmark({ level: 6, any_over: false, data_date: '2026-11-27', templates: 0 }, q, '')).toBeNull();
    const b = await toBenchmark({ level: 3, any_over: false, data_date: '2026-11-27', period_from: '2025-11-28', period_to: '2026-11-27', templates: 30, companies: 9, sends: 400, replies: 20, overall_sends: 900, overall_replies: 27, digest_json: 'not json' }, q, '');
    expect(ScoutBasisSchema.parse(b!.basis)).toMatchObject({ threshold: 'topBelow10', scope: 'all', ratePct: 5, overallRatePct: 3 });
    expect(ScoutStatsSchema.parse(b!.stats).langs).toEqual([]);
    expect(b!.digest).toEqual([]);
  });
});

describe('cacheKey（分析の使い回しのキー）', () => {
  const base = { scope: 'group' as const, scopeValue: 'it', lang: 'ja' as const, dataDate: '2026-11-25' };
  it('条件の順序・重複に依らない', async () => {
    const a = await scoutCacheKey({ ...base, filters: filters({ ageGroups: ['25-34歳', '35-44歳'], englishLevels: ['5. 流暢', '4. ビジネス会話'] }) });
    const b = await scoutCacheKey({ ...base, filters: { ...filters(), englishLevels: ['4. ビジネス会話', '5. 流暢', '5. 流暢'], ageGroups: ['35-44歳', '25-34歳'] } });
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(b).toBe(a);
    expect(normalizeFilters(filters({ ageGroups: ['b', 'a'] }))).toBe(normalizeFilters(filters({ ageGroups: ['a', 'b', 'a'] })));
  });
  it('同じ週（月曜始まり）は同じ、週が変わると変わる。範囲・条件・言語でも変わる', async () => {
    const f = filters({ ageGroups: ['25-34歳'] });
    const mon = await scoutCacheKey({ ...base, filters: f, dataDate: '2026-11-23' });
    expect(await scoutCacheKey({ ...base, filters: f, dataDate: '2026-11-29' })).toBe(mon);
    expect(await scoutCacheKey({ ...base, filters: f, dataDate: '2026-11-30' })).not.toBe(mon);
    expect(await scoutCacheKey({ ...base, filters: f, dataDate: '2026-11-22' })).not.toBe(mon);
    expect(await scoutCacheKey({ ...base, filters: f, dataDate: '2026-11-23', lang: 'en' })).not.toBe(mon);
    expect(await scoutCacheKey({ ...base, filters: f, dataDate: '2026-11-23', scope: 'all', scopeValue: '' })).not.toBe(mon);
    expect(await scoutCacheKey({ ...base, filters: filters({ ageGroups: ['35-44歳'] }), dataDate: '2026-11-23' })).not.toBe(mon);
    // 条件を外したとき（null）は、条件なしと同じ
    expect(await scoutCacheKey({ ...base, filters: null })).toBe(await scoutCacheKey({ ...base, filters: filters() }));
  });
  it('範囲の説明', () => {
    expect(scopeLabelOf('industry', '人材紹介会社', 'hr')).toBe('同じ業界（人材紹介会社）');
    expect(scopeLabelOf('group', '人材紹介会社', 'hr')).toBe('類似業界: 人材（3 業種）');
    expect(scopeLabelOf('all', '人材紹介会社', 'hr')).toBe('全業界');
  });
});
