import type { ScoutInput, ScoutModelsResponse, ScoutModelStats, ScoutOptionsResponse, ScoutResult, ScoutTuneResponse } from '../../src/shared/ai/scout';

/** ② スカウトの見本（結果・条件の選択肢・モデルの成績・チューニングの応答）。全部の項目を含む。テストファイルではない（aiFixtures.ts から使う） */

export const SCOUT_OPTIONS: ScoutOptionsResponse = {
  ageGroups: ['20代', '30代', '40代', '50代以上'],
  nationalities: ['日本', '日本以外'],
  japaneseLevels: ['ネイティヴ', '流暢', 'ビジネス会話', '日常会話', '基礎会話'],
  englishLevels: ['ネイティヴ', '流暢', 'ビジネス会話', '日常会話', '基礎会話'],
  residences: ['東京都', '神奈川県', '大阪府', '愛知県', '日本以外'],
  occupations: ['IT・エンジニア', '営業', 'マーケティング', '経理・財務', 'カスタマーサポート'],
  dataDate: '2026-11-26',
};

export const SCOUT_INPUT: ScoutInput = {
  purpose: 'template',
  subject: '',
  body: '',
  industry: 'IT・通信',
  positionName: '法人営業マネージャー',
  jobOccupations: ['ITエンジニア', '営業', 'マーケティング'],
  jobLocation: '東京都',
  filters: { ageGroups: ['30代'], nationalities: [], japaneseLevels: [], englishLevels: ['ビジネス会話'], residences: [], occupations: [] },
  lang: 'ja',
  note: '',
};

const BODY_A = `{{候補者名}} 様

はじめまして。{{企業名}} で採用を担当している {{担当者名}} です。
ご経歴の「外資系 SaaS での法人営業 6 年」を拝見し、ぜひお話ししたくご連絡しました。

■ お任せしたいこと
・大手企業向けの新規開拓と、既存のお客様の深耕
・5 名のチームのマネジメント

■ ポジションの魅力
・年収 800〜1,000 万円（経験に応じて決定）
・英語を使う場面が週の半分以上
・リモート勤務 週 3 日

まずは 30 分、オンラインでカジュアルにお話しできませんか。
ご都合のよい日時を 2〜3 つ、このメッセージへの返信でお知らせください。`;

