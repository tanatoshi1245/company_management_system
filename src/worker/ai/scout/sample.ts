import { ScoutResultSchema, type ScoutInput, type ScoutResult } from '../../../shared/ai/scout';

/**
 * ② の見本（サンプルデータのとき。セッションを立ち上げない）。数値は見本で、実際の集計ではない。
 * 実在の社名・個人名を書かない（差し込みは {{企業名}} {{候補者名}} {{担当者名}}）
 */
export function scoutSample(input: ScoutInput): ScoutResult {
  const position = input.positionName || 'ポジション';
  const review = input.purpose === 'review';
  return ScoutResultSchema.parse({
    ok: true,
    summary: `【見本】${input.industry}の企業のうち返信率が上位の文面は、件名に職種と条件を入れ、冒頭で「なぜあなたに送ったか」を 1 文で伝えています。${review ? '添削では件名と冒頭の 2 点を優先して直しました。' : 'この構成に沿ってテンプレートを作りました。'}`,
    basis: { scope: `【見本】${input.industry}の企業。直近 6 か月に 30 通以上送信`, companies: 24, samples: 86, topRatePct: 12.4, overallRatePct: 5.1, caveat: 'サンプルデータの見本です。実際の集計ではありません。' },
    traits: [
      { title: '件名に職種と条件を入れる', body: '上位の文面は、件名に職種名と、年収・勤務地・リモート可否のどれか 1 つを入れています。' },
      { title: '冒頭で送った理由を伝える', body: '1〜2 文目で、経験のどこを見て連絡したかを具体的に書いています。' },
      { title: '仕事内容は 3 点にしぼる', body: '担当する業務を箇条書き 3 点にまとめ、長い会社紹介は後ろへ回しています。' },
      { title: '次の一歩を軽くする', body: '「まずはカジュアルにお話しを」と、応募ではなく返信だけで進められる形で締めています。' },
    ],
    review: review
      ? [
          { part: '件名', severity: 'high', issue: '件名から、どんな職種の話かが分かりません。', suggestion: `「【${position}】」を先頭に置き、条件を 1 つ添えます。` },
          { part: '冒頭', severity: 'high', issue: '冒頭が会社紹介から始まり、送った理由が後ろにあります。', suggestion: '経験のどこを見て連絡したかを、最初の 2 文に移します。' },
          { part: '締め', severity: 'mid', issue: '応募を前提にした締めで、返信の負担が大きく見えます。', suggestion: '「ご興味があれば、ひとことご返信ください」と、軽い一歩にします。' },
        ]
      : [],
    drafts: [
      {
        label: '案 1（経験に触れる）',
        subject: `【${position}】ご経験を拝見してご連絡しました`,
        body: `{{候補者名}} 様\n\nはじめまして。{{企業名}} の {{担当者名}} と申します。\nご経歴のうち、これまでのご経験が、弊社の「${position}」でそのまま活かせると考え、ご連絡しました。\n\n■ お任せしたいこと\n・（担当業務 1）\n・（担当業務 2）\n・（担当業務 3）\n\n■ 条件\n・勤務地: ${input.location || '（勤務地）'}\n・言語: ${input.language || '（言語の条件）'}\n\nまずはカジュアルにお話しできればうれしいです。ご興味があれば、ひとことご返信ください。`,
        rationale: '上位の文面に共通する「件名に職種」「冒頭で送った理由」「業務を 3 点」「軽い締め」を取り入れました。',
      },
      {
        label: '案 2（短く）',
        subject: `${position} のご案内（${input.location || '勤務地は応相談'}）`,
        body: `{{候補者名}} 様\n\n{{企業名}} の {{担当者名}} です。ご経験を拝見し、「${position}」のご案内をお送りしました。\n\n・お任せしたいこと: （担当業務を 1 行で）\n・条件: ${input.location || '（勤務地）'} / ${input.language || '（言語の条件）'}\n\n詳しい内容は、ご返信をいただいてからお伝えします。ご興味があれば、お気軽にご返信ください。`,
        rationale: 'スマートフォンで 1 画面に収まる長さにし、返信までの負担を下げました。',
      },
    ],
  });
}
