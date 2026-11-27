import type { ScoutBenchmark, ScoutDataSource, ScoutDraftExport, ScoutDraftOutcome, ScoutJobInfo, ScoutMemberInfo, ScoutMemberResume } from '../../src/worker/ai/scout/dataSource';
import type { ScoutOptionsResponse } from '../../src/shared/ai/scout';

/** ② スカウトのテスト用: BigQuery のマートの代わり（bqDataSource.ts を vi.mock で差し替えて、これを返す） */
export const sampleBenchmark = (over: Partial<ScoutBenchmark> = {}): ScoutBenchmark => ({
  basis: { scope: 'group', scopeLabel: 'IT・通信（類似業界 6 業種）', threshold: 'over10', filtersApplied: false, filtersRelaxed: [], templates: 412, companies: 96, sends: 18240, replies: 2480, ratePct: 13.6, overallRatePct: 4.8, dataDate: '2026-11-26', periodFrom: '2025-11-27', periodTo: '2026-11-26' },
  stats: {
    subjectChars: { p25: 24, median: 33, p75: 42 },
    bodyChars: { p25: 310, median: 480, p75: 720 },
    lines: { p25: 12, median: 18, p75: 26 },
    features: [
      { key: 'why_you', label: '「なぜあなたか」に触れている', sharePct: 78 },
      { key: 'bullets', label: '箇条書きあり', sharePct: 71 },
    ],
    langs: [{ lang: 'ja', sharePct: 82 }],
  },
  digest: [
    { rank: 1, subject: '【フルリモート可】カスタマーサクセス職のご案内', body: '{{候補者名}} 様\nご経験を拝見し、ご連絡しました。\n・導入支援\n・活用提案', bodyChars: 40, sends: 120, replies: 22, ratePct: 18.3, lang: 'ja' },
    { rank: 2, subject: '【東京】バイリンガル IT 営業', body: '{{候補者名}} 様\n英語での商談のご経験を拝見しました。', bodyChars: 30, sends: 85, replies: 14, ratePct: 16.5, lang: 'ja' },
  ],
  cacheKey: 'group:it:none:ja:2026-W48',
  ...over,
});

export const sampleOptions: ScoutOptionsResponse = { ageGroups: ['20代', '30代'], nationalities: ['日本', '日本以外'], japaneseLevels: ['ビジネス'], englishLevels: ['ビジネス', 'ネイティブ'], residences: ['東京都'], occupations: ['営業'], dataDate: '2026-11-26' };

export const sampleJob = (over: Partial<ScoutJobInfo> = {}): ScoutJobInfo => ({
  jobId: '1001',
  title: 'バイリンガルのプロジェクトマネージャー',
  occupation: 'IT関連（オープン・WEB系） - プロジェクトマネージャー',
  industry: 'ITコンサルティング',
  location: '東京都',
  salary: '600万円〜900万円',
  japaneseLevel: '流暢',
  englishLevel: 'ビジネス会話',
  published: true,
  description: '{{企業名}}の受託開発プロジェクトで、海外拠点との進行管理を担当します。\n・要件の整理\n・進行管理',
  requirements: '・プロジェクトマネジメントのご経験 3 年以上\n・英語での会議のご経験',
  ...over,
});

/** 作り物の職務経歴・自己PR（実在しない内容。社名・人名なし）。sampleMember({ resume: null }) で外せる */
export const sampleResume = (over: Partial<ScoutMemberResume> = {}): ScoutMemberResume => ({
  lang: 'ja',
  appeal: 'Web アプリケーションの開発に 8 年ほど携わり、直近の 3 年はプロジェクトマネージャーとして、日本と海外拠点の開発チームの橋渡しを担当してきました。英語と日本語の両方で会議の進行と資料の作成ができます。',
  appealChars: 104,
  work: [
    { title: 'プロジェクトマネージャー', from: '2022-04', to: null, notes: '受託開発のプロジェクトで、進行管理と顧客との調整を担当。\n・メンバー 8 名（うち海外拠点 4 名）のチームの進行管理\n・要件の整理と、見積りの作成' },
    { title: 'Web エンジニア', from: '2017-04', to: '2022-03', notes: '業務システムと EC サイトの開発を担当。\n・サーバーサイドの設計と実装\n・コードレビューと、新しいメンバーの育成' },
  ],
  workCount: 2,
  workChars: 131,
  managementYears: null,
  jobChanges: 1,
  ...over,
});

export const sampleMember = (over: Partial<ScoutMemberInfo> = {}): ScoutMemberInfo => ({
  memberId: '20001',
  ageGroup: '25-34歳',
  nationality: '日本国籍以外',
  japaneseLevel: '5. 流暢',
  englishLevel: '6. ネイティヴ',
  residence: '東京都',
  occupation: 'IT関連',
  lastIndustry: 'IT関連',
  careerLevel: '3. シニアレベル',
  experiencedOccupations: ['IT関連（オープン・WEB系）', 'コンサルティング'],
  desiredOccupations: ['IT関連（オープン・WEB系）'],
  incomeRange: '501万円〜800万円',
  desiredIncomeRange: '801万円以上',
  resume: sampleResume(),
  ...over,
});

export interface FakeScoutDs extends ScoutDataSource {
  state: { benchmark: ScoutBenchmark | null | Error; exportOk: boolean; outcomes: ScoutDraftOutcome[]; options: ScoutOptionsResponse; job: ScoutJobInfo | null; member: ScoutMemberInfo | null };
  calls: { benchmark: unknown[]; exported: ScoutDraftExport[][]; outcomes: string[][]; options: number; job: { companyId: string; jobId: string }[]; member: string[] };
  reset(): void;
}

export const fakeScoutDs: FakeScoutDs = {
  state: { benchmark: sampleBenchmark(), exportOk: true, outcomes: [], options: sampleOptions, job: null, member: null },
  calls: { benchmark: [], exported: [], outcomes: [], options: 0, job: [], member: [] },
  reset() {
    this.state = { benchmark: sampleBenchmark(), exportOk: true, outcomes: [], options: sampleOptions, job: null, member: null };
    this.calls = { benchmark: [], exported: [], outcomes: [], options: 0, job: [], member: [] };
  },
  async options() {
    this.calls.options++;
    return this.state.options;
  },
  async benchmark(q) {
    this.calls.benchmark.push(q);
    if (this.state.benchmark instanceof Error) throw this.state.benchmark;
    return this.state.benchmark;
  },
  async job(companyId, jobId) {
    this.calls.job.push({ companyId, jobId });
    return this.state.job;
  },
  async member(memberId) {
    this.calls.member.push(memberId);
    return this.state.member;
  },
  async exportDrafts(rows) {
    this.calls.exported.push(rows);
    return this.state.exportOk;
  },
  async outcomes(ids) {
    this.calls.outcomes.push(ids);
    return this.state.outcomes.filter((o) => ids.includes(o.draftId));
  },
};