export const SCOUT_RESULT: ScoutResult = {
  ok: true,
  summary: '返信率の高い文面は、件名に年収と職種を入れ、冒頭で「なぜあなたに送ったか」に触れています。この型をもとに、作り方の違う 3 つの案を用意しました。',
  basis: {
    scope: 'group',
    scopeLabel: 'IT・通信（類似業界 6 業種）',
    threshold: 'over10',
    filtersApplied: true,
    filtersRelaxed: ['現住所'],
    templates: 412,
    companies: 86,
    sends: 18240,
    replies: 2643,
    ratePct: 14.5,
    overallRatePct: 5.1,
    dataDate: '2026-11-26',
    periodFrom: '2025-11-27',
    periodTo: '2026-11-26',
  },
  stats: {
    subjectChars: { p25: 28, median: 36, p75: 44 },
    bodyChars: { p25: 520, median: 680, p75: 910 },
    lines: { p25: 18, median: 24, p75: 31 },
    features: [
      { key: 'salary', label: '年収の記載あり', sharePct: 78.2 },
      { key: 'why_you', label: '「なぜあなたか」に触れている', sharePct: 71.4 },
      { key: 'bullets', label: '箇条書きあり', sharePct: 66 },
      { key: 'next_step', label: '次の一歩が 1 つ', sharePct: 58.3 },
      { key: 'remote', label: 'リモート勤務の記載あり', sharePct: 41.7 },
      { key: 'job_url', label: '求人 URL あり', sharePct: 38.1 },
      { key: 'casual', label: 'カジュアル面談の提案', sharePct: 33.5 },
      { key: 'english', label: '英語の使用場面の記載', sharePct: 27.9 },
      { key: 'deadline', label: '返信の期限あり', sharePct: 6.2 },
    ],
    langs: [
      { lang: 'ja', sharePct: 82.5 },
      { lang: 'en', sharePct: 17.5 },
    ],
  },
  insight: {
    subjectPatterns: ['【年収・勤務地】+ ポジション名 + 一言の魅力', '経験への言及 +「ご相談」', 'ポジション名 + 英語を使う場面'],
    structure: ['挨拶と名乗り', 'なぜあなたに送ったか', 'お任せしたいこと（箇条書き）', 'ポジションの魅力（年収・働き方）', '次の一歩（面談の提案）'],
    volume: '本文 520〜910 字。箇条書き 3〜5 行',
    traits: [
      { title: '件名に年収と職種', body: '件名の先頭に、年収の幅と職種名を入れている' },
      { title: '冒頭で経験に触れる', body: '最初の 2 行で、候補者の経験のどこを見て連絡したかを書いている' },
      { title: '次の一歩が 1 つ', body: '締めは「まずは 30 分の面談」のように、返信のしかたを 1 つに絞っている' },
    ],
    avoid: ['会社の説明から始める', '返信のしかたを 3 つ以上並べる'],
  },
  insightCached: true,
  drafts: [
    {
      draftId: 'drafta0000000001',
      modelId: 'a',
      modelLabel: 'モデル A',
      modelVersion: 3,
      subject: '【年収 800〜1,000 万円・東京】法人営業マネージャー｜英語を活かせるポジションのご相談',
      body: BODY_A,
      rationale: '「件名に年収と職種」「冒頭で経験に触れる」「次の一歩が 1 つ」をすべて取り入れ、文章量は中央値に合わせました',
      changes: [],
      feedback: { chosen: false, usedState: 'unknown', usedSource: null, sends: null, replies: null, hires: null, outcomeAt: null },
    },
    {
      draftId: 'draftb0000000002',
      modelId: 'b',
      modelLabel: 'モデル B',
      modelVersion: 1,
      subject: '法人営業 6 年のご経験を拝見しました｜マネージャー職のご相談',
      body: '{{候補者名}} 様\n\n{{企業名}} の {{担当者名}} です。\n外資系での法人営業のご経験を拝見し、ご連絡しました。\n\n5 名のチームを率いる、法人営業マネージャーを探しています。\n年収は 800〜1,000 万円、英語を使う場面が週の半分以上あります。\n\nまずは 30 分、お話しできませんか。',
      rationale: '短い文面で、経験への言及と次の一歩に絞りました',
      changes: [],
      feedback: { chosen: false, usedState: 'unknown', usedSource: null, sends: null, replies: null, hires: null, outcomeAt: null },
    },
    {
      draftId: 'draftc0000000003',
      modelId: 'c',
      modelLabel: 'モデル C',
      modelVersion: 2,
      subject: '【リモート週 3 日】英語 × 法人営業のマネージャー職',
      body: '{{候補者名}} 様\n\nご経歴を拝見し、ぜひ一度お話ししたくご連絡しました。\n{{企業名}} の {{担当者名}} です。\n\n■ このポジションの特徴\n・リモート勤務 週 3 日\n・英語を使う場面が週の半分以上\n・年収 800〜1,000 万円\n\nご興味があれば、「興味あり」を押していただくだけで結構です。',
      rationale: '働き方の魅力を先に出し、返信の手間を小さくしました',
      changes: [],
      feedback: { chosen: false, usedState: 'unknown', usedSource: null, sends: null, replies: null, hires: null, outcomeAt: null },
    },
  ],
  warnings: [],
  elapsedMs: 14200,
  tokens: 18350,
};

/** 添削の結果（変更点つき）と、注意つきの結果 */
export const SCOUT_REVIEW_RESULT: ScoutResult = {
  ...SCOUT_RESULT,
  basis: { ...SCOUT_RESULT.basis, scope: 'all', scopeLabel: '全業界', threshold: 'topBelow10', filtersApplied: false, filtersRelaxed: [], templates: 37, ratePct: 7.8 },
  insightCached: false,
  drafts: SCOUT_RESULT.drafts.slice(0, 2).map((d) => ({ ...d, changes: ['件名の先頭に年収と職種を入れました', '会社の説明を後ろへ移し、冒頭で経験に触れました'] })),
  warnings: ['モデル C は案を作れませんでした（応答が時間内に返りませんでした）'],
};

const stats = (over: Partial<ScoutModelStats> = {}): ScoutModelStats => ({ drafts: 42, judged: 30, chosen: 14, chosenRatePct: 46.7, used: 9, sends: 620, replies: 81, hires: 2, replyRatePct: 13.1, score: 61.4, ...over });

