import { hasScoutFilters, ScoutResultSchema, type ScoutInput, type ScoutResult, type ScoutTarget } from '../../../shared/ai/scout';
import { draftIdOf } from '../ids';
import { SCOUT_MODELS } from './models';

/**
 * ② の見本（サンプルデータのとき。Vertex AI を呼ばない）。数値は見本で、実際の集計ではない。
 * 実在の社名・個人名を書かない（差し込みは {{企業名}} {{候補者名}} {{担当者名}}）。
 * target = 何をもとに作ったか（求人・候補者の要約。サンプルデータのフィクスチャから引いたもの）。input は、求人・候補者の値で置き換えた後のもの。
 * 候補者に職務経歴・自己PR の登録があるとき（target.member.resume）は、見本の冒頭を「職務経歴と自己PR を拝見し」に変える（本文そのものは、見本にも入れない）
 */
export function scoutSample(input: ScoutInput, jobId: string, target: ScoutTarget | null = null): ScoutResult {
  const position = input.positionName || 'ポジション';
  const review = input.purpose === 'review';
  const location = input.jobLocation || '{{勤務地}}';
  const label = (id: 'a' | 'b' | 'c') => SCOUT_MODELS.find((m) => m.id === id)!.label;
  const changes = (xs: string[]) => (review ? xs : []);
  const hasResume = Boolean(target?.member?.resume);
  const seen = hasResume ? 'ご登録の職務経歴と自己PR を拝見し、{{ご経験}} のご経験' : 'ご経歴を拝見し、これまでのご経験';
  const resumeNote = hasResume ? '候補者の職務経歴・自己PR に触れる箇所は、見本では {{ご経験}} の差し込みにしています。' : '';
  return ScoutResultSchema.parse({
    ok: true,
    summary: `【見本】${input.industry}の直近 1 年の送信実績から、返信率 10% 超の文面 412 件を分析し、3 つのモデルで文面を${review ? '添削' : '作成'}しました（サンプルデータの見本で、実際の集計ではありません）。`,
    basis: {
      scope: 'group',
      scopeLabel: `【見本】${input.industry}（類似業界）`,
      threshold: 'over10',
      filtersApplied: hasScoutFilters(input.filters),
      filtersRelaxed: [],
      templates: 412,
      companies: 96,
      sends: 18240,
      replies: 2480,
      ratePct: 13.6,
      overallRatePct: 4.8,
      dataDate: '2026-11-26',
      periodFrom: '2025-11-27',
      periodTo: '2026-11-26',
    },
    stats: {
      subjectChars: { p25: 24, median: 33, p75: 42 },
      bodyChars: { p25: 310, median: 480, p75: 720 },
      lines: { p25: 12, median: 18, p75: 26 },
      features: [
        { key: 'why_you', label: '「なぜあなたか」に触れている', sharePct: 78 },
        { key: 'bullets', label: '箇条書きあり', sharePct: 71 },
        { key: 'salary', label: '年収の記載あり', sharePct: 58 },
        { key: 'casual', label: 'カジュアル面談の案内', sharePct: 52 },
      ],
      langs: [
        { lang: 'ja', sharePct: 82 },
        { lang: 'en', sharePct: 18 },
      ],
    },
    insight: {
      subjectPatterns: ['【勤務地・働き方】ポジション名｜魅力をひとこと', '【活かせる経験】ポジション名のご案内'],
      structure: ['呼びかけと名乗り', 'なぜあなたに送ったか', 'お任せしたいこと（箇条書き）', '条件と魅力', '負担の小さい次の一歩'],
      volume: '本文 310〜720 字（中央値 480 字）、12〜26 行。',
      traits: [
        { title: '送った理由を冒頭に', body: '1〜2 文目で、経験のどこを見て連絡したかを具体的に書いています。' },
        { title: '仕事内容は箇条書き', body: '担当する業務を 3 点ほどの箇条書きにまとめています。' },
        { title: '次の一歩を軽く', body: '応募ではなく、ひとことの返信やカジュアルな面談を案内しています。' },
      ],
      avoid: ['会社の紹介から始め、送った理由が後ろにある', 'いきなり応募を求める'],
    },
    target,
    insightCached: false,
    drafts: [
      {
        draftId: draftIdOf(jobId, 'a'),
        modelId: 'a',
        modelLabel: label('a'),
        modelVersion: 1,
        subject: `【${location}】${position}のご案内`,
        body: `{{候補者名}} 様\n\nはじめまして。{{企業名}} の {{担当者名}} と申します。\n${seen}が「${position}」で活かせると考え、ご連絡しました。\n\n■ お任せしたいこと\n・{{仕事内容}}\n\n■ 条件\n・勤務地: ${location}\n・年収: {{年収}}\n\nまずはカジュアルにお話しできればうれしいです。ご興味があれば、ひとことご返信ください。`,
        rationale: `【見本】返信率の高い文面に多い「件名に勤務地とポジション名」「冒頭で送った理由」「箇条書き」「軽い締め」の型に沿いました。${resumeNote}`,
        changes: changes(['件名を、勤務地とポジション名が先に分かる型に変えました。', '冒頭に、連絡した理由を足しました。']),
      },
      {
        draftId: draftIdOf(jobId, 'b'),
        modelId: 'b',
        modelLabel: label('b'),
        modelVersion: 1,
        subject: `{{ご経験}}をお持ちの方へ｜${position}`,
        body: `{{候補者名}} 様\n\n{{企業名}} の {{担当者名}} です。\nご登録の内容のうち、{{ご経験}} に注目してご連絡しました。そのご経験は、「${position}」で {{仕事内容}} を進めるうえで、そのまま力になると考えています。\n\n・勤務地: ${location}\n・年収: {{年収}}\n\n応募ではなく、まずは話を聞くだけでも構いません。お気軽にご返信ください。`,
        rationale: '【見本】受け取る人の経験から書き始め、その経験がどう活きるかを先に伝える形にしました。',
        changes: changes(['会社紹介から始まる構成を、相手の経験から始まる構成に変えました。', '締めを、応募ではなく「話を聞くだけ」にしました。']),
      },
      {
        draftId: draftIdOf(jobId, 'c'),
        modelId: 'c',
        modelLabel: label('c'),
        modelVersion: 1,
        subject: `${position}（${location}）`,
        body: `{{候補者名}} 様、{{企業名}} の {{担当者名}} です。ご経験を拝見し、「${position}」のご案内をお送りしました。\n\n・仕事内容: {{仕事内容}}\n・勤務地: ${location}\n・年収: {{年収}}\n\nご興味があれば、ひとことご返信ください。詳しい内容は、ご返信の後にお伝えします。`,
        rationale: '【見本】スマートフォンの 1 画面で読み切れる長さにし、要点と次の一歩を前に出しました。',
        changes: changes(['会社の説明を省き、要点を 3 行の箇条書きにしました。']),
      },
    ],
    warnings: [],
    elapsedMs: 0,
    tokens: 0,
  });
}
