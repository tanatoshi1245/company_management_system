import { vi } from 'vitest';
import type { AiCompanyDefaultsResponse, AiCompanyOption, AiConfigResponse, AiJobDetail, AiJobSummary, AiKind } from '../../src/shared/ai/common';
import type { JobResult } from '../../src/shared/ai/job';
import type { ScoutResult } from '../../src/shared/ai/scout';

/** AI 機能の画面テストで共用する見本と、fetch のモック（tests/app/ai*.test.tsx）。テストファイルではない */

export const COMPANIES: AiCompanyOption[] = [
  { id: '101', name: '株式会社アクメ商事', industry: 'IT・通信', companyType: '直接' },
  { id: '102', name: 'グローバル物流株式会社', industry: '物流・運輸', companyType: '直接' },
  { id: '103', name: 'グローバル物流株式会社', industry: '人材サービス', companyType: '紹介' },
  { id: '104', name: 'Northwind Trading K.K.', industry: null, companyType: '派遣' },
];

export const INDUSTRY_OPTIONS = ['IT・通信', '物流・運輸', '人材サービス', 'メーカー（電気・電子）', '金融・保険', 'コンサルティング'];
export const OCCUPATION_OPTIONS = ['営業', 'ITエンジニア', 'マーケティング', '経理・財務', '人事・総務', 'カスタマーサポート', '翻訳・通訳'];

export const DEFAULTS: Record<string, AiCompanyDefaultsResponse> = {
  '101': {
    companyId: '101',
    industry: 'IT・通信',
    occupations: ['ITエンジニア', '営業', 'マーケティング', '経理・財務'],
    jobs: [
      { jobKey: 'J-1001', title: 'バイリンガル法人営業マネージャー', occupation: '営業', location: '東京都', japaneseLevel: 'ネイティヴ', englishLevel: 'ビジネス会話', salaryBand: '600〜800万円' },
      { jobKey: 'J-1002', title: 'バックエンドエンジニア', occupation: 'ITエンジニア', location: '大阪府', japaneseLevel: 'ビジネス会話', englishLevel: '未設定', salaryBand: '未設定' },
    ],
    industryOptions: INDUSTRY_OPTIONS,
    occupationOptions: OCCUPATION_OPTIONS,
  },
  '102': { companyId: '102', industry: '物流・運輸', occupations: ['カスタマーサポート'], jobs: [], industryOptions: INDUSTRY_OPTIONS, occupationOptions: OCCUPATION_OPTIONS },
  '104': { companyId: '104', industry: null, occupations: [], jobs: [], industryOptions: INDUSTRY_OPTIONS, occupationOptions: OCCUPATION_OPTIONS },
};

export const SCOUT_RESULT: ScoutResult = {
  ok: true,
  summary: '件名に職種と言語の条件が無く、冒頭で候補者の経験に触れていません。上位の文面にならって直した案を 2 つ用意しました。',
  basis: { scope: 'IT・通信の直接採用企業。2026-06〜2026-11 に 30 通以上送信', companies: 42, samples: 180, topRatePct: 12.4, overallRatePct: 5.1, caveat: '営業職の文面が少ないため、職種を広げて比べました' },
  traits: [
    { title: '件名に職種と条件', body: '件名の先頭に、職種名と言語の条件を入れている' },
    { title: '冒頭で経験に触れる', body: '最初の 2 行で、候補者の経験のどこを見て連絡したかを書いている' },
    { title: '次の一歩が 1 つ', body: '締めは「まずは 30 分の面談」のように、返信のしかたを 1 つに絞っている' },
  ],
  review: [
    { part: '締め', severity: 'low', issue: '返信のしかたが 3 通り書かれています', suggestion: '面談の日程調整の 1 つに絞ります' },
    { part: '件名', severity: 'high', issue: '件名から職種が分かりません', suggestion: '先頭に職種名と英語の条件を入れます' },
    { part: '冒頭', severity: 'mid', issue: '会社の説明から始まっています', suggestion: '候補者の経験に触れる 1 文から始めます' },
  ],
  drafts: [
    { label: '案 A（経験に触れる）', subject: '【法人営業マネージャー】英語を活かせるポジションのご案内', body: '{{候補者名}} 様\n\nご経歴を拝見し、ご連絡しました。\n{{企業名}} の {{担当者名}} です。', rationale: '上位の文面の「件名に職種と条件」「冒頭で経験に触れる」を取り入れました' },
    { label: '案 B（短く）', subject: '英語 × 法人営業のマネージャー職', body: '{{候補者名}} 様\n\nまずは 30 分、お話しできませんか。', rationale: '短い文面で、次の一歩を 1 つに絞りました' },
  ],
};