/** モデルの成績（管理者に返す形。プレイブックと生成モデルの ID つき） */
export const SCOUT_MODELS: ScoutModelsResponse = {
  models: [
    {
      id: 'a',
      label: 'モデル A',
      description: '分析の要点をすべて取り入れる、標準の作り方',
      engine: 'engine-x-1',
      activeVersion: 3,
      versions: [
        { version: 1, origin: 'initial', note: '', createdAt: '2026-11-01T00:00:00.000Z', createdBy: 'system', active: false, stats: stats({ drafts: 20, judged: 16, chosen: 5, chosenRatePct: 31.3, score: 44.2 }), playbook: '第 1 版の作り方\n1. 挨拶\n2. 求人の説明' },
        { version: 2, origin: 'tuned', note: '冒頭で経験に触れる指示を足した', createdAt: '2026-11-10T00:10:00.000Z', createdBy: 'system', active: false, stats: stats({ drafts: 24, judged: 18, chosen: 6, chosenRatePct: 33.3, score: 47 }), playbook: '第 2 版の作り方\n1. 経験に触れる\n2. 求人の説明' },
        { version: 3, origin: 'tuned', note: '件名の先頭に年収を入れる指示を足した', createdAt: '2026-11-17T00:10:00.000Z', createdBy: 'admin@daijob.com', active: true, stats: stats(), playbook: '第 3 版の作り方\n1. 件名の先頭に年収と職種\n2. 冒頭で経験に触れる\n3. 次の一歩は 1 つ' },
      ],
    },
    {
      id: 'b',
      label: 'モデル B',
      description: '短く、次の一歩に絞る作り方',
      engine: 'engine-y-2',
      activeVersion: 1,
      versions: [{ version: 1, origin: 'initial', note: '', createdAt: '2026-11-01T00:00:00.000Z', createdBy: 'system', active: true, stats: stats({ drafts: 42, judged: 5, chosen: 1, chosenRatePct: 20, used: 0, sends: 0, replies: 0, hires: 0, replyRatePct: null, score: null }), playbook: 'B の作り方' }],
    },
    {
      id: 'c',
      label: 'モデル C',
      description: '働き方の魅力を先に出す作り方',
      engine: 'engine-z-3',
      activeVersion: 2,
      versions: [
        { version: 1, origin: 'initial', note: '', createdAt: '2026-11-01T00:00:00.000Z', createdBy: 'system', active: false, stats: stats({ drafts: 30, judged: 22, chosen: 9, chosenRatePct: 40.9, score: 52 }), playbook: 'C 第 1 版の作り方' },
        { version: 2, origin: 'rollback', note: '第 2 版より第 1 版の成績がよかったため、作り方を戻した', createdAt: '2026-11-24T00:10:00.000Z', createdBy: 'system', active: true, stats: stats({ drafts: 12, judged: 9, chosen: 3, chosenRatePct: 33.3, score: 40.5 }), playbook: 'C 第 2 版の作り方' },
      ],
    },
  ],
  lastTunedAt: '2026-11-24T00:10:00.000Z',
  lastTuneNote: 'A = 据え置き、B = 判断が足りないため据え置き、C = 前の版へ戻した',
  schedule: '毎週月曜 9:10 ごろ（JST）',
  admin: true,
};

/** 管理者でない人に返す形（プレイブックと生成モデルの ID は null） */
export const SCOUT_MODELS_VIEWER: ScoutModelsResponse = {
  ...SCOUT_MODELS,
  admin: false,
  models: SCOUT_MODELS.models.map((m) => ({ ...m, engine: null, versions: m.versions.map((v) => ({ ...v, playbook: null })) })),
};

export const SCOUT_TUNE: ScoutTuneResponse = {
  ranAt: '2026-11-27T03:00:00.000Z',
  outcomesUpdated: 7,
  results: [
    { modelId: 'a', action: 'tuned', fromVersion: 3, toVersion: 4, note: '避けたい表現の指示を足しました' },
    { modelId: 'b', action: 'kept', fromVersion: 1, toVersion: 1, note: '判断された数が 8 件に足りないため据え置き' },
    { modelId: 'c', action: 'rolledBack', fromVersion: 2, toVersion: 3, note: '前の版より総合点が低いため戻しました' },
  ],
};
