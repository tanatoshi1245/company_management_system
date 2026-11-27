import type { ScoutBenchmark, ScoutDataSource, ScoutDraftExport, ScoutDraftOutcome } from '../../src/worker/ai/scout/dataSource';
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

export interface FakeScoutDs extends ScoutDataSource {
  state: { benchmark: ScoutBenchmark | null | Error; exportOk: boolean; outcomes: ScoutDraftOutcome[]; options: ScoutOptionsResponse };
  calls: { benchmark: unknown[]; exported: ScoutDraftExport[][]; outcomes: string[][]; options: number };
  reset(): void;
}

export const fakeScoutDs: FakeScoutDs = {
  state: { benchmark: sampleBenchmark(), exportOk: true, outcomes: [], options: sampleOptions },
  calls: { benchmark: [], exported: [], outcomes: [], options: 0 },
  reset() {
    this.state = { benchmark: sampleBenchmark(), exportOk: true, outcomes: [], options: sampleOptions };
    this.calls = { benchmark: [], exported: [], outcomes: [], options: 0 };
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
  async exportDrafts(rows) {
    this.calls.exported.push(rows);
    return this.state.exportOk;
  },
  async outcomes(ids) {
    this.calls.outcomes.push(ids);
    return this.state.outcomes.filter((o) => ids.includes(o.draftId));
  },
};