export const JOB_RESULT: JobResult = {
  ok: true,
  summary: 'タイトルから言語の条件が分からず、仕事内容が箇条書きだけです。応募率の高い求人にならって直した案を用意しました。',
  basis: { scope: 'IT・通信 × 営業。2026-06〜2026-11 に 100 回以上閲覧された求人', companies: 18, samples: 64, topRatePct: 4.8, overallRatePct: 1.9, caveat: '' },
  traits: [
    { title: 'タイトルに言語の条件', body: 'タイトルに、使う言語と役割を入れている' },
    { title: '1 日の流れ', body: '仕事内容に、1 日の流れか担当の範囲を文で書いている' },
  ],
  review: [
    { part: '仕事内容', severity: 'mid', issue: '箇条書きだけで、担当の範囲が分かりません', suggestion: '担当する顧客と、チームの人数を文で足します' },
    { part: 'タイトル', severity: 'high', issue: '言語の条件が入っていません', suggestion: '「英語を活かす」をタイトルの先頭に入れます' },
  ],
  draft: { title: '【英語を活かす】法人営業マネージャー', description: '{{企業名}} の法人営業チーム（5 名）を率いていただきます。\n担当は外資系のお客様です。', requirements: '・法人営業の経験 5 年以上\n・英語ビジネスレベル以上', rationale: '上位の求人の「タイトルに言語の条件」「担当の範囲を文で書く」を取り入れました' },
};

export function makeJob(over: Partial<AiJobDetail> & Pick<AiJobDetail, 'id' | 'kind' | 'companyId'>): AiJobDetail {
  return {
    status: 'done',
    title: '添削: 法人営業マネージャー',
    summary: null,
    error: null,
    createdBy: 'cs@daijob.com',
    createdAt: '2026-11-25T01:00:00.000Z',
    completedAt: '2026-11-25T01:04:00.000Z',
    edited: false,
    sample: false,
    input: {},
    result: null,
    editedResult: null,
    sessionUrl: null,
    companyName: COMPANIES.find((c) => c.id === over.companyId)?.name ?? '',
    ...over,
  };
}

const summaryOf = (j: AiJobDetail): AiJobSummary => ({ id: j.id, kind: j.kind, companyId: j.companyId, status: j.status, title: j.title, summary: j.summary, error: j.error, createdBy: j.createdBy, createdAt: j.createdAt, completedAt: j.completedAt, edited: j.edited, sample: j.sample });

export interface AiMock {
  calls: string[];
  /** POST / PUT の本文（呼ばれた順） */
  bodies: { url: string; method: string; body: unknown }[];
  jobs: Map<string, AiJobDetail>;
  config: AiConfigResponse;
}

/**
 * AI 機能の API のモック。create = POST /api/companies/:id/ai/jobs の応答を作る関数（既定は「見本を返した」）。
 * 保存済みのジョブ（jobs）は、履歴と 1 件の取得に出る。
 */
export function mockAiApi(opts: { config?: Partial<AiConfigResponse>; jobs?: AiJobDetail[]; create?: (companyId: string, body: { kind: AiKind; input: unknown }, m: AiMock) => { status?: number; json: unknown } } = {}): AiMock {
  const m: AiMock = {
    calls: [],
    bodies: [],
    jobs: new Map((opts.jobs ?? []).map((j) => [j.id, j])),
    config: { fireConfigured: true, storeConfigured: true, sampleMode: false, canWrite: true, admin: false, ...opts.config },
  };
  const nf = () => Response.json({ error: '見つかりません', code: 'notFound' }, { status: 404 });
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    m.calls.push(`${method} ${url}`);
    const body = init?.body ? (JSON.parse(String(init.body)) as unknown) : undefined;
    if (method !== 'GET') m.bodies.push({ url, method, body });
    if (url === '/api/ai/config') return Response.json(m.config);
    if (url === '/api/ai/companies') return Response.json({ companies: COMPANIES });
    let x = url.match(/^\/api\/ai\/companies\/([^/]+)\/defaults$/);
    if (x) return DEFAULTS[x[1]] ? Response.json(DEFAULTS[x[1]]) : nf();
    x = url.match(/^\/api\/ai\/jobs\?company=([^&]+)&kind=(\w+)$/);
    if (x) {
      const list = Array.from(m.jobs.values()).filter((j) => j.companyId === x![1] && j.kind === x![2]);
      return Response.json({ jobs: list.map(summaryOf).sort((a, b) => b.createdAt.localeCompare(a.createdAt)) });
    }
    x = url.match(/^\/api\/companies\/([^/]+)\/ai\/jobs$/);
    if (x && method === 'POST') {
      const r = opts.create ? opts.create(x[1], body as { kind: AiKind; input: unknown }, m) : { json: { error: 'create が未設定', code: 'test' }, status: 500 };
      return Response.json(r.json, { status: r.status ?? 201 });
    }
    x = url.match(/^\/api\/ai\/jobs\/([a-z0-9]+)\/edited$/);
    if (x) {
      const j = m.jobs.get(x[1]);
      if (!j) return nf();
      const next = method === 'PUT' ? { ...j, editedResult: (body as { result: unknown }).result, edited: true } : { ...j, editedResult: null, edited: false };
      m.jobs.set(j.id, next);
      return Response.json(next);
    }
    x = url.match(/^\/api\/ai\/jobs\/([a-z0-9]+)\/fire$/);
    if (x && method === 'POST') {
      const j = m.jobs.get(x[1]);
      if (!j) return nf();
      const next: AiJobDetail = { ...j, status: 'running', error: null };
      m.jobs.set(j.id, next);
      return Response.json({ job: next, fire: 'sent', fireMessage: null });
    }
    x = url.match(/^\/api\/ai\/jobs\/([a-z0-9]+)$/);
    if (x && method === 'DELETE') {
      m.jobs.delete(x[1]);
      return Response.json({ ok: true });
    }
    if (x) {
      const j = m.jobs.get(x[1]);
      return j ? Response.json(j) : nf();
    }
    return nf();
  }) as typeof fetch;
  return m;
}
